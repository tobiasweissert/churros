import fs from "fs";
import path from "path";

const DB_PATH = path.resolve(process.env.DB_PATH ?? "./churros.json");

export interface Pairing {
  id: number;
  channel_id: string;
  user_a: string;
  user_b: string;
  dm_channel: string | null;
  paired_at: string;
  met: boolean | null;
}

export interface IntrosConfig {
  channel_id: string;     // Slack channel to pull members from
  workspace_id: string;
  frequency: "weekly" | "biweekly" | "monthly";
  day_of_week: number;    // 0=Sun … 6=Sat
  hour_utc: number;
  enabled: boolean;
}

export interface SnoozeEntry {
  type: "temporary" | "permanent";
  expires_at: string | null;  // ISO timestamp, null for permanent
  created_at: string;
}

export interface DB {
  config: IntrosConfig | null;
  pairings: Pairing[];
  nextPairingId: number;
  lastLeftOut: string | null;  // user_id of the person left out last round
  snoozedUsers: Record<string, SnoozeEntry>;
  lastPairingRunAt: string | null;
}

/** Returns a fresh, empty DB object used when no data file exists yet. */
function empty(): DB {
  return {
    config: null,
    pairings: [],
    nextPairingId: 1,
    lastLeftOut: null,
    snoozedUsers: {},
    lastPairingRunAt: null,
  };
}

/** Reads and parses the JSON database from disk. Returns an empty DB on missing or corrupt file. */
export function readDb(): DB {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_PATH, "utf8")) as DB & { mutedUsers?: string[] };
    // Migration: convert old mutedUsers array to snoozedUsers record
    if (raw.mutedUsers && !raw.snoozedUsers) {
      raw.snoozedUsers = {};
      for (const userId of raw.mutedUsers) {
        raw.snoozedUsers[userId] = {
          type: "permanent",
          expires_at: null,
          created_at: new Date().toISOString(),
        };
      }
      delete raw.mutedUsers;
      fs.writeFileSync(DB_PATH, JSON.stringify(raw, null, 2), "utf8");
    }
    if (!raw.snoozedUsers) raw.snoozedUsers = {};
    if (raw.lastPairingRunAt === undefined) raw.lastPairingRunAt = null;
    return raw as DB;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn("[churros] Failed to read DB — starting with empty state:", err);
    }
    return empty();
  }
}

/** Serializes the DB object and writes it to disk as formatted JSON (atomic write via tmp file + rename). */
export function writeDb(db: DB): void {
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tmp, DB_PATH);
}
