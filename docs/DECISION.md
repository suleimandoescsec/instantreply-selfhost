# Fork vs build: decision

**Decision: build minimal (MIT). No upstream code was copied.**

Researched 2026-10-04. Licenses and dates were read from the repositories themselves (GitHub API: license file, latest commit / `pushed_at`).

| Candidate | License (from the repo's LICENSE) | Activity | Verdict |
|---|---|---|---|
| [fbsamples/whatsapp-api-examples](https://github.com/fbsamples/whatsapp-api-examples) (Meta's official samples; includes `receive-webhook-js`, `signature-validation-with-webhooks-payloads`, `chatbot-amazon-lex-lambda-js`) | Custom Meta license: free to use/modify/distribute "in connection with the web services and APIs provided by Facebook", subject to the Facebook Platform Policy. Not MIT/Apache, not OSI. | Latest commit 2023-06-07; the samples are a set of unrelated demos (JS, Java, Python), none is an AI auto-reply bot. | Rejected as a base: non-permissive custom license, stale, wrong shape. Used as a reference for the webhook payload shape only. |
| [WhatsApp/WhatsApp-Nodejs-SDK](https://github.com/WhatsApp/WhatsApp-Nodejs-SDK) | Meta custom (NOASSERTION) | Archived, last push 2023-06-07 | Rejected: archived. |
| [chatwoot/chatwoot](https://github.com/chatwoot/chatwoot) | MIT for everything outside `enterprise/`; `enterprise/` has its own license | Active (pushed 2026-10-04) | Rejected for this offer: a full Rails + Vue inbox with Postgres/Redis/Sidekiq, far too heavy for "bare bones", and the license is split. Good project, different product. |
| [baptisteArno/typebot.io](https://github.com/baptisteArno/typebot.io) (Typebot) | Functional Source License 1.1 (Apache-2.0 future license). **Source-available, not open source**, and it restricts competing use. (It used to be AGPL; it is not any more.) | Active (pushed 2026-09-30) | Rejected: FSL is a problem for a company redistributing it; large visual builder. |
| [devlikeapro/waha](https://github.com/devlikeapro/waha) (Apache-2.0), Evolution API (search turned up no canonical repo under the expected name) | WAHA: Apache-2.0 core | Active | **Ruled out on principle.** These drive WhatsApp Web / unofficial sessions (browser or reverse-engineered websocket), not the official Cloud API. The point of this offer is Meta-approved, compliant messaging with your own app. |
| Botpress, n8n templates | Not evaluated in depth | n/a | Not minimal; n8n is under a source-available (Sustainable Use) license. Not verified here, so treat as unchecked. |
| Search for small MIT TypeScript "WhatsApp Cloud API + OpenAI" templates (`gh search repos`, TypeScript, sorted by stars) | n/a | No result met the bar: nothing both permissive, recently maintained, and doing signature-verified webhooks with idempotency and opt-out handling. | None found worth forking. |

## Why build

The bar was: permissive license, small and readable, official Cloud API with signature-verified webhooks, maintained, TypeScript/Node. No candidate met all five. The needed code is small (about 400 lines of TypeScript with one runtime dependency, `better-sqlite3`), so a clean MIT build is cheaper to maintain and easier to audit than carrying an upstream's history, license caveats, and features nobody asked for.

## Re-check before you rely on this

Licenses and activity change. If you revisit the research, re-run the checks against the repositories themselves rather than trusting this table.
