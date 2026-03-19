# Pattern: Slack Bot Integration

## When to Use

Any application where the team communicates via Slack and wants to:
- Receive notifications about app events in Slack channels
- Query the app from Slack (e.g., "what issues are open?")
- Use conversational AI to interact with app data from Slack

## Overview

Integrate a Slack bot using the Slack Bolt SDK that can receive messages,
respond with app data, and optionally use Claude as a conversational
layer. The bot runs inside the existing Express server — no separate
process needed.

## Components

### 1. Slack Bolt App

```typescript
import { App as SlackApp, ExpressReceiver } from '@slack/bolt';

// Use ExpressReceiver to share the Express server
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  endpoints: '/slack/events', // mounted on the Express app
  processBeforeResponse: true,
});

const slackApp = new SlackApp({
  token: process.env.SLACK_BOT_USER_OAUTH_TOKEN,
  receiver,
});
```

### 2. Mount on Express

```typescript
// In app.ts:
if (process.env.SLACK_SIGNING_SECRET) {
  // Store raw body for Slack signature verification
  app.use('/slack', express.raw({ type: 'application/json' }));
  app.use('/slack', receiver.router);
}
```

The raw body middleware is critical — Slack verifies request signatures
against the raw request body, not the parsed JSON.

### 3. Event Handlers

```typescript
// Respond to direct messages
slackApp.message(async ({ message, say }) => {
  if (message.subtype) return; // ignore bot messages, edits, etc.

  const text = (message as any).text;

  // Option A: Simple command routing
  if (text.startsWith('status')) {
    const stats = await registry.reports.getStats();
    await say(`Open issues: ${stats.openIssues}, Active items: ${stats.activeItems}`);
    return;
  }

  // Option B: Conversational AI via Claude
  const response = await callClaude(text, message.user);
  await say(response);
});

// Respond to app mentions in channels
slackApp.event('app_mention', async ({ event, say }) => {
  // Similar to message handler
});
```

### 4. Conversational AI Layer

Use the Anthropic SDK to route Slack messages through Claude with
app context:

```typescript
async function callClaude(userMessage: string, slackUserId: string) {
  const conversation = await getOrCreateConversation(slackUserId);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: `You are a helpful assistant for ${APP_NAME}. You can answer
      questions about the application data.`,
    messages: [
      ...conversation.history,
      { role: 'user', content: userMessage },
    ],
  });

  await saveConversation(slackUserId, userMessage, response.content[0].text);
  return response.content[0].text;
}
```

### 5. Conversation Storage

```prisma
model SlackConversation {
  id               Int      @id @default(autoincrement())
  slackUserId      String
  userMessage      String
  assistantMessage String
  createdAt        DateTime @default(now())
}
```

### 6. Proactive Notifications

Send messages to channels when notable events happen:

```typescript
export class SlackNotificationService {
  async notifyChannel(channel: string, text: string) {
    if (!process.env.SLACK_BOT_USER_OAUTH_TOKEN) return;

    await slackApp.client.chat.postMessage({
      channel,
      text,
      unfurl_links: false,
    });
  }
}

// Usage in other services:
await slack.notifyChannel('#alerts', `Backup completed: ${filename}`);
await slack.notifyChannel('#activity', `New user registered: ${user.email}`);
```

## Slack App Setup

1. Create a Slack app at https://api.slack.com/apps
2. Enable Socket Mode or Events API
3. Subscribe to events: `message.im`, `app_mention`
4. Add OAuth scopes: `chat:write`, `im:history`, `app_mentions:read`
5. Install to workspace and copy the Bot User OAuth Token

## Environment Variables

```
SLACK_SIGNING_SECRET=         # from Slack app settings
SLACK_BOT_USER_OAUTH_TOKEN=   # from OAuth & Permissions page
SLACK_CHANNEL_ALERTS=#alerts  # default notification channel
```

## Dependencies

```
npm install @slack/bolt
```

## Graceful Degradation

All Slack functionality should be gated on `SLACK_SIGNING_SECRET` being
set. If not configured, the Slack routes are not mounted and notification
calls are no-ops. The app works fine without Slack.

## Reference Implementation

- Inventory app: `server/src/routes/slack.ts`
- Inventory app: `server/prisma/schema.prisma` — `SlackConversation` model
- Inventory app: `server/src/app.ts` (raw body middleware for signature
  verification)
