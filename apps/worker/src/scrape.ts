import { Stagehand } from "@browserbasehq/stagehand";
import { chromium } from "playwright-core";
import { z } from "zod";
import type { SiteCredentials } from "./crypto";

const extractSchema = z.object({
  data: z.unknown().describe("Structured data collected for the scrape goal"),
  summary: z.string().describe("Short summary of what was collected"),
});

export type ScrapeTarget = {
  url: string;
  goal: string;
};

export type ScrapeOutcome = {
  result: z.infer<typeof extractSchema>;
  trace: string;
};

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

/**
 * Run a self-hosted Stagehand session (LOCAL, no Browserbase).
 * Credentials go through Stagehand `variables` (`%name%`) so the LLM never sees secret values.
 */
export async function runScrape(
  target: ScrapeTarget,
  credentials: SiteCredentials | null,
): Promise<ScrapeOutcome> {
  const model = process.env.STAGEHAND_MODEL ?? "openai/gpt-4o";
  const headless = process.env.STAGEHAND_HEADLESS !== "false";
  const executablePath = resolveChromePath();

  const stagehand = new Stagehand({
    env: "LOCAL",
    model,
    // Keep verbose off when secrets are in play so Stagehand doesn't log variable values.
    verbose: credentials ? 0 : 1,
    localBrowserLaunchOptions: {
      headless,
      ...(executablePath ? { executablePath } : {}),
    },
  });

  const steps: string[] = [];

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
      await stagehand.act("Type %username% into the username or email field", {
        variables: { username: credentials.username },
      });
      await stagehand.act(
        "Type %password% into the password field, then submit the login form",
        { variables: { password: credentials.password } },
      );
      steps.push("login actions completed");
    }

    const agent = stagehand.agent();
    steps.push(`agent: ${target.goal}`);
    const agentResult = await agent.execute({
      instruction: `${target.goal}

Stay on this site's domain. Do not download files. When finished, the needed data should be visible on the page.`,
      maxSteps: Number(process.env.STAGEHAND_MAX_STEPS ?? 20),
    });

    if (agentResult.message) {
      steps.push(`agent message: ${agentResult.message}`);
    }

    const extracted = await stagehand.extract(
      `Extract the data needed for this goal as structured JSON: ${target.goal}`,
      extractSchema,
    );

    return {
      result: extracted,
      trace: steps.join("\n"),
    };
  } finally {
    await stagehand.close().catch(() => undefined);
  }
}
