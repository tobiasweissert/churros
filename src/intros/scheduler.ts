import cron from "node-cron";
import type { App } from "@slack/bolt";
import { getConfig } from "../db/config";
import { readDb, writeDb } from "../db/store";
import { getCurrentWeekPairings } from "../db/pairings";
import { runIntros } from "./runner";
import { buildReminderMessage } from "./messages";

/**
 * Starts a daily cron that:
 * - Fires once per day at config.hour_utc
 * - Checks if the current UTC day matches config.day_of_week
 * - Enforces frequency gaps (biweekly ≥ 13 days, monthly ≥ 27 days)
 * - Runs intros and records lastPairingRunAt
 * - Sends nudge reminders 3 days after the last pairing run
 */
export async function startScheduler(app: App): Promise<void> {
  const authResult = await app.client.auth.test();
  const botUserId = authResult.user_id as string;

  const initialConfig = getConfig();
  const hour = initialConfig?.hour_utc ?? 9;

  // Daily tick at the configured hour — evaluate whether to run pairings or nudges
  cron.schedule(`0 ${hour} * * *`, async () => {
    const config = getConfig();
    if (!config || !config.enabled) return;

    const now = new Date();
    const currentDay = now.getUTCDay();
    const db = readDb();

    // --- Pairing run check ---
    if (currentDay === config.day_of_week) {
      let shouldRun = true;

      if (db.lastPairingRunAt) {
        const daysSinceLast = (now.getTime() - new Date(db.lastPairingRunAt).getTime()) / (1000 * 60 * 60 * 24);
        if (config.frequency === "biweekly" && daysSinceLast < 13) shouldRun = false;
        if (config.frequency === "monthly" && daysSinceLast < 27) shouldRun = false;
      }

      if (shouldRun) {
        console.log(`[scheduler] Running intros (${config.frequency}) at day=${currentDay} hour=${hour} UTC`);
        try {
          await runIntros(app);
          const freshDb = readDb();
          freshDb.lastPairingRunAt = now.toISOString();
          writeDb(freshDb);
        } catch (err) {
          console.error("[scheduler] Error running intros:", err);
        }
        // Skip nudge check on days we run pairings — pairs were just created
        return;
      }
    }

    // --- Nudge check: 3 days after lastPairingRunAt ---
    if (db.lastPairingRunAt) {
      const daysSinceLast = (now.getTime() - new Date(db.lastPairingRunAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLast >= 3 && daysSinceLast < 4) {
        console.log("[scheduler] Sending nudge reminders (3 days after pairing)");
        const pairings = getCurrentWeekPairings(config.channel_id);
        for (const pairing of pairings) {
          if (!pairing.dm_channel) continue;
          try {
            const history = await app.client.conversations.history({
              channel: pairing.dm_channel,
              limit: 20,
            });
            const messages = history.messages ?? [];
            const hasUserMessage = messages.some(
              (m) => m.bot_id === undefined && m.user !== botUserId
            );
            if (!hasUserMessage) {
              await app.client.chat.postMessage({
                channel: pairing.dm_channel,
                text: buildReminderMessage(pairing.user_a, pairing.user_b),
              });
              console.log(`[scheduler] Sent reminder to DM ${pairing.dm_channel}`);
            }
          } catch (err) {
            console.error(`[scheduler] Error checking pair ${pairing.id}:`, err);
          }
        }
      }
    }
  });

  console.log(`[scheduler] Started — daily check at ${hour}:00 UTC, respecting frequency config`);
}
