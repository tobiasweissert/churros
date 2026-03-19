import { readDb, writeDb, type Pairing } from "./store";

export type { Pairing };

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Creates a new pairing record for the given channel and users, persists it, and returns
 * the auto-incremented pairing ID.
 */
export function insertPairing(
  channelId: string,
  userA: string,
  userB: string,
  dmChannel?: string
): number {
  const db = readDb();
  const id = db.nextPairingId++;
  db.pairings.push({
    id,
    channel_id: channelId,
    user_a: userA,
    user_b: userB,
    dm_channel: dmChannel ?? null,
    paired_at: new Date().toISOString(),
    met: null,
  });
  writeDb(db);
  return id;
}

/** Returns the user ID of the person left unpaired in the most recent round, or null. */
export function getLastLeftOut(): string | null {
  return readDb().lastLeftOut ?? null;
}

/** Stores the user ID of the person left out this round so they get priority next time. */
export function setLastLeftOut(userId: string | null): void {
  const db = readDb();
  db.lastLeftOut = userId;
  writeDb(db);
}

/** Returns all pairings for the given channel created since the most recent Monday (UTC). */
export function getCurrentWeekPairings(channelId: string): Pairing[] {
  const db = readDb();
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon, ...
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const lastMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday));
  return db.pairings.filter(
    (p) => p.channel_id === channelId && new Date(p.paired_at) >= lastMonday
  );
}

/**
 * Returns a nested map of user → partner → days since most recent pairing,
 * limited to pairings within the last `withinDays` days for the given channel.
 * Only the most recent pairing between any two users is retained.
 */
export function getPairingRecency(
  channelId: string,
  withinDays = 180
): Map<string, Map<string, number>> {
  const db = readDb();
  const cutoff = daysAgo(withinDays);
  const now = Date.now();
  const map = new Map<string, Map<string, number>>();

  for (const p of db.pairings) {
    if (p.channel_id !== channelId) continue;
    if (new Date(p.paired_at) < cutoff) continue;
    const daysSince = (now - new Date(p.paired_at).getTime()) / (24 * 60 * 60 * 1000);
    if (!map.has(p.user_a)) map.set(p.user_a, new Map());
    if (!map.has(p.user_b)) map.set(p.user_b, new Map());
    const aMap = map.get(p.user_a)!;
    const bMap = map.get(p.user_b)!;
    // Keep only the most recent pairing (smallest daysSince)
    if (!aMap.has(p.user_b) || daysSince < aMap.get(p.user_b)!) {
      aMap.set(p.user_b, daysSince);
    }
    if (!bMap.has(p.user_a) || daysSince < bMap.get(p.user_a)!) {
      bMap.set(p.user_a, daysSince);
    }
  }
  return map;
}
