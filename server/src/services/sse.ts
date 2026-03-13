import { Response } from 'express';

/** Simple per-channel SSE broadcaster. */
const clients = new Map<number, Set<Response>>();

export function addClient(channelId: number, res: Response) {
  if (!clients.has(channelId)) clients.set(channelId, new Set());
  clients.get(channelId)!.add(res);
  res.on('close', () => {
    clients.get(channelId)?.delete(res);
    if (clients.get(channelId)?.size === 0) clients.delete(channelId);
  });
}

export function broadcast(channelId: number, event: string, data: unknown) {
  const set = clients.get(channelId);
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    res.write(payload);
  }
}
