# Contributing

This repo is deliberately small. Fixes, doc corrections and tests are welcome; new features usually are not (no dashboards, broadcasts or multi-tenant code: see the README's "What it is NOT").

- `npm ci && npm test && npm run build` must pass.
- Any change to sending, opt-out, windowing or webhook verification needs a test.
- Never log message text, phone numbers or secrets.
- Keep dependencies at the minimum; justify any new one in the PR.
