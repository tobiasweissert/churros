import "dotenv/config";
import { App } from "@slack/bolt";
import { registerIntroHandlers } from "./intros/handlers";
import { registerAppHome } from "./intros/appHome";
import { startScheduler } from "./intros/scheduler";
import { getConfig } from "./db/config";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: !!process.env.SLACK_APP_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  port: Number(process.env.PORT ?? 3000),
});

app.error(async (error) => {
  console.error("[churros] unhandled error:", error);
});

registerIntroHandlers(app);
registerAppHome(app);

(async () => {
  await app.start();
  console.log(`Churros is running on port ${process.env.PORT ?? 3000}`);
  await startScheduler(app);

  // Verify bot is a member of the configured channel so join/leave events fire
  const config = getConfig();
  if (config) {
    try {
      const info = await app.client.conversations.info({ channel: config.channel_id });
      if (!info.channel?.is_member) {
        console.warn(`[churros] Bot is not in <#${config.channel_id}>. Attempting to join...`);
        await app.client.conversations.join({ channel: config.channel_id }).catch((err) => {
          console.error(`[churros] Could not join <#${config.channel_id}>: ${err?.data?.error ?? err}. Invite the bot manually.`);
        });
      }
    } catch (err) {
      console.error(`[churros] Could not verify channel membership for ${config.channel_id}:`, err);
    }
  }
})();
