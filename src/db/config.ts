import { readDb, writeDb, type IntrosConfig } from "./store";

export type { IntrosConfig };

/**
 * Returns the current IntrosConfig. Reads from the DB first; falls back to a default
 * config built from the CHANNEL_ID env var if no stored config exists. Returns null
 * if neither source is available.
 */
export function getConfig(): IntrosConfig | null {
  const stored = readDb().config;
  if (stored) return stored;
  const channelId = process.env.CHANNEL_ID;
  if (!channelId) return null;
  return {
    channel_id: channelId,
    workspace_id: "",
    frequency: "weekly",
    day_of_week: 1,
    hour_utc: 10,
    enabled: true,
  };
}

/** Replaces the stored config with the given value and persists it to disk. */
export function setConfig(config: IntrosConfig): void {
  const db = readDb();
  db.config = config;
  writeDb(db);
}

/** Merges patch into the existing config and persists it. Throws if no config has been set yet. */
export function updateConfig(patch: Partial<IntrosConfig>): void {
  const db = readDb();
  if (!db.config) throw new Error("No config set yet");
  db.config = { ...db.config, ...patch };
  writeDb(db);
}
