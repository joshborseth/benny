import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const runStatus = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
);

export default defineSchema({
  targets: defineTable({
    url: v.string(),
    goal: v.string(),
    enabled: v.boolean(),
  }),

  credentials: defineTable({
    targetId: v.id("targets"),
    /** AES-256-GCM ciphertext (base64) of JSON `{ username, password }`. */
    ciphertext: v.string(),
    /** AES-GCM IV (base64). */
    iv: v.string(),
  }).index("by_target", ["targetId"]),

  runs: defineTable({
    targetId: v.id("targets"),
    status: runStatus,
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    trace: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_target", ["targetId"]),
});
