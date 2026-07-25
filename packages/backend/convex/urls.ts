import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("urls").order("desc").collect();
  },
});

export const create = mutation({
  args: {
    url: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("urls", {
      url: args.url,
      enabled: args.enabled,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("urls"),
    url: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error("URL not found");
    }
    await ctx.db.replace(args.id, {
      url: args.url,
      enabled: args.enabled,
    });
  },
});

export const remove = mutation({
  args: {
    id: v.id("urls"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
