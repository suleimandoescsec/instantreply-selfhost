import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { makeServer, validSignature } from '../src/server.js';
import { NOW, SECRETS, setup, testConfig } from './helpers.js';
import { makeLogger } from '../src/log.js';

const sign = (body: string, secret = SECRETS.APP_SECRET) => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

function payload(id: string, text: string, ts = Math.floor(NOW / 1000), phoneId = '111222333') {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { phone_number_id: phoneId },
      messages: [{ id, from: '15550001111', timestamp: String(ts), type: 'text', text: { body: text } }],
    } }] }],
  });
}

async function boot(over: Parameters<typeof setup>[0] = {}) {
  const s = setup(over);
  const cfg = testConfig();
  const logs: string[] = [];
  const server = makeServer(cfg, s.handle, makeLogger(Object.values(SECRETS), (l) => logs.push(l)));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { s, base, logs, close: () => new Promise<void>((r) => server.close(() => r())) };
}
const settle = () => new Promise((r) => setTimeout(r, 50));

test('validSignature: valid, invalid, missing, malformed', () => {
  const raw = Buffer.from('{"a":1}');
  assert.ok(validSignature(raw, sign('{"a":1}'), SECRETS.APP_SECRET));
  assert.ok(!validSignature(raw, sign('{"a":2}'), SECRETS.APP_SECRET));
  assert.ok(!validSignature(raw, sign('{"a":1}', 'wrong'), SECRETS.APP_SECRET));
  assert.ok(!validSignature(raw, undefined, SECRETS.APP_SECRET));
  assert.ok(!validSignature(raw, 'sha256=zz', SECRETS.APP_SECRET));
  assert.ok(!validSignature(raw, 'abcdef', SECRETS.APP_SECRET));
});

test('GET /webhook verify handshake', async () => {
  const t = await boot();
  const ok = await fetch(`${t.base}/webhook?hub.mode=subscribe&hub.verify_token=${SECRETS.VERIFY_TOKEN}&hub.challenge=12345`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '12345');
  const bad = await fetch(`${t.base}/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345`);
  assert.equal(bad.status, 403);
  const noMode = await fetch(`${t.base}/webhook?hub.verify_token=${SECRETS.VERIFY_TOKEN}&hub.challenge=1`);
  assert.equal(noMode.status, 403);
  const missing = await fetch(`${t.base}/webhook`);
  assert.equal(missing.status, 403);
  await t.close();
});

test('POST /webhook: missing or invalid signature -> 401 and nothing processed', async () => {
  const t = await boot();
  const body = payload('wamid.a', 'hello');
  const noSig = await fetch(`${t.base}/webhook`, { method: 'POST', body });
  assert.equal(noSig.status, 401);
  const badSig = await fetch(`${t.base}/webhook`, { method: 'POST', body, headers: { 'x-hub-signature-256': sign(body, 'other') } });
  assert.equal(badSig.status, 401);
  await settle();
  assert.equal(t.s.sent.length, 0);
  await t.close();
});

test('POST /webhook: valid signature -> 200, replies; redelivery does not double-reply', async () => {
  const t = await boot();
  const body = payload('wamid.b', 'when do you open?');
  const headers = { 'x-hub-signature-256': sign(body) };
  assert.equal((await fetch(`${t.base}/webhook`, { method: 'POST', body, headers })).status, 200);
  assert.equal((await fetch(`${t.base}/webhook`, { method: 'POST', body, headers })).status, 200);
  await settle();
  assert.equal(t.s.sent.length, 1);
  await t.close();
});

test('POST /webhook: other phone_number_id and statuses are ignored', async () => {
  const t = await boot();
  const body = payload('wamid.c', 'hi', undefined, '999');
  await fetch(`${t.base}/webhook`, { method: 'POST', body, headers: { 'x-hub-signature-256': sign(body) } });
  const status = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '111222333' }, statuses: [{ id: 'x', status: 'read' }] } }] }] });
  assert.equal((await fetch(`${t.base}/webhook`, { method: 'POST', body: status, headers: { 'x-hub-signature-256': sign(status) } })).status, 200);
  await settle();
  assert.equal(t.s.sent.length, 0);
  await t.close();
});

test('POST /webhook: oversized body rejected', async () => {
  const s = setup();
  const server = makeServer(testConfig({ MAX_BODY_BYTES: '100' }), s.handle, makeLogger([], () => {}));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const body = 'x'.repeat(5000);
  const res = await fetch(`${base}/webhook`, { method: 'POST', body, headers: { 'x-hub-signature-256': sign(body) } }).catch(() => null);
  assert.ok(res === null || res.status === 413);
  await new Promise<void>((r) => server.close(() => r()));
});

test('/health responds and unknown paths 404', async () => {
  const t = await boot();
  assert.equal((await fetch(`${t.base}/health`)).status, 200);
  assert.equal((await fetch(`${t.base}/nope`)).status, 404);
  await t.close();
});
