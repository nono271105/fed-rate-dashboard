import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

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

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type FedSnapshot = typeof fedSnapshots.$inferSelect;
export type InsertFedSnapshot = typeof fedSnapshots.$inferInsert;
export type EcbSnapshot = typeof ecbSnapshots.$inferSelect;
export type InsertEcbSnapshot = typeof ecbSnapshots.$inferInsert;
