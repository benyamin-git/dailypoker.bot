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
| Allowlist | dev group id(s) | real group id(s) |
| Purpose | M0–M4 testing | live friend group |

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
bunx wrangler deploy --env dev

# register the Telegram webhook (the Worker calls Telegram for us)
curl -sS -X POST "https://dailypokerbot-dev.<account>.workers.dev/tg/$WEBHOOK_PATH/admin/register-webhook" \
  -H "x-admin-key: $ADMIN_KEY"
# same for production with --env production and the prod URL
```

Admin routes (all require `x-admin-key`):

| Route | Effect |
|---|---|
| `POST /tg/<path>/admin/register-webhook` | Calls `setWebhook` with the public URL, `secret_token`, `allowed_updates=[message, callback_query, my_chat_member]`, `drop_pending_updates=true` |
| `GET /tg/<path>/admin/webhook-info` | Proxies `getWebhookInfo` for debugging |
| `POST /tg/<path>/admin/store-webhook` | Deactivates webhook (`deleteWebhook`) |

Rollback: `bunx wrangler rollback --env <env>` (Cloudflare keeps recent versions).

## Request path

1. Telegram POSTs an update to `/tg/<secret-path>`.
2. Worker: constant-time compare `X-Telegram-Bot-Api-Secret-Token`; reject non-POST; extract
   `chat.id`; look up the group's DO stub; forward the raw body; return `200` only after the
   DO acknowledges (Telegram retries non-2xx).
3. DO: dedupe by `update_id`; process; persist; send Telegram messages; (re)schedule the turn
   alarm. All work is fast; no `waitUntil` needed for correctness.
4. Duplicate deliveries are harmless (`update_id` dedupe table in DO SQLite).

## Timers

- One DO alarm = the current turn deadline (`now + 60s`).
- Every accepted action reschedules the alarm.
- Alarm handler applies the automatic action (check if free, else fold) and follows the same
  event pipeline.
- `setAlarm()` costs 1 row write; a hand uses ≤ ~10 alarms — negligible on the free tier.

## Free-tier budget (verified against official limits)

Per 4-player hand (rough):

| Resource | Per hand | Free tier/day | Headroom |
|---|---|---|---|
| Worker requests (webhook updates ≈ 15) | ~15 | 100,000 | ~6,600 hands |
| DO requests (updates + alarms ≈ 23) | ~23 | 100,000 | ~4,300 hands |
| DO row writes (~2/action + alarms) | ~40 | 100,000 | ~2,500 hands |
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
