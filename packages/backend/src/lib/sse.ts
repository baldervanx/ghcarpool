import { Response } from 'express';

export type SseEvent = 'init' | 'add' | 'update' | 'remove' | 'heartbeat';

interface SseClient {
  res: Response;
  channel: string;
}

const clients = new Map<string, Set<SseClient>>();

export function subscribe(channel: string, res: Response): SseClient {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const client: SseClient = { res, channel };
  if (!clients.has(channel)) clients.set(channel, new Set());
  clients.get(channel)!.add(client);
  return client;
}

export function unsubscribe(client: SseClient): void {
  clients.get(client.channel)?.delete(client);
}

export function sendEvent(channel: string, event: SseEvent, data: unknown): void {
  const targets = clients.get(channel);
  if (!targets) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of targets) {
    client.res.write(payload);
  }
}

// Global heartbeat — prevents proxy timeouts
setInterval(() => {
  for (const [channel] of clients) {
    sendEvent(channel, 'heartbeat', { ts: Date.now() });
  }
}, 25_000);
