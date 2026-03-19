/** Builds the opening DM message sent to a newly matched pair. */
export function buildIntroMessage(userA: string, userB: string): string {
  return `Hi <@${userA}> and <@${userB}>! You've been paired this week — let's meet for a coffee or so! :coffee:`;
}

/** Builds the message sent to a user who could not be paired due to odd numbers. */
export function buildLeftOutMessage(): string {
  return `We could not include you in this week's pairings due to an uneven number of participants. You'll be included next round!`;
}

/** Wraps an icebreaker question in a formatted Slack message string. */
export function buildIcebreakerMessage(question: string): string {
  return `:coffee: *Icebreaker:* ${question}`;
}

/** Builds the mid-week nudge message sent to pairs that haven't exchanged messages yet. */
export function buildReminderMessage(userA: string, userB: string): string {
  return `Hey <@${userA}> and <@${userB}>! Just a nudge — have you had a chance to connect yet this week? Now's a great time! :coffee:`;
}

/** Builds the onboarding DM sent to a user when they join the configured channel. */
export function buildWelcomeMessage(channelId: string, frequency: string): string {
  return `Welcome to Churros! 🎉\nI randomly pair people in <#${channelId}> for coffee chats.\n\n*How it works:* Every ${frequency}, I'll match you with someone and send you both a DM.\n\n*Change frequency:* An admin can run \`/churros frequency\` to switch between weekly, bi-weekly, or monthly.\n\n*Snooze:* Run \`/churros snooze [1-4]\` to skip pairings for 1–4 weeks, or \`/churros snooze off\` to permanently opt out. Use \`/churros unsnooze\` to rejoin anytime.`;
}
