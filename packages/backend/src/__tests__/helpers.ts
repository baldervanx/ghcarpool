/**
 * Test-helpers: delade utilities för e2e-tester.
 *
 *  - `loginAgent`         – skapar en supertest-agent och loggar in
 *  - `collectSseEvents`   – öppnar /stream och samlar upp SSE-events
 */

import http from 'http';
import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../app';
import prisma from '../db/prisma';

// ─── Seed-helpers ──────────────────────────────────────────────────────────────

export async function createTestUser(overrides: {
  email?: string;
  password?: string;
  isAdmin?: boolean;
} = {}) {
  const email = overrides.email ?? `user-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const password = overrides.password ?? 'test-pw-123';
  const passwordHash = await bcrypt.hash(password, 4); // kostnadsfaktor 4 = snabbt i test
  const user = await prisma.user.create({
    data: { email, isAdmin: overrides.isAdmin ?? false, passwordHash },
  });
  return { user, password };
}

export async function createTestCar(overrides: { name?: string; order?: number } = {}) {
  return prisma.car.create({
    data: {
      name: overrides.name ?? `Bil-${Date.now()}`,
      order: overrides.order ?? 0,
      hasLog: true,
    },
  });
}

export async function createTestDestination() {
  return prisma.destination.create({
    data: {
      name: `Dest-${Date.now()}`,
      shortName: 'Dest',
      distance: 10,
    },
  });
}

// ─── Auth-helper ───────────────────────────────────────────────────────────────

/**
 * Returnerar en inloggad supertest-agent.
 * Agenten håller kvar session-cookien mellan anrop.
 */
export async function loginAgent(email: string, password: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Inloggning misslyckades: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}

/**
 * Loggar in via en tillfällig HTTP-server och returnerar Set-Cookie-värdet.
 * Används av collectSseEvents för att skicka session-cookien i en rå http.request.
 */
export function getSessionCookie(
  server: http.Server,
  email: string,
  password: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ email, password });
    const port = (server.address() as { port: number }).port;

    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/api/v1/auth/login',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume(); // drain body
        const cookies = res.headers['set-cookie'];
        if (!cookies || cookies.length === 0) {
          reject(new Error(`Login misslyckades: HTTP ${res.statusCode}, inga cookies`));
          return;
        }
        // Plocka ut bara name=value, inte flaggor som HttpOnly etc.
        const cookieHeader = cookies
          .map((c) => c.split(';')[0].trim())
          .join('; ');
        resolve(cookieHeader);
      },
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── SSE-helper ────────────────────────────────────────────────────────────────

export interface SseEvent {
  event: string;
  data: unknown;
}

/**
 * Öppnar en HTTP-SSE-anslutning mot `path` med de angivna credentials.
 * Returnerar efter att `count` non-heartbeat events har tagits emot
 * (eller `timeoutMs` har passerat).
 *
 * OBS: använder node:http direkt — supertest stöder inte streaming svar.
 * Startar en egen tillfällig HTTP-server på random port.
 */
export function collectSseEvents(
  credentials: { email: string; password: string },
  path: string,
  count: number,
  timeoutMs = 5000,
): Promise<SseEvent[]> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0);

    server.on('error', (err) => reject(err));

    getSessionCookie(server, credentials.email, credentials.password)
      .then((cookieHeader) => {
        const port = (server.address() as { port: number }).port;
        const events: SseEvent[] = [];
        let buffer = '';
        let settled = false;

        function finish(err?: Error) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          req.destroy();
          server.close(() => {
            if (err) reject(err);
            else resolve(events);
          });
        }

        const timer = setTimeout(() => {
          if (events.length >= count) {
            finish();
          } else {
            finish(new Error(`SSE timeout: fick ${events.length}/${count} events`));
          }
        }, timeoutMs);

        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            path,
            method: 'GET',
            headers: { Cookie: cookieHeader },
          },
          (incoming) => {
            if (incoming.statusCode !== 200) {
              finish(new Error(`SSE-request fick HTTP ${incoming.statusCode}`));
              return;
            }

            incoming.setEncoding('utf8');
            incoming.on('data', (chunk: string) => {
              buffer += chunk;
              const parts = buffer.split(/\n\n/);
              buffer = parts.pop() ?? '';
              for (const part of parts) {
                if (!part.trim()) continue;
                const eventLine = part.match(/^event:\s*(.+)$/m)?.[1]?.trim();
                const dataLine  = part.match(/^data:\s*(.+)$/m)?.[1]?.trim();
                if (!eventLine || !dataLine) continue;
                if (eventLine === 'heartbeat') continue; // skip keepalives
                try {
                  events.push({ event: eventLine, data: JSON.parse(dataLine) });
                } catch {
                  events.push({ event: eventLine, data: dataLine });
                }
                if (events.length >= count) finish();
              }
            });

            incoming.on('error', (err) => {
              if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') {
                finish();
              } else {
                finish(err);
              }
            });
          },
        );

        req.on('error', (err) => {
          if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') {
            finish(err);
          }
        });

        req.end();
      })
      .catch((err) => {
        server.close(() => reject(err));
      });
  });
}
