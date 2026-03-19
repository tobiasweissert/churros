import { readDb, writeDb } from "./store";
import type { SnoozeEntry } from "./store";

/** Temporarily snooze a user for 1–4 weeks. */
export function snoozeUser(userId: string, weeks: 1 | 2 | 3 | 4): void {
  const db = readDb();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + weeks * 7);
  db.snoozedUsers[userId] = {
    type: "temporary",
    expires_at: expiresAt.toISOString(),
    created_at: new Date().toISOString(),
  };
  writeDb(db);
}

/** Permanently opt a user out of pairings. */
export function optOutUser(userId: string): void {
  const db = readDb();
  db.snoozedUsers[userId] = {
    type: "permanent",
    expires_at: null,
    created_at: new Date().toISOString(),
  };
  writeDb(db);
}

/** Remove a user's snooze/opt-out entry entirely, re-enabling them. */
export function unsnoozeUser(userId: string): void {
  const db = readDb();
  delete db.snoozedUsers[userId];
  writeDb(db);
}

/** Returns true if the user is currently snoozed (temporary and not expired, or permanent). */
export function isUserSnoozed(userId: string): boolean {
  const entry = getUserSnoozeEntry(userId);
  if (!entry) return false;
  if (entry.type === "permanent") return true;
  if (entry.expires_at && new Date(entry.expires_at) > new Date()) return true;
  return false;
}

/** Returns the user's snooze entry, or null if none exists. */
export function getUserSnoozeEntry(userId: string): SnoozeEntry | null {
  const db = readDb();
  return db.snoozedUsers[userId] ?? null;
}

/** Removes all expired temporary snooze entries from the DB. */
export function cleanExpiredSnoozes(): void {
  const db = readDb();
  const now = new Date();
  let changed = false;
  for (const [userId, entry] of Object.entries(db.snoozedUsers)) {
    if (entry.type === "temporary" && entry.expires_at && new Date(entry.expires_at) <= now) {
      delete db.snoozedUsers[userId];
      changed = true;
    }
  }
  if (changed) writeDb(db);
}
