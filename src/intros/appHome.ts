import type { App } from "@slack/bolt";
import { getConfig } from "../db/config";
import { getUserSnoozeEntry, snoozeUser, optOutUser, unsnoozeUser } from "../db/snooze";

/** Builds and publishes the App Home view for a given user. */
async function publishHomeView(app: App, userId: string): Promise<void> {
  const config = getConfig();
  const entry = getUserSnoozeEntry(userId);

  const activeText = ":white_check_mark: *Active* — you'll be included in upcoming pairings.";
  const isSnoozed =
    !!entry &&
    (entry.type === "permanent" ||
      (!!entry.expires_at && new Date(entry.expires_at) > new Date()));

  let statusText: string;
  if (!isSnoozed) {
    statusText = activeText;
  } else if (entry!.type === "permanent") {
    statusText = ":no_entry: *Opted out* — you won't be included in pairings.";
  } else {
    const until = new Date(entry!.expires_at!).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    statusText = `:zzz: *Snoozed* until ${until}.`;
  }

  const frequencyDisplay = config ? config.frequency : "not configured";

  const blocks: object[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Churros — Coffee Chat Pairings" },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Your Status*\n${statusText}` },
    },
    { type: "divider" },
  ];

  if (!isSnoozed) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*Snooze pairings for a while?*" },
    });
    blocks.push({
      type: "actions",
      block_id: "churros_home_snooze",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "1 week" },
          action_id: "churros_home_snooze_1",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "2 weeks" },
          action_id: "churros_home_snooze_2",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "3 weeks" },
          action_id: "churros_home_snooze_3",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "4 weeks" },
          action_id: "churros_home_snooze_4",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Opt out permanently" },
          action_id: "churros_home_optout",
          style: "danger",
          confirm: {
            title: { type: "plain_text", text: "Are you sure?" },
            text: { type: "mrkdwn", text: "You'll be permanently removed from pairings. You can rejoin anytime." },
            confirm: { type: "plain_text", text: "Opt out" },
            deny: { type: "plain_text", text: "Cancel" },
          },
        },
      ],
    });
  } else {
    blocks.push({
      type: "actions",
      block_id: "churros_home_unsnooze",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Rejoin pairings" },
          action_id: "churros_home_unsnooze",
          style: "primary",
        },
      ],
    });
  }

  blocks.push({ type: "divider" });
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*Current pairing frequency:* ${frequencyDisplay}\n_An admin can change this with \`/churros frequency\`._`,
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.client.views.publish({
    user_id: userId,
    view: {
      type: "home",
      blocks: blocks as any,
    },
  });
}

/** Registers the App Home tab event and action handlers. */
export function registerAppHome(app: App): void {
  app.event("app_home_opened", async ({ event }) => {
    if (event.tab !== "home") return;
    try {
      await publishHomeView(app, event.user);
    } catch (err) {
      console.error("[churros] app_home_opened error:", err);
    }
  });

  for (const weeks of [1, 2, 3, 4] as const) {
    app.action(`churros_home_snooze_${weeks}`, async ({ ack, body }) => {
      await ack();
      const userId = body.user.id;
      snoozeUser(userId, weeks);
      try {
        await publishHomeView(app, userId);
      } catch (err) {
        console.error("[churros] snooze action error:", err);
      }
    });
  }

  app.action("churros_home_optout", async ({ ack, body }) => {
    await ack();
    const userId = body.user.id;
    optOutUser(userId);
    try {
      await publishHomeView(app, userId);
    } catch (err) {
      console.error("[churros] optout action error:", err);
    }
  });

  app.action("churros_home_unsnooze", async ({ ack, body }) => {
    await ack();
    const userId = body.user.id;
    unsnoozeUser(userId);
    try {
      await publishHomeView(app, userId);
    } catch (err) {
      console.error("[churros] unsnooze action error:", err);
    }
  });
}
