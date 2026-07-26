import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Stagehand } from "@browserbasehq/stagehand";
import { chromium } from "playwright-core";
import { z } from "zod";
import type { SiteCredentials } from "./crypto";

const pageExtractSchema = z.object({
  items: z
    .array(z.record(z.string(), z.unknown()))
    .describe("Records/data found on this page for the goal"),
  pageSummary: z.string().describe("Short summary of what was found on this page"),
  done: z
    .boolean()
    .describe("True if no more relevant pages remain for the goal"),
  nextHint: z
    .string()
    .describe(
      "Where to go next when done is false (e.g. next pagination, first unvisited detail row)",
    ),
});

const scrapeResultSchema = z.object({
  items: z.array(z.unknown()).describe("All records collected across pages"),
  summary: z.string().describe("Short summary of the overall scrape"),
  pagesVisited: z.array(z.string()).describe("URLs visited during the scrape"),
  incomplete: z
    .boolean()
    .describe("True if stopped due to budget or stuck navigation rather than done"),
});

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

function resolveChromePath(): string | undefined {
  if (process.env.CHROME_PATH) {
    return process.env.CHROME_PATH;
  }
  // Prefer Playwright's bundled Chromium so system Chrome isn't required.
  try {
    return chromium.executablePath();
  } catch {
    return undefined;
  }
}

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

async function runScrapeAttempt(
  target: ScrapeTarget,
  credentials: SiteCredentials | null,
  cacheDir: string,
  cacheMode: CacheMode,
): Promise<ScrapeOutcome> {
  const model = process.env.STAGEHAND_MODEL ?? "openai/gpt-4o";
  const headless = process.env.STAGEHAND_HEADLESS !== "false";
  const maxPages = Number(process.env.STAGEHAND_MAX_PAGES ?? 10);
  const navMaxSteps = Number(process.env.STAGEHAND_NAV_MAX_STEPS ?? 6);
  const executablePath = resolveChromePath();

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
      ...(executablePath ? { executablePath } : {}),
    },
  });

  const steps: string[] = [
    `cacheDir=${cacheDir}`,
    `cacheMode=${cacheMode}`,
  ];
  const collected: unknown[] = [];
  const seenKeys = new Set<string>();
  const pagesVisited: string[] = [];
  const pageSummaries: string[] = [];
  let incomplete = false;
  let stopReason = "done";

  try {
    await stagehand.init();
    const page = stagehand.context.pages()[0];
    if (!page) {
      throw new Error("Stagehand did not open a browser page");
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

      const extracted = await stagehand.extract(
        `Extract all data relevant to this goal from the CURRENT page only (do not invent data from other pages): ${target.goal}

If there are more relevant pages to visit (pagination, detail links, related sections), set done to false and put a concrete navigation hint in nextHint. If this page covers everything still needed, set done to true.`,
        pageExtractSchema,
      );

      let newCount = 0;
      for (const item of extracted.items) {
        const key = itemKey(item);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        collected.push(item);
        newCount += 1;
      }

      pageSummaries.push(extracted.pageSummary);
      steps.push(
        `extract: ${extracted.items.length} item(s), ${newCount} new (total ${collected.length}) — ${extracted.pageSummary}`,
      );

      if (extracted.done) {
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

      const nextHint = extracted.nextHint.trim() || "the next page with more data for the goal";
      steps.push(`navigate: ${nextHint}`);

      const beforeUrl = page.url();
      // Keep the instruction template stable; dynamic hint/visited list are necessary for nav.
      const agentResult = await agent.execute({
        instruction: `Navigate to the next page that still has data for: ${target.goal}

Hint: ${nextHint}
Already visited: ${pagesVisited.join(", ")}

Stay on this site's domain. Do not download files. Do not try to collect or summarize data — only navigate. Call done if nothing left to visit.`,
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
