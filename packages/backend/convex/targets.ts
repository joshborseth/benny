import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("targets").order("desc").collect();
  },
});

export const get = query({
  args: { id: v.id("targets") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    url: v.string(),
    goal: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("targets", {
      url: args.url,
      goal: args.goal,
      enabled: args.enabled,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("targets"),
    url: v.string(),
    goal: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error("Target not found");
    }
    await ctx.db.replace(args.id, {
      url: args.url,
      goal: args.goal,
      enabled: args.enabled,
    });
  },
});

export const remove = mutation({
  args: {
    id: v.id("targets"),
  },
  handler: async (ctx, args) => {
    const creds = await ctx.db
      .query("credentials")
      .withIndex("by_target", (q) => q.eq("targetId", args.id))
      .collect();
    for (const cred of creds) {
      await ctx.db.delete(cred._id);
    }

    const runs = await ctx.db
      .query("runs")
      .withIndex("by_target", (q) => q.eq("targetId", args.id))
      .collect();
    for (const run of runs) {
      await ctx.db.delete(run._id);
    }

    await ctx.db.delete(args.id);
  },
});
