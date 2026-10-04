# instantreply-selfhost

A small, free, MIT-licensed starter for a **WhatsApp AI auto-reply bot that runs on your own server, on your own Meta developer app, with your own AI key.** About 400 lines of TypeScript. You can read all of it in 20 minutes.

It answers customers who message you, using only the facts you write in `business.md`, and hands the chat to a human when it does not know.

## What it is

- Official **WhatsApp Cloud API** (no WhatsApp Web hacks, no unofficial sessions).
- `GET /webhook` verify handshake and `POST /webhook` with `X-Hub-Signature-256` checked over the raw body (timing-safe, 401 on missing/invalid, body size capped).
- Replies only to inbound messages, inside the 24-hour customer-service window, with free-form text.
- Never double-replies: processed WhatsApp message ids are stored (SQLite), so Meta's retries are harmless.
- `STOP` / `UNSUBSCRIBE` (English and Arabic) puts the number on a permanent suppression list. One confirmation, then silence.
- Any OpenAI-compatible chat endpoint (`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`). No tools, no function calling.
- Human handoff: keywords, non-text messages, or the model answering `[HANDOFF]` stops the bot on that chat and records it.
- No telemetry. The only outbound calls are to Meta's Graph API and your AI endpoint.

## What it is NOT

- No dashboard, no inbox UI, no team features.
- No campaigns or broadcasts. By design it cannot send an unsolicited message.
- No template-message manager. Templates outside the 24-hour window are **not implemented** (see Compliance).
- One WhatsApp number, one business, one `business.md`.
- Not a clone of the hosted InstantReply product, and not affiliated with Meta.

## Get going

You need Node.js 20.6+ (or Docker), a Meta account, and a key for any OpenAI-compatible AI provider.

