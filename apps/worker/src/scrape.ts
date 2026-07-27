import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Stagehand } from "@browserbasehq/stagehand";
import { chromium } from "playwright-core";
import { z } from "zod";
import type { SiteCredentials } from "./crypto";

const listingSchema = z.object({
  opportunities: z
    .array(
      z.object({
        title: z.string(),
        url: z
          .string()
          .describe(
            "Exact href attribute of the <a> wrapping this opportunity — copy character-for-character from the DOM, never invent or build a path from the title; empty string if the row has no link",
          ),
      }),
    )
    .describe("Every opportunity listed on this page"),
  hasNextPage: z
    .boolean()
    .describe("True if a pagination control leads to more results"),
});

const detailSchema = z.object({
  title: z.string(),
  description: z.string().describe("Summary or scope of work"),
  agency: z
    .string()
    .describe("Issuing agency or organization; empty string if not shown"),
  deadline: z
    .string()
    .describe(
      "Due/close date and time exactly as shown; empty string if not shown",
    ),
  location: z
    .string()
    .describe("Place of performance or region; empty string if not shown"),
  amount: z
    .string()
    .describe(
      "Contract value or estimated budget as shown; empty string if not shown",
    ),
});

const LISTING_INSTRUCTION =
  `List every RFP / bid / solicitation / contracting opportunity on the CURRENT page. ` +
  `For url, copy the exact href attribute of that row's detail link from the DOM — never invent, guess, or construct a URL from the title or other text. ` +
  `If a row has no <a href>, set url to "". Do not invent rows. ` +
  `Set hasNextPage true only if a pagination control leads to more results.`;

const DETAIL_INSTRUCTION =
  `This page describes a single RFP / bid / solicitation. Extract its details, copying values exactly as shown. ` +
  `Use an empty string for anything not present. Do not guess. ` +
  `If this is an error, 404, login, or otherwise not an opportunity detail page, set title to "" and put a short explanation in description.`;

export type ScrapeTarget = {
  targetId: string;
  url: string;
};

export type Opportunity = {
  title: string;
  url?: string;
  description?: string;
  agency?: string;
  deadline?: string;
  location?: string;
  amount?: string;
};

export type ScrapeOutcome = {
  opportunityCount: number;
  listingPages: string[];
  trace: string;
};

const workerDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** Stable login act instructions so Stagehand cache keys match across runs. */
const LOGIN_USERNAME_ACT = "Type %username% into the username or email field";
const LOGIN_PASSWORD_ACT =
  "Type %password% into the password field, then submit the login form";

/** Common system Chrome/Chromium paths — harder to fingerprint than Playwright Chromium. */
const SYSTEM_CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

function resolveChromePath(): string | undefined {
  if (process.env.CHROME_PATH?.trim()) {
    return process.env.CHROME_PATH.trim();
  }
  for (const candidate of SYSTEM_CHROME_CANDIDATES) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  // Fall back to Playwright's bundled Chromium when no system browser is installed.
  try {
    return chromium.executablePath();
  } catch {
    return undefined;
  }
}

function isPlaywrightChromium(executablePath: string | undefined): boolean {
  if (!executablePath) return false;
  return (
    executablePath.includes("ms-playwright") ||
    executablePath.includes("Chrome for Testing")
  );
}

function stealthEnabled(): boolean {
  return process.env.STAGEHAND_STEALTH !== "false";
}

function resolveLocale(): string {
  return process.env.STAGEHAND_LOCALE?.trim() || "en-US";
}

function resolveViewport(): { width: number; height: number } {
  const width = Number(process.env.STAGEHAND_VIEWPORT_WIDTH ?? 1440);
  const height = Number(process.env.STAGEHAND_VIEWPORT_HEIGHT ?? 900);
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1440,
    height: Number.isFinite(height) && height > 0 ? height : 900,
  };
}

