# dailypoker.bot

A private Telegram poker bot for a friend group: one hand of No-Limit Texas Hold'em per day,
played entirely with inline buttons inside a Telegram group. Play chips only — no payments, no
transfers, no real-money stakes.

Runs 100% on the Cloudflare Workers free plan (Worker + one SQLite-backed Durable Object per
group). No servers, no tunnels, no web UI for players.

Every action gets its own group message: the action is the headline, the table state follows,
and the last line says who is next.

```
🔥 Beny raises to 40

🃏 Hand #12 — Flop · 💰 Pot 210 · cap 100

Board: A♠ K♦ 7♣ — —

Still in
👤 Ali — in 40
👤 Beny — in 60
🚨 Mani — all-in 100 — Q♠ Q♦

Out
✖ Rasa — in 10

⏭ Next: Ali — call 20 · 60s to act

[ Fold ] [ Call 20 ] [ Raise ▾ ] [ 🂠 Cards ]
```

> The mocks in this README are text stand-ins for the real Telegram messages.

## Ruleset

One hand per day, triggered by a player with `/newmatch` in the group. Classic No-Limit
Hold'em with fixed blinds, a short clock, and simplification-first choices:

| Rule | v1 |
|---|---|
| Table size | 2–9 players |
| Stacks | 100 max in per hand (the entry counts toward it); balances adjust by hand result |
| Entry | 10 each, posted at the deal (no blinds) |
| Buy-in | one hand at a time; rejoin next hand |
| Turn timer | 60 seconds, then auto check/fold |
| Raise rule | min-raise increments, bet sizes are multiples of 10 |
| All-in | short all-in does not reopen the action for players who already acted |
| Side pots | full side-pot handling with split-pot remainders |
| Daily chips | `/daily` in DM grants 200 chips once per rolling 24 h |
| Bankruptcy | broke players can still join hands (all-in for what they have); `/daily` tops them up |

## Commands

Group:

| Command | Who | What |
|---|---|---|
| `/newmatch` | anyone | open the lobby |
| `/join`, `/leave` | anyone | enter/exit the lobby |
| `/deal`, `/cancel` | starter | start the hand / cancel the lobby |
| `/top` | anyone | group leaderboard |
| `/rules` | anyone | rules summary in chat |
| `/fa`, `/en` | anyone | switch the bot language (Persian/English) |
| `/ping` | anyone | liveness check |

Private chat (DM):

| Command | What |
|---|---|
| `/start` | join onboarding + deep links |
| `/daily` | claim 200 chips (rolling 24 h cooldown) |
| `/balance` | your bankroll |
| `/stats` | hands, wins, net |
| `/history [n]` | last n hands (default 5, max 20) |
| `/cards` | your hole cards for the current hand |
| `/rules` | full rules |
| `/fa`, `/en` | switch the bot language (Persian/English) |

The language is a per-group setting: `/fa` or `/en` from the group (or from DM) switches every
group message, button and DM for that group's table. English is the default.

Owner only: `/version`, `/resetgroup` — the latter replies in DM with a reset button; tap it, then
type `RESET` to wipe the group's players, balances and history.

## Self-hosting quick start

