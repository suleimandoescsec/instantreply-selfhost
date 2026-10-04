import type { Config } from './config.js';
import type { Logger } from './log.js';

export interface SendResult { ok: boolean; status: number; code?: number }
export type Sender = (to: string, text: string) => Promise<SendResult>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Send a free-form text message through the Cloud API.
 * 5xx / network errors: retried twice. Any 4xx (bad token, window closed, invalid number): NOT retried.
 * The access token is only ever placed in the Authorization header.
 */
export function makeSender(cfg: Config, log: Logger, fetchImpl: typeof fetch = fetch, backoffMs = 500): Sender {
  const url = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`;
  return async (to, text) => {
    const body = JSON.stringify({
      messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text',
      text: { preview_url: false, body: text },
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) return { ok: true, status: res.status };
        const err = ((await res.json().catch(() => ({}))) as { error?: { code?: number; type?: string } }).error;
        log('send_failed', { status: res.status, code: err?.code, type: err?.type, attempt });
        if (res.status < 500) return { ok: false, status: res.status, code: err?.code };
      } catch (e) {
        log('send_error', { error: (e as Error).name, attempt });
      }
      if (attempt < 2) await sleep(backoffMs * (attempt + 1));
    }
    return { ok: false, status: 0 };
  };
}
