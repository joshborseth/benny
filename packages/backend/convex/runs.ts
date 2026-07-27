import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

function assertWorkerSecret(secret: string) {
  const expected = process.env.WORKER_SECRET;
  if (!expected || secret !== expected) {
    throw new Error("Unauthorized worker");
  }
}

export const listByTarget = query({
  args: { targetId: v.id("targets") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("runs")
      .withIndex("by_target", (q) => q.eq("targetId", args.targetId))
      .order("desc")
      .take(50);
  },
});

export const listRecent = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("runs").order("desc").take(50);
  },
});

export const get = query({
  args: { id: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.id);
    if (!run) {
      return null;
    }
    const target = await ctx.db.get(run.targetId);
    return { ...run, target };
  },
});

/** Enqueue a scrape run for a target. */
export const enqueue = mutation({
  args: { targetId: v.id("targets") },
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.targetId);
    if (!target) {
      throw new Error("Target not found");
    }
    return await ctx.db.insert("runs", {
      targetId: args.targetId,
      status: "pending",
    });
  },
});

/**
 * Worker claims the oldest pending run.
 * Returns run + target, or null if none.
 */
export const claimNext = mutation({
  args: { workerSecret: v.string() },
  handler: async (ctx, args) => {
    assertWorkerSecret(args.workerSecret);

    const pending = await ctx.db
      .query("runs")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("asc")
      .first();

    if (!pending) {
      return null;
    }

    const target = await ctx.db.get(pending.targetId);
    if (!target) {
      await ctx.db.patch(pending._id, {
        status: "failed",
        error: "Target missing",
        finishedAt: Date.now(),
      });
      return null;
    }

    await ctx.db.patch(pending._id, {
      status: "running",
      startedAt: Date.now(),
    });

    return {
      runId: pending._id,
      target: {
        _id: target._id,
        url: target.url,
        goal: target.goal,
        enabled: target.enabled,
      },
    };
  },
});

export const complete = mutation({
  args: {
    workerSecret: v.string(),
    runId: v.id("runs"),
    status: v.union(v.literal("succeeded"), v.literal("failed")),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    trace: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertWorkerSecret(args.workerSecret);
    const run = await ctx.db.get(args.runId);
    if (!run) {
      throw new Error("Run not found");
    }
    await ctx.db.patch(args.runId, {
      status: args.status,
      result: args.result,
      error: args.error,
      trace: args.trace,
      finishedAt: Date.now(),
    });
  },
});