1. **Create a Meta developer app.** At [developers.facebook.com/apps](https://developers.facebook.com/apps) create an app and pick the WhatsApp use case ("Connect with customers through WhatsApp"). Meta will have you attach a business portfolio and a WhatsApp Business Account (WABA), or create them. See [Cloud API: Get started](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started).
2. **Business verification.** You can build and test without it. Meta ties higher messaging throughput and some features to a verified business portfolio, so plan to verify the business before real customer traffic ([overview](https://developers.facebook.com/docs/whatsapp/cloud-api/overview)). The exact limits for unverified accounts are in Meta's docs and change; this repo does not restate them.
3. **Test number or real number.** The dashboard gives you a Meta test number and a temporary token for trying things out; test numbers can only message recipients you add. For real customers, add and register your own business number in the same dashboard (WhatsApp > API Setup). Copy the **Phone number ID** (not the phone number) into `PHONE_NUMBER_ID`.
4. **Create a permanent token.** The temporary token expires in about a day. In Business Settings create a **System User**, assign it your app and your WhatsApp account (full control), then generate a token with the permissions `whatsapp_business_messaging` and `whatsapp_business_management`. Meta's current guide also lists `business_management`; include it if the dashboard asks for it. Put the token in `ACCESS_TOKEN`. Steps: [Get started](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started), [Business Management API](https://developers.facebook.com/docs/whatsapp/business-management-api/get-started).
5. **Configure this repo.**
   ```bash
   git clone <your copy of this repo> && cd instantreply-selfhost
   cp .env.example .env        # fill in APP_SECRET, VERIFY_TOKEN, ACCESS_TOKEN, PHONE_NUMBER_ID, AI_*
   ```
   `APP_SECRET` is in App settings > Basic. `VERIFY_TOKEN` is any random string you invent. Check `GRAPH_API_VERSION` against [Meta's version list](https://developers.facebook.com/docs/graph-api/changelog/versions); `.env.example` has the stable version at the time of writing.
6. **Teach it.** Edit `business.md`: what the business is, hours, prices, policies, FAQs. The bot only knows what is in that file.
7. **Run it locally.**
   ```bash
   npm ci && npm run build && npm start
   curl http://localhost:3000/health
   ```
8. **Expose it with a tunnel (local dev).** Meta needs a public HTTPS URL. Use any tunnel, for example `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`.
9. **Register the webhook.** In the app dashboard go to WhatsApp > Configuration, set **Callback URL** to `https://<your-host>/webhook` and **Verify token** to your `VERIFY_TOKEN`, click Verify and save, then **subscribe to the `messages` field** ([webhooks guide](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks), [verification and signatures](https://developers.facebook.com/docs/graph-api/webhooks/getting-started)).
10. **Message your number** from a phone that is on the allowed recipient list and watch the logs.
11. **Going to production.** Switch the app to Live mode, use your real number and the System User token, and get the business verified. App Review / Advanced Access is mainly about serving other businesses' accounts; for your own business assets, confirm in your dashboard what Meta currently requires, because we could not confirm this from the public docs and it changes.

## Deploy

Docker is the verified path:

```bash
cp .env.example .env     # fill it in
docker compose up -d --build
```

The compose file binds to `127.0.0.1:3000`. Put a TLS reverse proxy in front (Caddy, nginx, Cloudflare Tunnel) and point the Meta callback URL at it. State lives in `./data/bot.db`; back it up. Any host that runs a container or Node 20.6+ and gives you HTTPS works. We do not claim one-click deploy buttons because we have not verified any.

## Day-to-day

```bash
# needs the sqlite3 CLI. Chats waiting for a human (the bot is silent on these):
sqlite3 data/bot.db "select wa_id, datetime(at/1000,'unixepoch'), reason from handoff"
# let the bot reply on a chat again
sqlite3 data/bot.db "delete from handoff where wa_id='15551234567'"
```

Chat text is kept 30 days (`HISTORY_RETENTION_DAYS`) so the model has context. The suppression list is kept forever. Logs use a short hash instead of phone numbers and never contain message text or secrets.

## Compliance and safety

- **Opt-in.** Meta requires clear opt-in from people before you message them. This bot only replies to people who message you first, which keeps you inside that, but you remain responsible for local law (for example GDPR, UAE PDPL) and [Meta's opt-in rules](https://developers.facebook.com/docs/whatsapp/overview/getting-opt-in). Tell customers they are talking to an automated assistant.
- **24-hour window.** When a customer messages you, a 24-hour customer-service window opens and resets with each new customer message. Inside it you may send free-form messages. Outside it, only pre-approved **template messages** are allowed ([sending messages](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages)). This bot drops anything outside the window, including old webhook redeliveries. It does not send templates. If you add them, create and get approval for them in WhatsApp Manager first and honour opt-in and opt-out per category.
- **Opt-out.** A message that is exactly `stop`, `unsubscribe`, `opt out` or the Arabic equivalents suppresses the number permanently, even if the window is closed. To lift it you must delete the row from `suppressed` yourself, and only if the person asked to be re-enabled.
- **No invented facts.** The prompt forbids answering outside `business.md`. Models still make mistakes: read your logs, keep `business.md` accurate, and do not use this for medical, legal or financial advice.
- **Prompt injection.** Customer text is sent only as user messages and never merged into the system prompt. The bot has no tools, no web access and cannot take actions, so the worst a successful injection can do is produce a wrong reply. Replies are length-capped.
- **Secrets.** `.env` is git-ignored. The access token, app secret and AI key are scrubbed from logs. Rotate them if you ever paste them anywhere.
- **Meta rate limits and quality.** Meta rate-limits and can restrict numbers with poor quality ratings. A built-in per-sender limit (`RATE_LIMIT_PER_MIN`) drops floods.
- **At-most-once replies.** A message id is recorded before processing. If your server crashes mid-reply, that customer gets no reply rather than a duplicate.

## When to move to hosted InstantReply

This starter is meant to be a good place to begin, and you can stay on it as long as it fits. If you want a shared inbox, campaigns, a template manager, team members, more than WhatsApp (other channels), or someone to help when things break, that is what the hosted product at [https://www.instantreply.co](https://www.instantreply.co) is for. Help setting this starter up is available by arrangement: support@instantreply.co.

## Configuration reference

See [`.env.example`](.env.example). Required: `GRAPH_API_VERSION`, `APP_SECRET`, `VERIFY_TOKEN`, `ACCESS_TOKEN`, `PHONE_NUMBER_ID`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`.

## Layout

```
src/server.ts    http server: verify handshake, signature check, payload parsing
src/bot.ts       the rules: dedupe, STOP, window, handoff, rate limit, reply
src/ai.ts        system prompt + OpenAI-compatible call
src/whatsapp.ts  Graph API send (4xx not retried, 5xx retried)
src/db.ts        SQLite schema
test/            node:test suite (npm test)
```

## Development

```bash
npm ci && npm test && npm run build
```

npm 11 may print an "allow-scripts" notice about `better-sqlite3` (it downloads or builds a native module). The install still works; if your npm blocks it, run `npm approve-scripts` or `npm rebuild better-sqlite3`.

## License

MIT, see [LICENSE](LICENSE). Research on why this is not a fork: [docs/DECISION.md](docs/DECISION.md).
