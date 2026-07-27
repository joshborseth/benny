import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Stagehand } from "@browserbasehq/stagehand";
import { chromium } from "playwright-core";
import { z } from "zod";
import type { SiteCredentials } from "./crypto";

/**
 * Fixed-shape extract schema for LLM structured outputs.
 * Open-ended `z.record(..., z.unknown())` becomes `additionalProperties: {}`, which
 * OpenAI/AI SDK structured output rejects ("response did not match schema").
 */
const pageExtractSchema = z.object({
  items: z
    .array(
      z.object({
        title: z
          .string()
          .describe("Short label/title for this record when available; else empty string"),
        fields: z
          .array(
            z.object({
              name: z.string().describe("Field name"),
              value: z.string().describe("Field value as plain text"),
            }),
          )
          .describe("All goal-relevant fields for this record as name/value pairs"),
      }),
    )
    .describe("Records/data found on this page for the goal"),
  pageSummary: z.string().describe("Short summary of what was found on this page"),
  done: z
    .boolean()
    .describe(
      "True when the goal is fully satisfied for its stated scope (not merely when the site has more pages)",
    ),
  nextHint: z
    .string()
    .describe(
      "One concrete in-scope next navigation when done is false (detail link, next page the goal requires, etc.). Empty string when done is true.",
    ),
});

const scrapeResultSchema = z.object({
  items: z
    .array(z.record(z.string(), z.string()))
    .describe("All records collected across pages"),
  summary: z.string().describe("Short summary of the overall scrape"),
  pagesVisited: z.array(z.string()).describe("URLs visited during the scrape"),
  incomplete: z
    .boolean()
    .describe("True if stopped due to budget or stuck navigation rather than done"),
});

type PageExtractItem = z.infer<typeof pageExtractSchema>["items"][number];

type PageEvidence = {
  title: string;
  text: string;
  normalized: string;
  compact: string;
};

const BLOCK_PATTERNS = [
  /\b403\b/i,
  /\bforbidden\b/i,
  /\baccess denied\b/i,
  /\bjust a moment\b/i,
  /\battention required\b/i,
  /\bcf-browser-verification\b/i,
  /\bcaptcha\b/i,
  /\bverify you are human\b/i,
  /\benable javascript and cookies\b/i,
];

