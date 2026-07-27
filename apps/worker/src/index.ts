import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@benny/backend/api";
import { decryptJson, type SiteCredentials } from "./crypto";
import { runScrape } from "./scrape";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
config({ path: path.join(rootDir, ".env.local") });
config({ path: path.join(rootDir, ".env") });

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 3000);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function processOne(client: ConvexHttpClient, workerSecret: string): Promise<boolean> {
  const claimed = await client.mutation(api.runs.claimNext, { workerSecret });
  if (!claimed) {
    return false;
  }

  const { runId, target } = claimed;
  console.log(`[worker] claimed run ${runId} for ${target.url}`);

  try {
    const encrypted = await client.query(api.credentials.getEncryptedForWorker, {
      workerSecret,
      targetId: target._id,
    });

    let credentials: SiteCredentials | null = null;
    if (encrypted) {
      credentials = decryptJson<SiteCredentials>({
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
      });
    }

    const outcome = await runScrape(
      { targetId: target._id, url: target.url },
      credentials,
      async (opportunity) => {
        await client.mutation(api.opportunities.insert, {
          workerSecret,
          runId,
          targetId: target._id,
          ...opportunity,
        });
      },
      async (trace) => {
        await client.mutation(api.runs.setTrace, {
          workerSecret,
          runId,
          trace,
        });
      },
    );

    await client.mutation(api.runs.complete, {
      workerSecret,
      runId,
      status: "succeeded",
      trace: outcome.trace,
    });
    console.log(`[worker] run ${runId} succeeded — ${outcome.opportunityCount} opportunit(ies)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[worker] run ${runId} failed:`, message);
    await client.mutation(api.runs.complete, {
      workerSecret,
      runId,
      status: "failed",
      error: message,
    });
  }

  return true;
}

async function main() {
  const convexUrl = requireEnv("CONVEX_URL");
  const workerSecret = requireEnv("WORKER_SECRET");
  requireEnv("CREDENTIALS_ENCRYPTION_KEY");
  requireEnv("OPENAI_API_KEY");

  const client = new ConvexHttpClient(convexUrl);
  console.log("[worker] started — polling for pending runs");

  while (true) {
    try {
      const didWork = await processOne(client, workerSecret);
      if (!didWork) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    } catch (error) {
      console.error("[worker] poll error:", error);
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
