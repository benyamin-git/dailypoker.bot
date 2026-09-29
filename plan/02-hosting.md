# 02 — Hosting & Operations

Runtime is **100% Cloudflare Workers free plan**. Nothing runs on the home server except
development and `wrangler deploy`. No inbound ports, no tunnels, no VPN.

---

## Topology

```
┌─────────────┐   HTTPS webhook (updates)    ┌───────────────────────────────┐
│  Telegram   │ ───────────────────────────▶ │  Cloudflare Worker            │
│  servers    │                              │  POST /tg/<secret-path>       │
│             │ ◀─────────────────────────── │   ├─ verify secret header     │
└─────────────┘   Bot API calls (fetch)      │   └─ route by chat_id ──┐     │
                                             └─────────────────────────┼─────┘
                                                                       ▼
                                                       ┌──────────────────────────┐
                                                       │  Durable Object (per     │
                                                       │  Telegram group)         │
                                                       │  ├─ pure game engine     │
                                                       │  ├─ SQLite: bankroll,    │
                                                       │  │   history, stats      │
                                                       │  └─ 60s turn alarm       │
                                                       └──────────────────────────┘
```

- Users never load any web page; `workers.dev` reachability from Iran is irrelevant.
- The Worker's outbound calls to `api.telegram.org` originate from Cloudflare's edge, which
  Telegram is not blocked from.
- Webhook registration is performed **by the Worker** (see runbook), because
  `api.telegram.org` is unreachable from the dev machine.

## Components

| Component | Binding | Purpose |
|---|---|---|
| Worker `dailypokerbot` | — | Prod webhook receiver + admin routes |
| Worker `dailypokerbot-dev` | — | Dev/staging webhook receiver |
| DO class `TableDO` | `TABLE` (Durable Object namespace) | One instance per group: engine, storage, timers, throttled Telegram sends |
| Secrets (per env) | `BOT_TOKEN`, `WEBHOOK_SECRET`, `ADMIN_KEY` | Never in repo |
| Vars (per env) | `ALLOWED_CHAT_IDS`, `OWNER_USER_ID`, `BOT_USERNAME`, `WEBHOOK_PATH`, `EFFECTS_ENABLED` | Non-secret config |

## Environments

`wrangler.jsonc` defines two environments; each has its own bot, secrets and allowlist:

| | dev | production |
|---|---|---|
| Worker | `dailypokerbot-dev` | `dailypokerbot` |
| Bot | dev bot (separate BotFather token) | prod bot |
| Allowlist | dev group id | real group id |
| Purpose | M0–M4 testing | live friend group |

Each environment allowlists **exactly one group** in v1 (env validation rejects multiple ids);
DM commands (`/daily`, `/balance`, `/stats`, `/history`) target that group's economy.

## Deploy runbook (manual)

```bash
# one-time
bun install
# either interactive login, or set CLOUDFLARE_API_TOKEN (API reachable from Iran; dashboard is not)
bunx wrangler login

# per environment (example: dev)
bunx wrangler secret put BOT_TOKEN        --env dev
bunx wrangler secret put WEBHOOK_SECRET   --env dev   # random 32+ bytes hex
bunx wrangler secret put ADMIN_KEY        --env dev   # random, protects admin routes
# non-secret config: committed wrangler.jsonc keeps placeholders; real values go here
bunx wrangler deploy --env dev \
  --var ALLOWED_CHAT_IDS:<dev-group-id> \
  --var OWNER_USER_ID:<your-user-id> \
  --var BOT_USERNAME:<dev-bot-username> \
  --var WEBHOOK_PATH:<random-hex>

# register the Telegram webhook (the Worker calls Telegram for us)
curl -sS -X POST "https://dailypokerbot-dev.<account>.workers.dev/tg/$WEBHOOK_PATH/admin/register-webhook" \
  -H "x-admin-key: $ADMIN_KEY"

# configure the command menus (once, and after command changes)
curl -sS -X POST "https://dailypokerbot-dev.<account>.workers.dev/tg/$WEBHOOK_PATH/admin/set-commands" \
  -H "x-admin-key: $ADMIN_KEY"
# same for production with --env production and the prod URL
```

Admin routes (all require `x-admin-key`):

| Route | Effect |
|---|---|
| `POST /tg/<path>/admin/register-webhook` | Calls `setWebhook` with the public URL, `secret_token`, `allowed_updates=[message, callback_query, my_chat_member]`, `drop_pending_updates=true` |
| `GET /tg/<path>/admin/webhook-info` | Proxies `getWebhookInfo` for debugging |
| `POST /tg/<path>/admin/delete-webhook` | Deactivates webhook (`deleteWebhook`) |
| `POST /tg/<path>/admin/set-commands` | Calls `setMyCommands` for the group and private scopes |

Rollback: `bunx wrangler rollback --env <env>` (Cloudflare keeps recent versions).

### Operating from Iran (dev machine)

Findings from the first dev deploy (2026-09-29), all confirmed on the owner's network:

