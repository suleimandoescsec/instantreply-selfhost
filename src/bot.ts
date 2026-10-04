import type { Config } from './config.js';
import type { Db } from './db.js';
import type { Ai, ChatMsg } from './ai.js';
import { HANDOFF_TOKEN, systemPrompt } from './ai.js';
import type { Logger } from './log.js';
import { who } from './log.js';
import type { Sender } from './whatsapp.js';

export interface InboundMessage { id: string; from: string; timestamp: number; type: string; text?: string }

export interface Deps {
  cfg: Config;
  db: Db;
  send: Sender;
  ai: Ai;
  log: Logger;
  business: string;
  now?: () => number;
}

// WhatsApp customer-service window is 24h from the customer's last message; keep a 5 min safety margin.
const WINDOW_MS = 24 * 3_600_000 - 5 * 60_000;
const MAX_INPUT_CHARS = 1000;

const norm = (s: string) =>
  s.toLowerCase().normalize('NFKD')
    .replace(/[ً-ٰٟ]/g, '') // Arabic diacritics
    .replace(/[أإآ]/g, 'ا') // alef variants
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

// Whole-message match only, so "please don't stop the order" is not an opt-out.
const STOP_WORDS = new Set(
  ['stop', 'stop all', 'unsubscribe', 'opt out', 'optout', 'توقف', 'ايقاف', 'وقف', 'الغاء الاشتراك', 'الغاء الاشتراك من الرسائل'].map(norm),
);
export const isStop = (text: string) => STOP_WORDS.has(norm(text));

const HANDOFF_EN = /\b(human|real person|a person|live agent|support agent|customer service|representative|operator|manager|speak to someone|talk to someone|call me)\b/;
const HANDOFF_AR = ['موظف', 'انسان', 'شخص', 'مندوب', 'مدير', 'اكلم احد', 'اتكلم مع'];
export function wantsHuman(text: string, extra: string[] = []) {
  const t = norm(text);
  return HANDOFF_EN.test(t) || HANDOFF_AR.some((k) => t.includes(k)) || extra.some((k) => t.includes(norm(k)));
}

const isArabic = (s: string) => /[؀-ۿ]/.test(s);
const T = {
  stop: ['You have been unsubscribed and will not receive further messages from us.', 'تم إلغاء اشتراكك ولن تصلك أي رسائل أخرى منا.'],
  handoff: ["I don't have that. A person will follow up with you.", 'ليست لدي هذه المعلومة. سيتواصل معك أحد الموظفين.'],
  unsupported: ['I can only read text messages. A person will follow up if needed.', 'أستطيع قراءة الرسائل النصية فقط. سيتواصل معك أحد الموظفين عند الحاجة.'],
  error: ["Sorry, I'm having trouble right now. A person will follow up.", 'عذراً، أواجه مشكلة حالياً. سيتواصل معك أحد الموظفين.'],
} as const;
const msg = (k: keyof typeof T, ar: boolean) => T[k][ar ? 1 : 0];

export function cap(text: string, max: number) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return (end > max / 2 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '')).trim();
}

export function makeHandler(d: Deps) {
  const { cfg, db, log } = d;
  const now = d.now ?? Date.now;
  const hits = new Map<string, number[]>(); // ponytail: in-memory per-sender limiter, resets on restart

  const seen = db.prepare('INSERT OR IGNORE INTO processed (id, at) VALUES (?, ?)');
  const isSuppressed = db.prepare('SELECT 1 FROM suppressed WHERE wa_id = ?');
  const suppress = db.prepare('INSERT OR IGNORE INTO suppressed (wa_id, at) VALUES (?, ?)');
  const isHandedOff = db.prepare('SELECT 1 FROM handoff WHERE wa_id = ?');
  const handOff = db.prepare('INSERT OR IGNORE INTO handoff (wa_id, at, reason) VALUES (?, ?, ?)');
  const addMsg = db.prepare('INSERT INTO messages (wa_id, role, body, at) VALUES (?, ?, ?, ?)');
  const recent = db.prepare('SELECT role, body FROM (SELECT id, role, body FROM messages WHERE wa_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id');

  function limited(id: string): boolean {
    const t = now();
    const arr = (hits.get(id) ?? []).filter((x) => t - x < 60_000);
    arr.push(t);
    hits.set(id, arr);
    if (hits.size > 10_000) hits.clear();
    return arr.length > cfg.rateLimitPerMin;
  }

  return async function handle(m: InboundMessage): Promise<void> {
    const w = who(cfg.appSecret, m.from);
    const t = now();
    if (seen.run(m.id, t).changes === 0) return log('duplicate_ignored', { user: w });

    const inWindow = t - Math.min(m.timestamp * 1000, t) < WINDOW_MS;
    const text = m.type === 'text' ? (m.text ?? '').slice(0, MAX_INPUT_CHARS) : '';
    const ar = isArabic(text);

    // Opt-out always wins, even outside the window or for handed-off chats.
    if (m.type === 'text' && isStop(text)) {
      const first = suppress.run(m.from, t).changes === 1;
      log('suppressed', { user: w, firstTime: first });
      if (first && inWindow) await d.send(m.from, msg('stop', ar));
      return;
    }
    if (isSuppressed.get(m.from)) return log('skipped_suppressed', { user: w });
    if (!inWindow) return log('skipped_outside_window', { user: w });
    if (isHandedOff.get(m.from)) return log('skipped_handoff_thread', { user: w });
    if (limited(m.from)) return log('rate_limited', { user: w });

    const toHuman = async (reason: string, key: 'handoff' | 'unsupported' | 'error') => {
      handOff.run(m.from, t, reason);
      log('handoff', { user: w, reason });
      await d.send(m.from, msg(key, ar));
    };

    if (m.type !== 'text' || !text.trim()) return toHuman('non_text_message', 'unsupported');
    if (wantsHuman(text, cfg.handoffKeywords)) return toHuman('keyword', 'handoff');

    addMsg.run(m.from, 'user', text, t);
    const history = recent.all(m.from, cfg.historyMessages) as { role: 'user' | 'assistant'; body: string }[];
    const messages: ChatMsg[] = [
      { role: 'system', content: systemPrompt(d.business) },
      ...history.map((h) => ({ role: h.role, content: h.body })),
    ];

    let reply: string;
    try {
      reply = await d.ai(messages);
    } catch (e) {
      log('ai_error', { user: w, error: (e as Error).message });
      await d.send(m.from, msg('error', ar)); // not a handoff: the next message may work
      return;
    }
    if (reply.includes(HANDOFF_TOKEN)) return toHuman('model_no_answer', 'handoff');

    reply = cap(reply, cfg.maxReplyChars);
    const res = await d.send(m.from, reply);
    if (res.ok) addMsg.run(m.from, 'assistant', reply, now());
    log('replied', { user: w, ok: res.ok, status: res.status });
  };
}
