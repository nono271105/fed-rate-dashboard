import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { ecbSnapshots, fedSnapshots, InsertEcbSnapshot, InsertFedSnapshot } from "../drizzle/schema";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try { _db = drizzle(process.env.DATABASE_URL); } catch (error) { console.warn("[Database] Failed to connect:", error); _db = null; }
  }
  return _db;
}

export async function saveFedSnapshot(snapshot: InsertFedSnapshot) { const db = await getDb(); if (!db) return; await db.insert(fedSnapshots).values(snapshot).onDuplicateKeyUpdate({ set: { source: snapshot.source, payload: snapshot.payload, updatedAt: new Date() } }); }
export async function getLatestFedSnapshot() { const db = await getDb(); if (!db) return undefined; const rows = await db.select().from(fedSnapshots).orderBy(desc(fedSnapshots.snapshotDate)).limit(1); return rows[0]; }
export async function getFedSnapshotHistory(limit = 30) { const db = await getDb(); if (!db) return []; return db.select().from(fedSnapshots).orderBy(desc(fedSnapshots.snapshotDate)).limit(limit); }

export async function saveEcbSnapshot(snapshot: InsertEcbSnapshot) { const db = await getDb(); if (!db) return; await db.insert(ecbSnapshots).values(snapshot).onDuplicateKeyUpdate({ set: { source: snapshot.source, payload: snapshot.payload, updatedAt: new Date() } }); }
export async function getLatestEcbSnapshot() { const db = await getDb(); if (!db) return undefined; const rows = await db.select().from(ecbSnapshots).orderBy(desc(ecbSnapshots.snapshotDate)).limit(1); return rows[0]; }
export async function getEcbSnapshotHistory(limit = 30) { const db = await getDb(); if (!db) return []; return db.select().from(ecbSnapshots).orderBy(desc(ecbSnapshots.snapshotDate)).limit(limit); }
