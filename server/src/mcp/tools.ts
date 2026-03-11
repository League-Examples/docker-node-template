import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getContext } from './context';
import fs from 'fs';
import path from 'path';

function textResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export function registerTools(server: McpServer) {
  // get_version — returns the app version from package.json
  server.tool('get_version', 'Get the application version', {}, async () => {
    try {
      const pkgPath = path.resolve(process.cwd(), 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      return textResult({ version: pkg.version || '0.1.0' });
    } catch {
      return textResult({ version: '0.1.0' });
    }
  });

  // list_users — returns all users
  server.tool('list_users', 'List all users', {}, async () => {
    const { services } = getContext();
    const users = await services.users.list();
    return textResult(users);
  });

  // list_channels — returns all channels with message counts
  server.tool('list_channels', 'List all chat channels', {}, async () => {
    const { services } = getContext();
    const channels = await services.channels.list();
    return textResult(channels);
  });

  // get_channel_messages — returns messages for a channel
  server.tool(
    'get_channel_messages',
    'Get messages from a chat channel',
    { channelId: z.number().describe('Channel ID'), limit: z.number().optional().describe('Max messages to return') },
    async ({ channelId, limit }) => {
      const { services } = getContext();
      try {
        const messages = await services.messages.list(channelId, { limit });
        return textResult(messages);
      } catch (err: any) {
        return textResult({ error: err.message || 'Failed to get messages' });
      }
    },
  );

  // post_message — creates a message in a channel
  server.tool(
    'post_message',
    'Post a message to a chat channel',
    { channelId: z.number().describe('Channel ID'), content: z.string().describe('Message content') },
    async ({ channelId, content }) => {
      const { user, services } = getContext();
      try {
        const message = await services.messages.create(channelId, user.id, content);
        return textResult(message);
      } catch (err: any) {
        return textResult({ error: err.message || 'Failed to post message' });
      }
    },
  );

  // create_channel — creates a new channel
  server.tool(
    'create_channel',
    'Create a new chat channel',
    { name: z.string().describe('Channel name'), description: z.string().optional().describe('Channel description') },
    async ({ name, description }) => {
      const { services } = getContext();
      try {
        const channel = await services.channels.create(name, description);
        return textResult(channel);
      } catch (err: any) {
        return textResult({ error: err.message || 'Failed to create channel' });
      }
    },
  );
}
