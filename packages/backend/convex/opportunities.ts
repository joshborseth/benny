import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

function assertWorkerSecret(secret: string) {
  const expected = process.env.WORKER_SECRET;
  if (!expected || secret !== expected) {
    throw new Error("Unauthorized worker");
  }
}

export const listByRun = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("opportunities")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("opportunities") },
  handler: async (ctx, args) => {
    const opportunity = await ctx.db.get(args.id);
    if (!opportunity) {
      return null;
    }
    const target = await ctx.db.get(opportunity.targetId);
    return { ...opportunity, target };
  },
});

/** Worker inserts one opportunity as soon as its detail page is scraped. */
export const insert = mutation({
  args: {
    workerSecret: v.string(),
    runId: v.id("runs"),
    targetId: v.id("targets"),
    title: v.string(),
    url: v.optional(v.string()),
    description: v.optional(v.string()),
    agency: v.optional(v.string()),
    deadline: v.optional(v.string()),
    location: v.optional(v.string()),
    amount: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertWorkerSecret(args.workerSecret);
    const { workerSecret: _workerSecret, ...opportunity } = args;
    return await ctx.db.insert("opportunities", opportunity);
  },
});
