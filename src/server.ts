import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Config } from './config.js';
import type { InboundMessage } from './bot.js';
import type { Logger } from './log.js';

const digest = (s: string) => createHash('sha256').update(s).digest();
/** Constant-time string compare (hashes first so lengths always match). */
export const safeEqual = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/** Verify `X-Hub-Signature-256: sha256=<hex>` over the RAW request bytes. */
export function validSignature(raw: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const got = Buffer.from(header.slice(7), 'hex');
  const want = createHmac('sha256', appSecret).update(raw).digest();
  return got.length === want.length && timingSafeEqual(got, want);
}

class TooLarge extends Error {}

function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) { reject(new TooLarge()); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Pull text messages for OUR phone number out of a Cloud API webhook payload. Statuses are ignored. */
export function extractMessages(payload: any, phoneNumberId: string): InboundMessage[] {
  const out: InboundMessage[] = [];
  if (payload?.object !== 'whatsapp_business_account') return out;
  for (const entry of payload.entry ?? []) {
    for (const ch of entry?.changes ?? []) {
      if (ch?.field !== 'messages' || ch?.value?.metadata?.phone_number_id !== phoneNumberId) continue;
      for (const m of ch.value.messages ?? []) {
        if (typeof m?.id !== 'string' || typeof m?.from !== 'string') continue;
        out.push({ id: m.id, from: m.from, timestamp: Number(m.timestamp) || 0, type: String(m.type), text: m.text?.body });
      }
    }
  }
  return out;
}

export function makeServer(cfg: Config, handle: (m: InboundMessage) => Promise<void>, log: Logger): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const reply = (code: number, body = '', type = 'text/plain') => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };

    if (req.method === 'GET' && url.pathname === '/health') return reply(200, '{"ok":true}', 'application/json');

    if (url.pathname !== '/webhook') return reply(404);

    if (req.method === 'GET') { // Meta verify handshake
      const token = url.searchParams.get('hub.verify_token') ?? '';
      const challenge = url.searchParams.get('hub.challenge') ?? '';
      if (url.searchParams.get('hub.mode') === 'subscribe' && safeEqual(token, cfg.verifyToken)) return reply(200, challenge);
      log('verify_rejected');
      return reply(403);
    }

    if (req.method !== 'POST') return reply(405);

    let raw: Buffer;
    try {
      raw = await readBody(req, cfg.maxBodyBytes);
    } catch (e) {
      log('body_rejected', { reason: e instanceof TooLarge ? 'too_large' : 'read_error' });
      return reply(e instanceof TooLarge ? 413 : 400);
    }
    if (!validSignature(raw, req.headers['x-hub-signature-256'] as string | undefined, cfg.appSecret)) {
      log('signature_rejected');
      return reply(401);
    }
    let payload: unknown;
    try { payload = JSON.parse(raw.toString('utf8')); } catch { return reply(400); }

    reply(200); // ack fast; Meta retries anything that is not a 200
    const msgs = extractMessages(payload, cfg.phoneNumberId);
    setImmediate(async () => {
      for (const m of msgs) {
        try { await handle(m); } catch (e) { log('handler_error', { error: (e as Error).name }); }
      }
    });
  });
}
