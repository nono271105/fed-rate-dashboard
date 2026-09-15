import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { ecbSnapshots, fedSnapshots, InsertEcbSnapshot, InsertFedSnapshot, InsertUser, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try { _db = drizzle(process.env.DATABASE_URL); } catch (error) { console.warn("[Database] Failed to connect:", error); _db = null; }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb(); if (!db) return;
  const values: InsertUser = { openId: user.openId }; const updateSet: Record<string, unknown> = {};
  for (const field of ["name", "email", "loginMethod"] as const) { if (user[field] !== undefined) { values[field] = user[field] ?? null; updateSet[field] = user[field] ?? null; } }
  if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
  if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; } else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
  values.lastSignedIn ??= new Date(); if (!Object.keys(updateSet).length) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) { const db = await getDb(); if (!db) return undefined; const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1); return result[0]; }

export async function saveFedSnapshot(snapshot: InsertFedSnapshot) { const db = await getDb(); if (!db) return; await db.insert(fedSnapshots).values(snapshot).onDuplicateKeyUpdate({ set: { source: snapshot.source, payload: snapshot.payload, updatedAt: new Date() } }); }
export async function getLatestFedSnapshot() { const db = await getDb(); if (!db) return undefined; const rows = await db.select().from(fedSnapshots).orderBy(desc(fedSnapshots.snapshotDate)).limit(1); return rows[0]; }
export async function getFedSnapshotHistory(limit = 30) { const db = await getDb(); if (!db) return []; return db.select().from(fedSnapshots).orderBy(desc(fedSnapshots.snapshotDate)).limit(limit); }

export async function saveEcbSnapshot(snapshot: InsertEcbSnapshot) { const db = await getDb(); if (!db) return; await db.insert(ecbSnapshots).values(snapshot).onDuplicateKeyUpdate({ set: { source: snapshot.source, payload: snapshot.payload, updatedAt: new Date() } }); }
export async function getLatestEcbSnapshot() { const db = await getDb(); if (!db) return undefined; const rows = await db.select().from(ecbSnapshots).orderBy(desc(ecbSnapshots.snapshotDate)).limit(1); return rows[0]; }
export async function getEcbSnapshotHistory(limit = 30) { const db = await getDb(); if (!db) return []; return db.select().from(ecbSnapshots).orderBy(desc(ecbSnapshots.snapshotDate)).limit(limit); }