/** Strip HeadlessChrome from UA — a common bot-detection signal. */
function resolveUserAgent(headless: boolean): string | undefined {
  const override = process.env.STAGEHAND_USER_AGENT?.trim();
  if (override) {
    return override;
  }
  if (!stealthEnabled() || !headless) {
    return undefined;
  }
  const platform =
    process.platform === "darwin"
      ? "Macintosh; Intel Mac OS X 10_15_7"
      : process.platform === "win32"
        ? "Windows NT 10.0; Win64; x64"
        : "X11; Linux x86_64";
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`;
}

function resolveProxy():
  | { server: string; bypass?: string; username?: string; password?: string }
  | undefined {
  const server = process.env.STAGEHAND_PROXY_SERVER?.trim();
  if (!server) {
    return undefined;
  }
  return {
    server,
    ...(process.env.STAGEHAND_PROXY_BYPASS?.trim()
      ? { bypass: process.env.STAGEHAND_PROXY_BYPASS.trim() }
      : {}),
    ...(process.env.STAGEHAND_PROXY_USERNAME?.trim()
      ? { username: process.env.STAGEHAND_PROXY_USERNAME.trim() }
      : {}),
    ...(process.env.STAGEHAND_PROXY_PASSWORD
      ? { password: process.env.STAGEHAND_PROXY_PASSWORD }
      : {}),
  };
}

function buildStealthLaunchArgs(userAgent: string | undefined): string[] {
  if (!stealthEnabled()) {
    return userAgent ? [`--user-agent=${userAgent}`] : [];
  }
  return [
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars",
    ...(userAgent ? [`--user-agent=${userAgent}`] : []),
  ];
}

/**
 * Hide common automation fingerprints before the first navigation.
 * Runs at document start on every new document in the page.
 */
const STEALTH_INIT_SCRIPT = `(() => {
  try {
    Object.defineProperty(Navigator.prototype, "webdriver", {
      get: () => undefined,
      configurable: true,
    });
  } catch {}
  try {
    // Some sites check for window.chrome; headless Chromium often lacks it.
    if (!window.chrome) {
      window.chrome = { runtime: {} };
    }
  } catch {}
  try {
    Object.defineProperty(Navigator.prototype, "languages", {
      get: () => Object.freeze(["en-US", "en"]),
      configurable: true,
    });
  } catch {}
  try {
    Object.defineProperty(Navigator.prototype, "plugins", {
      get: () => {
        const fake = { length: 5, item: () => null, namedItem: () => null, refresh: () => {} };
        return fake;
      },
      configurable: true,
    });
  } catch {}
})()`;

type BrowserPage = {
  url: () => string;
  goto: (
    url: string,
    options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle" },
  ) => Promise<unknown>;
  addInitScript: (script: string) => Promise<void>;
  evaluate: <R = unknown>(
    pageFunctionOrExpression: string | (() => R | Promise<R>),
  ) => Promise<R>;
  waitForLoadState: (
    state: "load" | "domcontentloaded" | "networkidle",
    timeoutMs?: number,
  ) => Promise<void>;
  locator: (selector: string) => {
    first: () => {
      isVisible: (options?: { timeout?: number }) => Promise<boolean>;
      click: (options?: { timeout?: number }) => Promise<void>;
    };
  };
};

const COOKIE_LABELS = [
  "Allow all cookies",
  "Accept all cookies",
  "Accept All",
  "Accept",
  "I agree",
];

/** Wait for content, dismiss cookie banners, and scroll so lazy rows enter the DOM. */
async function settlePage(page: BrowserPage): Promise<void> {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForLoadState("networkidle", 15_000).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  for (const label of COOKIE_LABELS) {
    try {
      const button = page.locator(`button:has-text("${label}")`).first();
      if (await button.isVisible({ timeout: 500 })) {
        await button.click({ timeout: 2000 });
        await new Promise((resolve) => setTimeout(resolve, 800));
        break;
      }
    } catch {
      // ignore — banner may not exist
    }
  }

  for (let i = 0; i < 6; i++) {
    await page
      .evaluate(() => {
        const height = Math.max(
          document.body?.scrollHeight ?? 0,
          document.documentElement?.scrollHeight ?? 0,
        );
        window.scrollTo(0, height);
        return height;
      })
      .catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
}

function resolveCacheDir(target: ScrapeTarget): string {
  const base =
    process.env.STAGEHAND_CACHE_DIR?.trim() ||
    path.join(workerDir, ".stagehand-cache");
  return path.join(base, "targets", target.targetId);
}

type PageLink = { href: string; text: string };

/** Same-origin anchors with a real href — used to reject invented listing URLs. */
async function collectPageLinks(page: BrowserPage): Promise<PageLink[]> {
  return page.evaluate(() => {
    const origin = window.location.origin;
    const out: { href: string; text: string }[] = [];
    const seen = new Set<string>();
    for (const anchor of document.querySelectorAll("a[href]")) {
      const raw = anchor.getAttribute("href")?.trim() ?? "";
      if (
        !raw ||
        raw.startsWith("#") ||
        raw.toLowerCase().startsWith("javascript:")
      ) {
        continue;
      }
      let href: string;
      try {
        href = new URL(raw, window.location.href).toString();
      } catch {
        continue;
      }
      if (!href.startsWith(origin)) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      out.push({
        href,
        text: (anchor.textContent ?? "").replace(/\s+/g, " ").trim(),
      });
    }
    return out;
  });
}

function normalizeMatchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function hrefSet(links: PageLink[]): Set<string> {
  return new Set(links.map((link) => link.href));
}

/**
 * Accept a listing URL only when it appears as a real <a href> on the page.
 * If the model invented a path, fall back to matching the opportunity title against link text.
 */
function resolveVerifiedUrl(
  title: string,
  claimedUrl: string | undefined,
  pageLinks: PageLink[],
): string | undefined {
  const hrefs = hrefSet(pageLinks);
  if (claimedUrl && hrefs.has(claimedUrl)) {
    return claimedUrl;
  }

  const titleNorm = normalizeMatchText(title);
  if (!titleNorm || titleNorm.length < 4) return undefined;

  let best: { href: string; score: number } | undefined;
  for (const link of pageLinks) {
    const text = normalizeMatchText(link.text);
    if (!text || text.length < 4) continue;
    // Skip obvious chrome (pagination, filters, nav) — opportunity links carry the title.
    if (
      text.length < titleNorm.length * 0.4 &&
      !text.includes(titleNorm.slice(0, 24))
    ) {
      continue;
    }
    if (
      text.includes(titleNorm) ||
      titleNorm.includes(text.slice(0, Math.min(text.length, 60)))
    ) {
      const score = Math.min(text.length, titleNorm.length);
      if (!best || score > best.score) {
        best = { href: link.href, score };
      }
    }
  }
  return best?.href;
}

function absoluteUrl(href: string, base: string): string | undefined {
  const trimmed = href.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed, base).toString();
  } catch {
    return undefined;
  }
}

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return undefined;
  return trimmed;
}

/** Drop 404 / empty / placeholder detail extractions from bad URLs. */
function isUsableDetail(detail: z.infer<typeof detailSchema>): boolean {
  const title = optional(detail.title);
  if (!title) return false;
  const lower = title.toLowerCase();
  if (lower.includes("error 404") || lower === "404" || lower === "not found") {
    return false;
  }
  const description = (detail.description ?? "").toLowerCase();
  if (
    description.includes("cannot be found") ||
    description.includes("page not found") ||
    description.includes("page you've requested cannot be found")
  ) {
    return false;
  }
  return true;
}

/**
 * Scrape every RFP/opportunity from a site: paginate the listing to collect links,
 * then open each one and extract its full record.
 *
 * Runs a self-hosted Stagehand session (LOCAL, no Browserbase). Credentials go through
 * Stagehand `variables` (`%name%`) so the LLM never sees secret values, and login actions
 * are cached under cacheDir with selfHeal on.
 *
 * Local anti-detect (STAGEHAND_STEALTH, default on): system Chrome preference,
 * AutomationControlled disabled, realistic viewport/locale, non-Headless UA when headless,
 * and a document-start init script.
 *
 * `onOpportunity` is awaited per record so a run that dies partway still persists its work.
 * `onTrace` is awaited after each step so the UI can show live progress.
 */
export async function runScrape(
  target: ScrapeTarget,
  credentials: SiteCredentials | null,
  onOpportunity: (opportunity: Opportunity) => Promise<void>,
  onTrace?: (trace: string) => Promise<void>,
): Promise<ScrapeOutcome> {
  const model = process.env.STAGEHAND_MODEL ?? "openai/gpt-4o-mini";
  const headless = process.env.STAGEHAND_HEADLESS !== "false";
  const maxPages = Number(process.env.STAGEHAND_MAX_PAGES ?? 1);
  const maxOpportunities = Number(
    process.env.STAGEHAND_MAX_OPPORTUNITIES ?? 200,
  );
  const executablePath = resolveChromePath();
  const userAgent = resolveUserAgent(headless);
  const proxy = resolveProxy();
  const stealth = stealthEnabled();
  const cacheDir = resolveCacheDir(target);

  mkdirSync(cacheDir, { recursive: true });

  const stagehand = new Stagehand({
    env: "LOCAL",
    model,
    cacheDir,
    selfHeal: true,
    // Keep verbose off when secrets are in play so Stagehand doesn't log variable values.
    verbose: credentials ? 0 : 1,
    localBrowserLaunchOptions: {
      headless,
      locale: resolveLocale(),
      viewport: resolveViewport(),
      args: buildStealthLaunchArgs(userAgent),
      ...(executablePath ? { executablePath } : {}),
      ...(proxy ? { proxy } : {}),
    },
  });

  const steps: string[] = [];
  const pushStep = async (line: string) => {
    steps.push(line);
    await onTrace?.(steps.join("\n"));
  };

  await pushStep(`stealth=${stealth}`);
  await pushStep(`headless=${headless}`);
  await pushStep(`chrome=${executablePath ?? "default"}`);
  if (isPlaywrightChromium(executablePath)) {
    await pushStep(
      "warning: using Playwright Chrome for Testing — many sites block this; install Google Chrome or set CHROME_PATH",
    );
  }

  const listingPages: string[] = [];
  const links = new Map<string, { title: string; url?: string }>();
  let opportunityCount = 0;

  try {
    await stagehand.init();
    const page = stagehand.context.pages()[0] as BrowserPage | undefined;
    if (!page) {
      throw new Error("Stagehand did not open a browser page");
    }

    if (stealth) {
      await page.addInitScript(STEALTH_INIT_SCRIPT);
    }

    await pushStep(`goto ${target.url}`);
    await page.goto(target.url, { waitUntil: "domcontentloaded" });

    if (credentials) {
      // `%username%` / `%password%` are substituted locally after the model chooses actions;
      // values in `variables` are not sent to the LLM provider.
      await stagehand.act(LOGIN_USERNAME_ACT, {
        variables: { username: credentials.username },
      });
      await stagehand.act(LOGIN_PASSWORD_ACT, {
        variables: { password: credentials.password },
      });
      await pushStep("logged in with stored credentials");
    }

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
      const currentUrl = page.url();
      listingPages.push(currentUrl);
      await settlePage(page);

      const listing = await stagehand.extract(
        LISTING_INSTRUCTION,
        listingSchema,
      );
      const pageLinks = await collectPageLinks(page);
      let verified = 0;
      let rejected = 0;
      for (const row of listing.opportunities) {
        const title = row.title.trim();
        if (!title) continue;
        const claimed = absoluteUrl(row.url, currentUrl);
        const url = resolveVerifiedUrl(title, claimed, pageLinks);
        if (claimed && !url) {
          rejected += 1;
        }
        if (!url) {
          // No real detail link on the page — skip rather than storing a title with a fake URL.
          continue;
        }
        if (!links.has(url)) {
          links.set(url, { title, url });
          verified += 1;
        }
      }
      await pushStep(
        `listing page ${pageNumber}: ${listing.opportunities.length} row(s), ${verified} verified link(s), ${rejected} invented URL(s) rejected, ${links.size} unique so far — ${currentUrl}`,
      );

      if (!listing.hasNextPage) {
        await pushStep("listing complete: no next page");
        break;
      }
      if (pageNumber === maxPages) {
        await pushStep(`listing stopped: page budget reached (${maxPages})`);
        break;
      }

      await stagehand.act(
        "Click the pagination control for the next page of results",
      );
      await settlePage(page);
      if (page.url() === currentUrl) {
        await pushStep("listing stopped: pagination did not change the URL");
        break;
      }
    }

    const collected = [...links.values()].slice(0, maxOpportunities);
    if (links.size > collected.length) {
      await pushStep(
        `opportunity budget reached: scraping ${collected.length} of ${links.size} (STAGEHAND_MAX_OPPORTUNITIES)`,
      );
    }

    for (const [index, row] of collected.entries()) {
      if (!row.url) {
        await pushStep(
          `detail ${index + 1}/${collected.length}: skipped (no verified link for "${row.title}")`,
        );
        continue;
      }

      try {
        await page.goto(row.url, { waitUntil: "domcontentloaded" });
        await settlePage(page);
        const detail = await stagehand.extract(
          DETAIL_INSTRUCTION,
          detailSchema,
        );
        if (!isUsableDetail(detail)) {
          await pushStep(
            `detail ${index + 1}/${collected.length}: skipped junk/404 page (${row.url})`,
          );
          continue;
        }
        await onOpportunity({
          title: optional(detail.title) ?? row.title,
          url: row.url,
          description: optional(detail.description),
          agency: optional(detail.agency),
          deadline: optional(detail.deadline),
          location: optional(detail.location),
          amount: optional(detail.amount),
        });
        opportunityCount += 1;
        await pushStep(`detail ${index + 1}/${collected.length}: ${row.url}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await pushStep(
          `detail ${index + 1}/${collected.length} failed (${row.url}): ${message}`,
        );
      }
    }

    await pushStep(
      `finished: ${opportunityCount} opportunit(ies) from ${listingPages.length} listing page(s)`,
    );

    return { opportunityCount, listingPages, trace: steps.join("\n") };
  } finally {
    await stagehand.close().catch(() => undefined);
  }
}
