// src/lib/schema.ts
import { pgTable, bigserial, text, inet, timestamp, boolean } from "drizzle-orm/pg-core";

export const cowrieCommands = pgTable("cowrie_commands", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  sessionId: text("session_id").notNull(),
  ts: timestamp("ts", { withTimezone: true }).notNull(),
  srcIp: inet("src_ip").notNull(),
  command: text("command").notNull(),
  failed: boolean("failed"),
});
