import type { App } from "@slack/bolt";
import { getConfig } from "../db/config";
import { isUserSnoozed, cleanExpiredSnoozes } from "../db/snooze";
import { insertPairing, getLastLeftOut, setLastLeftOut } from "../db/pairings";
import { matchUsers } from "./matcher";
import type { DepartmentMap } from "./matcher";
import { buildIntroMessage, buildIcebreakerMessage, buildLeftOutMessage } from "./messages";
import { getRandomIcebreaker } from "./icebreakers";

async function notifyLeftOut(app: App, userIds: string[]): Promise<void> {
  await Promise.all(
    userIds.map(async (userId) => {
      const { channel } = await app.client.conversations.open({ users: userId });
      if (channel?.id) {
        await app.client.chat.postMessage({ channel: channel.id, text: buildLeftOutMessage() });
      }
    })
  );
}

/**
 * Executes a full intro round: fetches eligible channel members, runs the matching
 * algorithm, sends group DMs with an icebreaker to each pair, and notifies any
 * leftover member who could not be paired.
 */
export async function runIntros(app: App): Promise<void> {
  cleanExpiredSnoozes();

  const config = getConfig();
  if (!config || !config.enabled) {
    console.log("[intros] No config or disabled — skipping");
    return;
  }

  const [membersRes, botInfo] = await Promise.all([
    app.client.conversations.members({ channel: config.channel_id }),
    app.client.auth.test(),
  ]);
  const allMembers: string[] = membersRes.members ?? [];
  const botUserId = botInfo.user_id as string;

  // Fetch all user profiles in parallel
  const userInfos = await Promise.all(
    allMembers
      .filter((id) => id !== botUserId)
      .map((id) => app.client.users.info({ user: id }).then((info) => ({ id, info })))
  );

  const eligible: string[] = [];
  const departments: DepartmentMap = new Map();
  for (const { id: userId, info } of userInfos) {
    if (info.user?.is_bot) continue;
    if (isUserSnoozed(userId)) continue;
    eligible.push(userId);
    const profile = info.user?.profile as Record<string, unknown> | undefined;
    const fields = profile?.fields as Record<string, { value?: string }> | undefined;
    const dept = fields?.department?.value ?? (profile?.department as string | undefined) ?? null;
    departments.set(userId, dept);
  }

  if (eligible.length < 2) {
    await notifyLeftOut(app, eligible);
    console.log(`[intros] Not enough members to pair (${eligible.length})`);
    return;
  }

  const pairs = matchUsers(config.channel_id, eligible, getLastLeftOut(), departments);
  const pairedUsers = new Set(pairs.flatMap(({ userA, userB }) => [userA, userB]));
  const leftOut = eligible.filter((u) => !pairedUsers.has(u));

  // Record who was left out so next round they get priority
  setLastLeftOut(leftOut[0] ?? null);

  console.log(`[intros] ${eligible.length} members → ${pairs.length} pair(s), ${leftOut.length} left out`);

  // Send a group DM to each pair
  for (const { userA, userB } of pairs) {
    const groupDm = await app.client.conversations.open({ users: `${userA},${userB}` });
    const dmChannelId = groupDm.channel?.id;
    insertPairing(config.channel_id, userA, userB, dmChannelId);
    if (dmChannelId) {
      await app.client.chat.postMessage({
        channel: dmChannelId,
        text: buildIntroMessage(userA, userB),
      });
      await app.client.chat.postMessage({
        channel: dmChannelId,
        text: buildIcebreakerMessage(getRandomIcebreaker()),
      });
    }
  }

  await notifyLeftOut(app, leftOut);
}