/** Flatten LLM extract rows into plain string maps for storage/display. */
function normalizeExtractItem(item: PageExtractItem): Record<string, string> {
  const record: Record<string, string> = {};
  const title = item.title.trim();
  if (title) {
    record.title = title;
  }
  for (const field of item.fields) {
    const name = field.name.trim();
    if (!name) continue;
    record[name] = field.value;
  }
  return record;
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function compactForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isPlaywrightChromium(executablePath: string | undefined): boolean {
  if (!executablePath) return false;
  return (
    executablePath.includes("ms-playwright") ||
    executablePath.includes("Chrome for Testing")
  );
}

function detectBlockedPage(evidence: PageEvidence): string | null {
  const haystack = `${evidence.title}\n${evidence.text}`;
  for (const pattern of BLOCK_PATTERNS) {
    if (pattern.test(haystack)) {
      return `page looks blocked (${pattern.source})`;
    }
  }
  if (evidence.compact.length < 80) {
    return "page text too sparse to scrape (likely blocked, still loading, or empty)";
  }
  return null;
}

function valueAppearsOnPage(value: string, evidence: PageEvidence): boolean {
  const normalized = normalizeForMatch(value);
  if (normalized.length < 4) return false;
  if (evidence.normalized.includes(normalized)) return true;
  const compact = compactForMatch(value);
  // Require a longer compact fingerprint so short tokens don't false-match.
  return compact.length >= 8 && evidence.compact.includes(compact);
}

/**
 * Keep only records whose values are literally grounded in page text.
 * Invented titles like "RFP Title 1" fail this check.
 */
function groundExtractedItems(
  items: PageExtractItem[],
  evidence: PageEvidence,
): { kept: Record<string, string>[]; rejected: number } {
  const kept: Record<string, string>[] = [];
  let rejected = 0;

  for (const raw of items) {
    const item = normalizeExtractItem(raw);
    const values = Object.values(item).map((v) => v.trim()).filter(Boolean);
    if (values.length === 0) {
      rejected += 1;
      continue;
    }

    const substantive = values.filter((v) => normalizeForMatch(v).length >= 4);
    if (substantive.length === 0) {
      rejected += 1;
      continue;
    }

    const groundedCount = substantive.filter((v) =>
      valueAppearsOnPage(v, evidence),
    ).length;
    // Require every substantive value (or at least the title + majority) on-page.
    const title = item.title?.trim();
    const titleOk = !title || title.length < 4 || valueAppearsOnPage(title, evidence);
    const groundedRatio = groundedCount / substantive.length;
    if (!titleOk || groundedRatio < 0.75) {
      rejected += 1;
      continue;
    }

    kept.push(item);
  }

  return { kept, rejected };
}

export type ScrapeTarget = {
  targetId: string;
  url: string;
  goal: string;
};

export type ScrapeOutcome = {
  result: z.infer<typeof scrapeResultSchema>;
  trace: string;
};

type CacheMode = "hit" | "miss" | "repaired";

const workerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

function itemKey(item: unknown): string {
  try {
    return JSON.stringify(item);
  } catch {
    return String(item);
  }
}

function resolveCacheDir(target: ScrapeTarget): string {
  const base =
    process.env.STAGEHAND_CACHE_DIR?.trim() ||
    path.join(workerDir, ".stagehand-cache");
  const configHash = createHash("sha256")
    .update(`${target.url}\n${target.goal}`)
    .digest("hex")
    .slice(0, 16);
  return path.join(base, "targets", target.targetId, configHash);
}

function clearCacheDir(cacheDir: string): void {
  rmSync(cacheDir, { recursive: true, force: true });
}

function isUselessOutcome(outcome: ScrapeOutcome): boolean {
  return outcome.result.incomplete && outcome.result.items.length === 0;
}

type BrowserPage = {
  url: () => string;
  title: () => Promise<string>;
  goto: (
    url: string,
    options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle" },
  ) => Promise<unknown>;
  addInitScript: (script: string) => Promise<void>;
  evaluate: <R = unknown>(pageFunctionOrExpression: string | (() => R | Promise<R>)) => Promise<R>;
  waitForLoadState: (state: "load" | "domcontentloaded" | "networkidle", timeoutMs?: number) => Promise<void>;
  locator: (selector: string) => {
    first: () => {
      isVisible: (options?: { timeout?: number }) => Promise<boolean>;
      click: (options?: { timeout?: number }) => Promise<void>;
    };
  };
};

async function readPageEvidence(page: BrowserPage): Promise<PageEvidence> {
  const title = await page.title().catch(() => "");
  const text = await page
    .evaluate(() => {
      const body = document.body;
      return body ? body.innerText || body.textContent || "" : "";
    })
    .catch(() => "");
  const normalized = normalizeForMatch(`${title}\n${text}`);
  return {
    title,
    text,
    normalized,
    compact: compactForMatch(normalized),
  };
}

async function settlePage(page: BrowserPage, steps: string[]): Promise<PageEvidence> {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForLoadState("networkidle", 15_000).catch(() => undefined);
  // Give SPAs / cookie banners a beat to paint.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // Best-effort cookie banner dismiss — no LLM.
  const cookieLabels = [
    "Allow all cookies",
    "Accept all cookies",
    "Accept All",
    "Accept",
    "I agree",
  ];
  for (const label of cookieLabels) {
    try {
      const button = page.locator(`button:has-text("${label}")`).first();
      if (await button.isVisible({ timeout: 500 })) {
        await button.click({ timeout: 2000 });
        steps.push(`dismissed cookie banner via "${label}"`);
        await new Promise((resolve) => setTimeout(resolve, 800));
        break;
      }
    } catch {
      // ignore — banner may not exist
    }
  }

  // Scroll so lazy/virtualized rows enter the DOM before we snapshot/extract.
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

  let evidence = await readPageEvidence(page);
  if (evidence.compact.length < 80) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    evidence = await readPageEvidence(page);
  }
  steps.push(
    `page evidence: title=${JSON.stringify(evidence.title)} chars=${evidence.text.length}`,
  );
  return evidence;
}

function itemTitle(item: Record<string, string>): string {
  return (item.title ?? Object.values(item)[0] ?? "").trim();
}