- `*.workers.dev` is unreachable from the dev machine: DNS resolves (local resolver and
  Cloudflare DoH both answer), but HTTPS times out on IPv4 and IPv6. Telegram → Worker
  delivery is unaffected (Telegram connects to Cloudflare's edge, not to the dev machine).
- Wrangler API traffic (deploy, secrets, KV, schedules) works fine with
  `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`; the dashboard may need a VPN.
- `wrangler dev --remote` is unusable from here: the preview tunnel drops every request
  ("Network connection lost"), and SQLite-backed DOs are local-mode only anyway.
- `wrangler tail` cannot hold its connection (keep-alive ping lost).
- A Worker subrequest to another Worker of the **same account** on `*.workers.dev` fails
  (HTTP 404 body / `error code: 1042`).

Consequence: the admin `curl` commands above cannot be run from the dev machine. When
webhook registration must happen before the owner can test, use the edge-side helper pattern:

1. Deploy a throwaway cron Worker in a scratch directory (`crons: ["* * * * *"]`) that calls
   `api.telegram.org` directly (`setWebhook`, `setMyCommands`, `getWebhookInfo`) using the
   same values, and writes the JSON responses to a temporary KV namespace.
2. Read the results with
   `bunx wrangler kv key get state --namespace-id <id> --remote` — `--remote` is required,
   the KV commands default to local storage.
3. Delete the helper Worker and the KV namespace.

Alternative: run the same `curl` calls from any network that can reach `*.workers.dev`
(VPN, phone hotspot), or add a thin dashboard/API path later.

## Request path

1. Telegram POSTs an update to `/tg/<secret-path>`.
2. Worker: constant-time compare `X-Telegram-Bot-Api-Secret-Token`; reject non-POST; extract
   `chat.id`; look up the group's DO stub; forward the raw body; return `200` only after the
   DO acknowledges (Telegram retries non-2xx).
3. DO: dedupe by `update_id`; process; persist; send Telegram messages; (re)arm the
   next-deadline alarm (see Timers). All work is fast; no `waitUntil` needed for correctness.
4. Duplicate deliveries are harmless (`update_id` dedupe table in DO SQLite).

## Timers

- The DO keeps a **next-deadline scheduler**: every pending deadline is persisted in state
  (turn deadline, lobby expiry, all-in runout board steps, retry backoff), and a single
  `setAlarm()` is always armed for the earliest one.
- Every accepted action refreshes the turn deadline and re-arms the alarm.
- When the alarm fires, every due deadline is applied (timeout → check if free else fold;
  lobby TTL → expire; runout step → next board line; backoff → retry the queued send) and the
  alarm is re-armed for the next deadline.
- All-in runouts advance one alarm step at a time (~2s apart), so the DO can hibernate
  between steps instead of sleeping inside a handler.
- `setAlarm()` costs 1 row write; a hand uses ≤ ~15 alarms — negligible on the free tier.

## Free-tier budget (verified against official limits)

Per 4-player hand (rough):

| Resource | Per hand | Free tier/day | Headroom |
|---|---|---|---|
| Worker requests (webhook updates ≈ 15) | ~15 | 100,000 | ~6,600 hands |
| DO requests (updates + alarms ≈ 28) | ~28 | 100,000 | ~3,500 hands |
| DO row writes (~2/action + alarms) | ~45 | 100,000 | ~2,200 hands |
| DO duration | seconds | 13,000 GB-s | effectively infinite at this scale |
| DO storage (1,000 hands × ~5 KB) | — | 5 GB | ~1,000 groups |

A busy game night of 50 hands is <1% of the daily budget.

## Dev workflow

1. Write code + unit tests locally (no Telegram needed; engine is pure).
2. `bun run deploy:dev` → test on the phone with the dev bot in the dev group.
3. Verify in prod-group-shaped conditions (9 players, stale taps, 429s).
4. `bun run deploy:prod` → announce in the real group.

## Observability & maintenance

- `bunx wrangler tail --env dev` for live logs (verify reachability from Iran during M0).
- Workers Logs (dashboard) as backup.
- No PII in logs (see `07-security.md`); errors carry match id + hashed chat id only.
- Useful ops tasks: reset a group's storage (owner-only admin route), rotate `BOT_TOKEN`
  (BotFather revoke → set secret → re-register webhook), rotate `WEBHOOK_SECRET` + re-register.

## Failure modes & mitigations

| Failure | Mitigation |
|---|---|
| Telegram retries webhook (duplicate update) | `update_id` dedupe table |
| Telegram 429 rate limit | Respect `retry_after`, backoff, coalesce edits; state is already persisted so dropped sends are recoverable |
| Rapid button mashing | DO serializes; stale/duplicate actions rejected with a private alert |
| Worker CPU limit (10 ms) | Engine is tiny; no heavy crypto/loops; verify in M2 under 9-player load |
| DO eviction/hibernation | State is persisted per action; on wake, reload from SQLite |
| Free-tier exhaustion | Allowlist keeps usage bounded; fail-closed on webhook route (no silent bypass) |
| Bot removed from group | `my_chat_member` update → mark group inactive, stop timers |
