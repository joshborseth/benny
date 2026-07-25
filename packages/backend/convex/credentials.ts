import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { encryptJson, type SiteCredentials } from "./lib/crypto";

function assertWorkerSecret(secret: string) {
  const expected = process.env.WORKER_SECRET;
  if (!expected || secret !== expected) {
    throw new Error("Unauthorized worker");
  }
}

/** UI-safe: whether credentials exist for a target (never returns secrets). */
export const statusByTarget = query({
  args: { targetId: v.id("targets") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("credentials")
      .withIndex("by_target", (q) => q.eq("targetId", args.targetId))
      .unique();
    return { hasCredentials: existing !== null };
  },
});

/** Upsert encrypted username/password for a target. */
export const upsert = mutation({
  args: {
    targetId: v.id("targets"),
    username: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.targetId);
    if (!target) {
      throw new Error("Target not found");
    }

    const payload: SiteCredentials = {
      username: args.username,
      password: args.password,
    };
    const encrypted = await encryptJson(payload);

    const existing = await ctx.db
      .query("credentials")
      .withIndex("by_target", (q) => q.eq("targetId", args.targetId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
      });
      return existing._id;
    }

    return await ctx.db.insert("credentials", {
      targetId: args.targetId,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
    });
  },
});

export const remove = mutation({
  args: { targetId: v.id("targets") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("credentials")
      .withIndex("by_target", (q) => q.eq("targetId", args.targetId))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

/** Worker-only: fetch encrypted credential blob for a target. */
export const getEncryptedForWorker = query({
  args: {
    workerSecret: v.string(),
    targetId: v.id("targets"),
  },
  handler: async (ctx, args) => {
    assertWorkerSecret(args.workerSecret);
    return await ctx.db
      .query("credentials")
      .withIndex("by_target", (q) => q.eq("targetId", args.targetId))
      .unique();
  },
});