async function runScrapeAttempt(
  target: ScrapeTarget,
  credentials: SiteCredentials | null,
  cacheDir: string,
  cacheMode: CacheMode,
): Promise<ScrapeOutcome> {
  const model = process.env.STAGEHAND_MODEL ?? "openai/gpt-4o-mini";
  const headless = process.env.STAGEHAND_HEADLESS !== "false";
  const maxPages = Number(process.env.STAGEHAND_MAX_PAGES ?? 10);
  const navMaxSteps = Number(process.env.STAGEHAND_NAV_MAX_STEPS ?? 6);
  const maxExtractPasses = Math.max(
    1,
    Number(process.env.STAGEHAND_EXTRACT_PASSES ?? 5),
  );
  const executablePath = resolveChromePath();
  const locale = resolveLocale();
  const viewport = resolveViewport();
  const userAgent = resolveUserAgent(headless);
  const proxy = resolveProxy();
  const stealth = stealthEnabled();

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
      locale,
      viewport,
      args: buildStealthLaunchArgs(userAgent),
      ...(executablePath ? { executablePath } : {}),
      ...(proxy ? { proxy } : {}),
    },
  });

  const steps: string[] = [
    `cacheDir=${cacheDir}`,
    `cacheMode=${cacheMode}`,
    `stealth=${stealth}`,
    `headless=${headless}`,
    `chrome=${executablePath ?? "default"}`,
  ];
  const collected: Record<string, string>[] = [];
  const seenKeys = new Set<string>();
  const pagesVisited: string[] = [];
  const pageSummaries: string[] = [];
  let incomplete = false;
  let stopReason = "done";

  if (isPlaywrightChromium(executablePath)) {
    steps.push(
      "warning: using Playwright Chrome for Testing — many sites block this; install Google Chrome or set CHROME_PATH",
    );
  }

  try {
    await stagehand.init();
    const page = stagehand.context.pages()[0] as BrowserPage | undefined;
    if (!page) {
      throw new Error("Stagehand did not open a browser page");
    }

    if (stealth) {
      await page.addInitScript(STEALTH_INIT_SCRIPT);
      steps.push("applied stealth init script");
    }

    steps.push(`goto ${target.url}`);
    await page.goto(target.url, { waitUntil: "domcontentloaded" });

    if (credentials) {
      steps.push("login with stored credentials");
      // `%username%` / `%password%` are substituted locally after the model chooses actions;
      // values in `variables` are not sent to the LLM provider.
      await stagehand.act(LOGIN_USERNAME_ACT, {
        variables: { username: credentials.username },
      });
      await stagehand.act(LOGIN_PASSWORD_ACT, {
        variables: { password: credentials.password },
      });
      steps.push("login actions completed");
    }

    const agent = stagehand.agent();

    for (let visit = 0; visit < maxPages; visit++) {
      const currentUrl = page.url();
      pagesVisited.push(currentUrl);
      steps.push(`visit ${visit + 1}/${maxPages}: ${currentUrl}`);

      const evidence = await settlePage(page, steps);
      const blocked = detectBlockedPage(evidence);
      if (blocked) {
        throw new Error(
          `${blocked} at ${currentUrl}. Refusing to extract invented data. Try STAGEHAND_HEADLESS=false, install Google Chrome / set CHROME_PATH, or provide credentials if required.`,
        );
      }

      // Models often return a partial list and set done=true. Re-extract on this page
      // until a pass adds nothing new (or we hit the pass budget).
      let pageDone = false;
      let nextHint = "";
      const pageTitles: string[] = [];

      for (let pass = 1; pass <= maxExtractPasses; pass++) {
        const alreadyList =
          pageTitles.length > 0
            ? `Already extracted from this page (do NOT repeat these):\n${pageTitles
                .map((t) => `- ${t}`)
                .join("\n")}\n\nExtract ONLY remaining goal-relevant records still visible on this page.`
            : `Extract EVERY goal-relevant record visible on this page. Do not stop early — if the page shows 20+ listings, return all of them in this response (or as many as fit; later passes will collect the rest).`;

        const extracted = await stagehand.extract(
          `Goal: ${target.goal}

Extract data for that goal from the CURRENT page ONLY.

${alreadyList}

CRITICAL — never invent, guess, or use placeholder/example data:
- Every title and field value MUST be copied from text visible on this page.
- If no remaining relevant data is visible, return items: [] and explain what the page actually shows in pageSummary.
- Do not fabricate titles like "RFP Title 1", sample dates, or dollar amounts.

Return each real record with a title (if any) and flat name/value fields — stringify dates, amounts, and lists as text exactly as shown.

Decide done/nextHint from the GOAL'S SCOPE after considering the whole page (not just this partial batch):
- If the goal still needs other in-scope pages (detail links for items on this page, or pagination the goal asks for), set done to false and put one concrete next navigation hint in nextHint.
- If the goal is fully satisfied once this page's in-scope records are collected (e.g. "first page only" listing scrape), set done to true and nextHint to "".
- Do not paginate or open links that are outside the goal.`,
          pageExtractSchema,
        );

        const { kept, rejected } = groundExtractedItems(extracted.items, evidence);
        if (rejected > 0) {
          steps.push(
            `pass ${pass}: grounding rejected ${rejected}/${extracted.items.length} invented or ungrounded item(s)`,
          );
        }
        if (extracted.items.length > 0 && kept.length === 0) {
          throw new Error(
            `extract returned ${extracted.items.length} item(s) but none appear on the page — refusing hallucinated data`,
          );
        }

        let newCount = 0;
        for (const item of kept) {
          const key = itemKey(item);
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          collected.push(item);
          const title = itemTitle(item);
          if (title) pageTitles.push(title);
          newCount += 1;
        }

        pageDone = extracted.done;
        nextHint = extracted.nextHint.trim();
        pageSummaries.push(extracted.pageSummary);
        steps.push(
          `pass ${pass}/${maxExtractPasses}: ${kept.length} grounded, ${newCount} new (total ${collected.length}) — ${extracted.pageSummary}`,
        );

        if (newCount === 0) {
          steps.push(`pass ${pass}: no new grounded items; page extract complete`);
          break;
        }
        if (pass === maxExtractPasses) {
          steps.push(`pass budget reached (${maxExtractPasses}) for this page`);
        }
      }

      if (pageDone) {
        stopReason = "extract signaled done";
        steps.push(`stop: ${stopReason}`);
        break;
      }

      if (visit === maxPages - 1) {
        incomplete = true;
        stopReason = `page budget reached (${maxPages})`;
        steps.push(`stop: ${stopReason}`);
        break;
      }

      const navHint = nextHint || "the next page with more data for the goal";
      steps.push(`navigate: ${navHint}`);

      const beforeUrl = page.url();
      // Keep the instruction template stable; dynamic hint/visited list are necessary for nav.
      const agentResult = await agent.execute({
        instruction: `Navigate once toward unfinished work for this goal: ${target.goal}

Hint: ${navHint}
Already visited: ${pagesVisited.join(", ")}

Stay on this site's domain. Do not download files. Do not collect or summarize data — only navigate.
Respect the goal's scope (e.g. if the goal is first-page only, open in-scope detail links from that page, but do not advance list pagination).
Call done if nothing in-scope remains to visit.`,
        maxSteps: navMaxSteps,
      });

      if (agentResult.message) {
        steps.push(`nav message: ${agentResult.message}`);
      }

      const afterUrl = page.url();
      if (afterUrl === beforeUrl) {
        incomplete = true;
        stopReason = "navigation did not change URL";
        steps.push(`stop: ${stopReason}`);
        break;
      }

      if (pagesVisited.includes(afterUrl)) {
        incomplete = true;
        stopReason = `revisited URL after nav: ${afterUrl}`;
        steps.push(`stop: ${stopReason}`);
        break;
      }

      steps.push(`navigated to ${afterUrl}`);
    }

    const summary =
      pageSummaries.length > 0
        ? `Collected ${collected.length} item(s) across ${pagesVisited.length} page(s). ${pageSummaries.join(" ")}`
        : `Collected ${collected.length} item(s) across ${pagesVisited.length} page(s).`;

    steps.push(`finished: ${stopReason}; incomplete=${incomplete}; items=${collected.length}`);

    return {
      result: {
        items: collected,
        summary,
        pagesVisited,
        incomplete,
      },
      trace: steps.join("\n"),
    };
  } finally {
    await stagehand.close().catch(() => undefined);
  }
}

