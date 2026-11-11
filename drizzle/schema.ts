import { int, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const fedSnapshots = mysqlTable("fed_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  snapshotDate: varchar("snapshotDate", { length: 10 }).notNull().unique(),
  source: varchar("source", { length: 32 }).notNull(),
  payload: text("payload").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const ecbSnapshots = mysqlTable("ecb_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  snapshotDate: varchar("snapshotDate", { length: 10 }).notNull().unique(),
  source: varchar("source", { length: 32 }).notNull(),
  payload: text("payload").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FedSnapshot = typeof fedSnapshots.$inferSelect;
export type InsertFedSnapshot = typeof fedSnapshots.$inferInsert;
export type EcbSnapshot = typeof ecbSnapshots.$inferSelect;
export type InsertEcbSnapshot = typeof ecbSnapshots.$inferInsert;
