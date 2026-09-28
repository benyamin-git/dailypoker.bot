# 07 — Security

Model: a private, allowlisted bot handling play chips in a friend group. No payments, no
personal data beyond Telegram profile basics, no web surface for players. The main risks are
token leakage, spoofed webhooks, spam/abuse of the free tier, and accidental data exposure via
the public repository.

---

## 1. Threat model

| # | Threat | Impact | Control |
|---|---|---|---|
| T1 | Bot token leaks (repo, logs, screenshots) | Full bot takeover | Secrets via `wrangler secret`; `.dev.vars` gitignored; `.dev.vars.example` has placeholders only; no token in URLs or logs; repo scan before first push |
| T2 | Webhook endpoint discovered and spoofed | Fake game updates | `X-Telegram-Bot-Api-Secret-Token` constant-time compare **and** random `WEBHOOK_PATH` segment; only POST; reject anything else |
| T3 | Telegram retries / duplicate delivery | Double actions, double charges | `processed_updates` dedupe by `update_id` |
| T4 | Forged callback queries / replay of old buttons | Chip theft in-game | `callback_query.from.id` is authoritative; validate actor + turn + `matchId` + `turnId` against the documented `callback_data` schema (`05-architecture.md §6`); stale data rejected with private alert |
| T5 | Impersonation via username/display name | Social engineering | Never authorize by username; only by numeric Telegram `user_id` |
| T6 | Unknown groups add the bot, burn quota | Resource exhaustion | `ALLOWED_CHAT_IDS` allowlist; one polite reply, then silence; no processing, no storage |
| T7 | Spam / button mashing | Rate limits, cost | Per-user throttle in DO; stale-action rejection; outgoing queue caps |
| T8 | HTML/format injection via names | Broken messages, phishing-looking text | Escape `<`, `>`, `&` in every interpolated string; fixed emoji vocabulary; no raw user text in link labels |
| T9 | Data leak via logs | Privacy | Log only match id, action type, hashed chat id; never tokens, balances, names, or hole cards |
| T10 | Free-tier abuse (100k/day) | Bot goes dark | Allowlist + throttles + bounded storage; webhook route fails closed (no route without Worker) |
| T11 | Unexpected internal errors leaking internals | Info disclosure | Generic user-facing errors; detailed errors only to owner DM, redacted |
| T12 | Eval manipulation / unfair shuffling | Trust loss | CSPRNG shuffle in the engine; open-source auditable code; tests prove determinism with injected RNG |
| T13 | Admin route abuse | Worker takeover surface | `/admin/*` guarded by `x-admin-key` secret; only webhook-management operations; no group access |

## 2. Secrets & configuration

| Name | Type | Scope | Notes |
|---|---|---|---|
| `BOT_TOKEN` | secret | per env | From BotFather; rotate on suspicion |
| `WEBHOOK_SECRET` | secret | per env | 32+ random bytes for `setWebhook.secret_token` |
| `ADMIN_KEY` | secret | per env | Protects `/admin/*` |
| `ALLOWED_CHAT_IDS` | var | per env | Comma-separated; negative supergroup ids |
| `OWNER_USER_ID` | var | per env | Numeric id for owner-only commands |
| `BOT_USERNAME` | var | per env | For `t.me/<bot>` deep links |
| `WEBHOOK_PATH` | var | per env | Random hex segment (defense in depth) |
| `EFFECTS_ENABLED` | var | per env | Kill-switch for dice effects |

Rules: no secret ever committed; `.dev.vars` in `.gitignore`; rotate immediately if leaked;
changing `WEBHOOK_SECRET` or `WEBHOOK_PATH` requires re-running `register-webhook`.

## 3. Authorization matrix

| Actor | Allowed |
|---|---|
| Any group member | Group commands, join/leave, betting when in turn, `/top`, `/ping` |
| Player in DM | `/daily`, `/balance`, `/stats`, `/history`, `/cards`, `/rules` |
| Group admin | Nothing special (admin status is not an authorization signal) |
| Owner (`OWNER_USER_ID`) | `/version`, `/resetgroup`, admin routes via `ADMIN_KEY` |
| Non-allowlisted group | One polite reply max; no processing |

## 4. Constant-time comparison

`WEBHOOK_SECRET` header check compares bytes without early exit (manual XOR accumulator over
UTF-8 bytes; length check first). Kept in `src/util/` with a unit test (equal, unequal,
differing lengths, unicode).

## 5. Open-source hygiene (public repo)

Before first push:

1. `rg -n "bot[0-9]{6,}:|api_token|secret|ADMIN_KEY\s*=" --hidden` → must find only
   `.dev.vars.example` placeholders.
2. Confirm `.gitignore` covers `.dev.vars`, `.wrangler/`, `node_modules/`, `.env*`.
3. No real chat ids in the repo: committed `wrangler.jsonc` uses obvious placeholders (e.g.
   `-1001234567890`); real values are passed at deploy time with
   `wrangler deploy --var KEY:VALUE` (see `02-hosting.md`), and local dev reads the gitignored
   `.dev.vars`.
4. README explains self-hosting with the owner's own BotFather token; never ship a shared bot.
5. Git history starts clean (fresh `git init` on 2026-09-28, plan-only first commit; never
   amend secrets into history).
6. No LICENSE (owner decision R2) — README states this explicitly so users are not misled.

## 6. Fairness & trust

- Shuffling uses `crypto.getRandomValues` (CSPRNG) inside the Durable Object.
- Owner chose no published deck hash (G10); the fairness argument is auditable open-source
  code plus the deterministic engine test suite.
- Revisit as backlog: optional commit-reveal deck hash per hand.

## 7. ToS / legal posture

- Play chips only; no payments, no transfers between players, no real-money settlement.
- No external assets (stickers/images) shipped; only Telegram built-in effects.
- Task before public launch: read the current Telegram Bot Developer ToS wording on gambling
  and record the conclusion in this file (open item in `01-decisions.md`).

## 8. Incident playbook

| Incident | Steps |
|---|---|
| Bot token leaked | BotFather → Revoke token → `wrangler secret put BOT_TOKEN` (both envs) → re-register webhook → audit recent group activity |
| Webhook secret leaked | Rotate `WEBHOOK_SECRET`, re-register webhook |
| `ADMIN_KEY` leaked | Rotate, redeploy |
| Cloudflare API token leaked | Revoke in dashboard, create new scoped token |
| Spam group added bot | Remove from `ALLOWED_CHAT_IDS`; the bot goes silent within one update |
| Runaway usage | Set `EFFECTS_ENABLED=false`, disable webhook via `/admin/delete-webhook`, investigate |

## 9. Security testing (M0–M4)

- Unit: constant-time compare, HTML escaping, stale callback rejection, allowlist rejection,
  update dedupe.
- Integration (DO): replay the same `update_id` twice → single effect; callback from a
  non-player → private alert only; 10 rapid actions → one accepted.
- Manual: attempt webhook POST without secret header → 403; with wrong path → 404.