Requirements: [Bun](https://bun.sh), a Cloudflare account (free plan), and a bot token from
[@BotFather](https://t.me/BotFather).

<details>
<summary><strong>1. Create the Telegram bot</strong></summary>

In BotFather: `/newbot` → pick a name and username (e.g. `DailyPokerBot`) → save the token.
Recommended settings:

- `/setdescription`, `/setabouttext`, `/setuserpic` (optional)
- `/setprivacy` → **Disable** (the bot must see group messages to handle commands)
- Add the bot to your group and grant it **delete messages** (needed for cleanup)

</details>

<details>
<summary><strong>2. Deploy the Worker</strong></summary>

```bash
bun install
bunx wrangler login           # or export CLOUDFLARE_API_TOKEN

bunx wrangler secret put BOT_TOKEN      # --env dev for the dev worker
bunx wrangler secret put WEBHOOK_SECRET # random 32+ bytes, e.g. openssl rand -hex 32
bunx wrangler secret put ADMIN_KEY      # random, protects /admin/*
```

Non-secret config is passed at deploy time (the committed `wrangler.jsonc` keeps placeholders
only):

```bash
bunx wrangler deploy \
  --var ALLOWED_CHAT_IDS:<your-group-chat-id> \
  --var OWNER_USER_ID:<your-telegram-user-id> \
  --var BOT_USERNAME:<your-bot-username> \
  --var WEBHOOK_PATH:<random-hex>
```

To find the group chat id and your user id, add the bot to the group first and check the
`wrangler tail` logs, or use a helper bot like `@userinfobot`. Group ids are negative and start
with `-100`.

</details>

<details>
<summary><strong>3. Register the webhook (from the Worker itself)</strong></summary>

If `api.telegram.org` is unreachable from your machine, let the Worker register the webhook for
you (also configures the command menu):

```bash
curl -sS -X POST "https://<worker-name>.<account>.workers.dev/tg/$WEBHOOK_PATH/admin/register-webhook" \
  -H "x-admin-key: $ADMIN_KEY"
curl -sS -X POST "https://<worker-name>.<account>.workers.dev/tg/$WEBHOOK_PATH/admin/set-commands" \
  -H "x-admin-key: $ADMIN_KEY"
```

Check status anytime:

```bash
curl -sS "https://<worker-name>.<account>.workers.dev/tg/$WEBHOOK_PATH/admin/webhook-info" \
  -H "x-admin-key: $ADMIN_KEY"
```

</details>

<details>
<summary><strong>4. Play</strong></summary>

1. Add the bot to the group (it must be allowlisted, else it replies once and goes silent).
2. `/newmatch` → everyone taps **Join** → starter taps **Deal**.
3. Every check, call, bet, raise, fold and timeout posts a fresh message with the action on
   top and whose turn it is at the bottom; hole cards arrive in DM.
4. After the hand, the result message offers **Show** and **Rematch**.

</details>

A dev environment (`--env dev`) mirrors production with its own bot, allowlist and worker;
`EFFECTS_ENABLED=false` turns the dice effects off for quiet dev testing.

### Configuration reference

| Name | Kind | Purpose |
|---|---|---|
| `BOT_TOKEN` | secret | BotFather token |
| `WEBHOOK_SECRET` | secret | `X-Telegram-Bot-Api-Secret-Token` value for the webhook |
| `ADMIN_KEY` | secret | guards `/admin/*` routes |
| `ALLOWED_CHAT_IDS` | var | comma-separated group ids (v1: exactly one) |
| `OWNER_USER_ID` | var | numeric Telegram id for owner commands |
| `BOT_USERNAME` | var | used in `t.me/<bot>` deep links |
| `WEBHOOK_PATH` | var | random path segment for the webhook (defense in depth) |
| `EFFECTS_ENABLED` | var | `true`/`false` — Telegram dice effects on hand end |

## Development

```bash
bun install
bun run dev          # local worker + DOs (wrangler dev, no Telegram network)
bun run test         # vitest: unit (node) + workers (miniflare) projects
bun run typecheck    # tsc --noEmit
bun run lint         # biome check
bun run format       # biome check --write
```

Tests in `test/engine/` run the pure engine (including a heavy `TEST_HEAVY=1` oracle against
`pokersolver`); `test/do/` boots the real Worker + TableDO in Miniflare with a mocked Telegram
transport; `test/noeffects/` runs the same DO with `EFFECTS_ENABLED=false`.

User-facing strings live in `src/telegram/messages/`: one catalogue per language (`en.ts`,
`fa.ts`) implementing a shared `Messages` interface, with `/fa` and `/en` toggling the group's
choice (persisted in the Durable Object's `meta` table).

The engine (`src/engine/`) is deliberately import-free from the rest of the codebase — a
purity test enforces it — so it can be reused and audited standalone.

Local secrets live in `.dev.vars` (gitignored; see `.dev.vars.example`).

## Architecture

```
Telegram ──webhook──▶ Worker (src/index.ts)
                        │ verify secret header, dedupe update_id
                        ▼
               TableDO (one per group, src/game/table-do.ts)
                 ├─ pure engine (src/engine/)
                 ├─ SQLite: players, matches, stats
                 ├─ turn alarm (60 s)
                 └─ throttled Telegram sender (src/telegram/)
```

All game state lives in the Durable Object; the Worker is a thin router.

## Security notes

- This is a **play-money** game: no payments, no chip transfers between players, no
  real-value settlement.
- Secrets are never committed; `.dev.vars` is gitignored; only placeholders ship in the repo.
- The webhook is protected by a secret header (constant-time compare) and a random path.
- All user-facing strings are HTML-escaped; callbacks validate actor, match, turn and action
  server-side.
- Data retention: hand history is pruned to the newest 1,000 matches per group; the owner can
  wipe all group data from DM (`/resetgroup` → button → type `RESET`).

## License

[DO WHATEVER YOU WANT LICENSE](LICENSE).