/**
 * Run a self-hosted Stagehand session (LOCAL, no Browserbase).
 * Credentials go through Stagehand `variables` (`%name%`) so the LLM never sees secret values.
 *
 * Login/nav actions are cached under cacheDir (selfHeal on). extract() still uses the LLM.
 * Local anti-detect (STAGEHAND_STEALTH, default on): system Chrome preference, AutomationControlled
 * disabled, realistic viewport/locale, non-Headless UA when headless, and a document-start init script.
 * Extractions are grounded against visible page text — invented values are dropped; all-invented
 * or blocked pages fail the run instead of storing fake data.
 * On hard failure or an empty incomplete result, clears the cache and retries once.
 */
export async function runScrape(
  target: ScrapeTarget,
  credentials: SiteCredentials | null,
): Promise<ScrapeOutcome> {
  const cacheDir = resolveCacheDir(target);
  const cacheExisted = existsSync(cacheDir);
  let repaired = false;

  while (true) {
    const cacheMode: CacheMode = repaired
      ? "repaired"
      : cacheExisted
        ? "hit"
        : "miss";

    try {
      const outcome = await runScrapeAttempt(
        target,
        credentials,
        cacheDir,
        cacheMode,
      );

      if (isUselessOutcome(outcome) && !repaired) {
        clearCacheDir(cacheDir);
        repaired = true;
        console.warn(
          `[scrape] cache useless for ${target.targetId}; cleared cache, re-exploring`,
        );
        continue;
      }

      return outcome;
    } catch (error) {
      if (!repaired) {
        clearCacheDir(cacheDir);
        repaired = true;
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[scrape] attempt failed for ${target.targetId} (${message}); cleared cache, re-exploring`,
        );
        continue;
      }
      throw error;
    }
  }
}
