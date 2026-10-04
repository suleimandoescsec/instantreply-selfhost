import { loadConfig, type Config } from '../src/config.js';
import { openDb } from '../src/db.js';
import { makeHandler, type InboundMessage } from '../src/bot.js';
import { makeLogger } from '../src/log.js';
import type { ChatMsg } from '../src/ai.js';

export const SECRETS = {
  APP_SECRET: 'test-app-secret-123',
  VERIFY_TOKEN: 'test-verify-token-456',
  ACCESS_TOKEN: 'EAAG-super-secret-access-token-789',
  AI_API_KEY: 'sk-test-ai-key-000',
};

export const testConfig = (over: NodeJS.ProcessEnv = {}): Config =>
  loadConfig({
    GRAPH_API_VERSION: 'v26.0', PHONE_NUMBER_ID: '111222333', AI_BASE_URL: 'http://ai.invalid/v1',
    AI_MODEL: 'test-model', ...SECRETS, ...over,
  });

export const NOW = 1_800_000_000_000; // fixed clock, ms

export function setup(opts: { aiReply?: string | Error; cfg?: Config; sendOk?: boolean } = {}) {
  const cfg = opts.cfg ?? testConfig();
  const db = openDb(':memory:');
  const sent: { to: string; text: string }[] = [];
  const aiCalls: ChatMsg[][] = [];
  const logs: string[] = [];
  let clock = NOW;
  const handle = makeHandler({
    cfg, db, business: 'We sell coffee. Open 9-5.',
    log: makeLogger(Object.values(SECRETS), (l) => logs.push(l)),
    send: async (to, text) => { sent.push({ to, text }); return { ok: opts.sendOk ?? true, status: 200 }; },
    ai: async (m) => {
      aiCalls.push(m);
      if (opts.aiReply instanceof Error) throw opts.aiReply;
      return opts.aiReply ?? 'We open at 9.';
    },
    now: () => clock,
  });
  const msg = (text: string, over: Partial<InboundMessage> = {}): InboundMessage => ({
    id: `wamid.${Math.random()}`, from: '15550001111', timestamp: Math.floor(clock / 1000), type: 'text', text, ...over,
  });
  return { handle, db, sent, aiCalls, logs, msg, advance: (ms: number) => { clock += ms; } };
}
