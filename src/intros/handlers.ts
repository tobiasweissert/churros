import type { App } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { getConfig, setConfig, updateConfig } from "../db/config";
import { snoozeUser, optOutUser, unsnoozeUser } from "../db/snooze";
import { runIntros } from "./runner";
import { buildWelcomeMessage } from "./messages";

async function sendDm(client: WebClient, userId: string, text: string): Promise<void> {
  const { channel } = await client.conversations.open({ users: userId });
  if (channel?.id) await client.chat.postMessage({ channel: channel.id, text });
}

/**
 * Registers all Slack event and command handlers on the app instance.
 * Handles /churros subcommands (enable, disable, run, status, frequency, snooze, unsnooze)
 * and channel membership events (member_joined_channel, member_left_channel).
 */
export function registerIntroHandlers(app: App): void {
  app.command("/churros", async ({ command, ack, respond, client }) => {
    await ack();
    const parts = command.text.trim().split(/\s+/);
    const subcommand = parts[0];

    // /churros enable <channel-id>
    if (subcommand === "enable") {
      const channelId = parts[1] ?? command.channel_id;
      if (!/^[CG][A-Z0-9]{6,}$/.test(channelId)) {
        await respond(`Invalid channel ID: \`${channelId}\`. Please provide a valid Slack channel ID (e.g. \`C0123456789\`).`);
        return;
      }
      setConfig({
        channel_id: channelId,
        workspace_id: command.team_id ?? "",
        frequency: "biweekly",
        day_of_week: 1,
        hour_utc: 9,
        enabled: true,
      });
      try {
        await client.conversations.join({ channel: channelId });
      } catch (err) {
        const errCode = (err as { data?: { error?: string } })?.data?.error;
        if (errCode !== "already_in_channel") {
          console.error("[churros] conversations.join failed:", err);
          if (errCode === "method_not_supported_for_channel_type" || errCode === "is_private") {
            await respond(
              `Churros enabled for <#${channelId}>, but I couldn't join automatically because it's a private channel. Please manually invite me by typing \`/invite @churros\` in that channel so I can receive join events.`
            );
          } else {
            await respond(
              `Churros enabled for <#${channelId}>, but I failed to join the channel (${errCode ?? "unknown error"}). Please manually invite me by typing \`/invite @churros\` in that channel.`
            );
          }
          return;
        }
      }
      await respond(`Churros enabled! Pairing everyone in <#${channelId}> bi-weekly.`);
      return;
    }

    if (subcommand === "disable") {
      updateConfig({ enabled: false });
      await respond("Churros paused. No new pairings will run.");
      return;
    }

    if (subcommand === "run") {
      const config = getConfig();
      if (!config) {
        await respond("No channel configured yet. Run `/churros enable` first.");
        return;
      }
      await respond("Running intros now...");
      try {
        await runIntros(app);
        await respond("Done! Intro messages have been sent.");
      } catch (err) {
        console.error("[churros] runIntros failed:", err);
        await respond("Something went wrong while running intros. Please check the server logs.");
      }
      return;
    }

    if (subcommand === "status") {
      const config = getConfig();
      if (!config) {
        await respond("No config set. Use `/churros enable` to get started.");
        return;
      }
      await respond(
        `*Churros status*\nChannel: <#${config.channel_id}>\nFrequency: ${config.frequency}\nEnabled: ${config.enabled ? "yes" : "no"}`
      );
      return;
    }

    if (subcommand === "frequency") {
      const config = getConfig();
      if (!config) {
        await respond("No channel configured yet. Run `/churros enable` first.");
        return;
      }
      await respond({
        text: "How often should I pair people up?",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*How often should I pair people up?*\nCurrently set to: *${config.frequency}*`,
            },
          },
          {
            type: "actions",
            block_id: "churros_frequency_picker",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Weekly" },
                action_id: "churros_frequency_weekly",
                style: config.frequency === "weekly" ? "primary" : undefined,
              },
              {
                type: "button",
                text: { type: "plain_text", text: "Bi-weekly" },
                action_id: "churros_frequency_biweekly",
                style: config.frequency === "biweekly" ? "primary" : undefined,
              },
              {
                type: "button",
                text: { type: "plain_text", text: "Monthly" },
                action_id: "churros_frequency_monthly",
                style: config.frequency === "monthly" ? "primary" : undefined,
              },
            ],
          },
        ],
      });
      return;
    }

    // /churros snooze [1-4|off]
    // "off" = permanent opt-out; number = weeks; default = 2 weeks
    if (subcommand === "snooze") {
      const arg = parts[1];
      if (arg === "off") {
        optOutUser(command.user_id);
        await respond(
          "You've been permanently opted out of pairings. Use `/churros unsnooze` to rejoin anytime."
        );
      } else {
        const weeks = Math.min(4, Math.max(1, parseInt(arg ?? "2", 10) || 2)) as 1 | 2 | 3 | 4;
        snoozeUser(command.user_id, weeks);
        await respond(
          `You've been snoozed for ${weeks} week${weeks > 1 ? "s" : ""}. Use \`/churros unsnooze\` to rejoin earlier.`
        );
      }
      return;
    }

    if (subcommand === "unsnooze") {
      unsnoozeUser(command.user_id);
      await respond("You're back in! You'll be included in future pairings again.");
      return;
    }

    await respond(
      "Usage:\n• `/churros enable [channel]` — enable pairings for a channel\n• `/churros disable` — pause pairings\n• `/churros run` — run pairings immediately\n• `/churros status` — show current config\n• `/churros frequency` — change how often pairings run\n• `/churros snooze [1-4]` — skip pairings for 1–4 weeks (default 2)\n• `/churros snooze off` — permanently opt out\n• `/churros unsnooze` — opt back in"
    );
  });

  app.event("member_left_channel", async ({ event, client }) => {
    try {
      const config = getConfig();
      if (!config || event.channel !== config.channel_id) return;
      await sendDm(
        client,
        event.user,
        `Sad to see you go! 😢 Whenever you want intros again, just rejoin <#${config.channel_id}>.`
      );
    } catch (err) {
      console.error("[churros] member_left_channel error:", err);
    }
  });

  app.event("member_joined_channel", async ({ event, client }) => {
    try {
      const config = getConfig();
      if (!config || event.channel !== config.channel_id) return;
      await sendDm(client, event.user, buildWelcomeMessage(config.channel_id, config.frequency));
    } catch (err) {
      console.error("[churros] member_joined_channel error:", err);
    }
  });

  const frequencyLabels: Record<string, string> = {
    weekly: "Weekly",
    biweekly: "Bi-weekly",
    monthly: "Monthly",
  };

  for (const [value, label] of Object.entries(frequencyLabels)) {
    app.action(`churros_frequency_${value}`, async ({ ack, respond }) => {
      await ack();
      updateConfig({ frequency: value as "weekly" | "biweekly" | "monthly" });
      await respond(`Got it! I'll pair people up *${label.toLowerCase()}* from now on.`);
    });
  }
}
