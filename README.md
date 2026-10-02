# dailypoker.bot

dailypoker.bot is a private Telegram bot that runs No-Limit Texas Hold'em in a group chat. One
hand is played at a time; each action is posted as a group message and each control is an inline
button. Hole cards and personal stats are sent by DM. Chips are play money: there are no payments
and no chip transfers between players.

It runs entirely on the Cloudflare Workers free plan, as one Worker plus a SQLite-backed Durable
Object per Telegram group. There is no player-facing web UI and no home server to keep running.

> Single-tenant by design. A deployment serves one allowlisted Telegram group with its own bot
> token. English is the default language; a group can switch to Persian with `/fa`.

The group chat is the table: results, banter and the leaderboard stay in the group, while hidden
information goes to DM. Keeping the game in the existing chat, at friend-group scale, is the
point — it needs no server to stay up and no player has to leave Telegram.

## What it looks like

Every action is a new group message: the action on top, the table state below it, and whose turn
is next on the last line.

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

*This is an illustration of the message layout using the bot's own templates. It was not captured
from a live chat.*

## Ruleset

One hand is one match. A player opens a lobby with `/newmatch`, others join, and the starter
deals. Each group keeps its own balances and history.

| Rule | Value |
|---|---|
| Players | 2–9 |
| Entry | 10 chips each, posted at the deal (no blinds) |
| Cap | 100 chips contributed per player per hand, entry included |
| All-in | a player is all-in when their contribution reaches the cap |
| Minimum raise | matches the previous raise; bets and raises are multiples of 10 |
| Turn timer | 60 seconds; timeout checks when checking is free, otherwise folds |
| Split pots | divided evenly, with the remainder going to the earliest hand position |
| Join requirement | at least 100 chips |
| Daily chips | `/daily` in DM grants 200 chips with a 24-hour cooldown |

There are no side pots: every player has the same 100-chip effective stack, so a single pot is
always sufficient.

## Commands

Group:

| Command | Who | What |
|---|---|---|
| `/newmatch` | anyone | open a lobby |
| `/join`, `/leave` | anyone | enter or exit the lobby |
| `/deal`, `/cancel` | starter | start the hand or cancel the lobby |
| `/takeover` | anyone | become the starter |
| `/fold`, `/check`, `/call`, `/allin` | the player on turn | betting actions |
| `/raise <amount>` | the player on turn | raise; the amount is a multiple of 10 |
| `/show` | a player | reveal a mucked hand |
| `/cards` | anyone | re-send your hole cards by DM |
| `/balance` | anyone | your chip balance |
| `/top` | anyone | group leaderboard (top five with a positive balance) |
| `/rules`, `/help` | anyone | rules summary and command list |
| `/fa`, `/en` | anyone | switch the bot language |
| `/ping` | anyone | liveness check |

Private chat (DM):

| Command | What |
|---|---|
| `/start` | welcome and join links |
| `/daily` | claim 200 chips |
| `/balance`, `/stats`, `/history [n]` | balance, record, and last hands |
| `/cards` | re-send your hole cards |
| `/rules`, `/help` | rules and command list |
| `/fa`, `/en` | switch the bot language |

`/history` defaults to five hands and accepts up to 20. The language is a per-group setting
persisted in the Durable Object; `/fa` or `/en` from the group or DM switches every group message,
button and DM for that group's table.

Owner commands are DM-only: `/version` reports the bot version and webhook status, and
`/resetgroup` replies with a button, then requires typing `RESET` to wipe the group's players,
balances and history.

## Self-hosting

Requirements: [Bun](https://bun.sh), a Cloudflare account (free plan), and a bot token from
[@BotFather](https://t.me/BotFather).

### 1. Create the bot

In BotFather: `/newbot` to pick a name and username (for example `DailyPokerBot`) and save the
token. Disable privacy mode with `/setprivacy` → **Disable**, so the bot can read group commands.
Optionally set the description and user picture. Add the bot to the group and open a DM with it,
because hole cards are delivered there.

### 2. Configure and deploy

```bash
bun install
bunx wrangler login           # or export CLOUDFLARE_API_TOKEN

bunx wrangler secret put BOT_TOKEN --env dev
bunx wrangler secret put WEBHOOK_SECRET --env dev   # random 32+ bytes, e.g. openssl rand -hex 32
bunx wrangler secret put ADMIN_KEY --env dev         # random, guards /admin/* routes
```

`wrangler.jsonc` keeps placeholder values only. Pass the real non-secret configuration at deploy
time:

```bash
bunx wrangler deploy --env dev \
  --var ALLOWED_CHAT_IDS:<your-group-chat-id> \
  --var OWNER_USER_ID:<your-telegram-user-id> \
  --var BOT_USERNAME:<your-bot-username> \
  --var WEBHOOK_PATH:<random-hex>
```

Group ids are negative and start with `-100`; a helper bot such as `@userinfobot` reports both the
group id and your user id. For the live worker, use `--env production` (`bun run deploy:prod`);
`bun run deploy:dev` and `bun run deploy:prod` wrap `wrangler deploy` for the two environments.

### 3. Register the webhook

The Worker can register its own webhook, which is useful when `api.telegram.org` is unreachable
from your machine. The calls also install the command menu:

```bash
curl -sS -X POST "https://<worker-name>.<account>.workers.dev/tg/$WEBHOOK_PATH/admin/register-webhook" \
  -H "x-admin-key: $ADMIN_KEY"
curl -sS -X POST "https://<worker-name>.<account>.workers.dev/tg/$WEBHOOK_PATH/admin/set-commands" \
  -H "x-admin-key: $ADMIN_KEY"
```

Check status with `/admin/webhook-info`, and remove the webhook with `/admin/delete-webhook`
(POST). All admin routes use the same `x-admin-key` header.

### 4. Play

1. Add the bot to the group. Chat ids must be in `ALLOWED_CHAT_IDS`; otherwise the bot replies
   once and stays silent.
2. `/newmatch` → everyone taps **Join** → the starter taps **Deal**.
3. Each action posts a fresh message; hole cards arrive in DM.
4. After the hand, the result message offers **Show** and **Rematch**.

### Configuration

| Name | Kind | Purpose |
|---|---|---|
| `BOT_TOKEN` | secret | BotFather token |
| `WEBHOOK_SECRET` | secret | `X-Telegram-Bot-Api-Secret-Token` value for the webhook (16+ chars) |
| `ADMIN_KEY` | secret | guards the `/admin/*` routes (16+ chars) |
| `ALLOWED_CHAT_IDS` | var | comma-separated group ids; exactly one is accepted |
| `OWNER_USER_ID` | var | numeric Telegram id for owner commands |
| `BOT_USERNAME` | var | used in `t.me/<bot>` deep links |
| `WEBHOOK_PATH` | var | random path segment for the webhook (8+ chars) |
| `EFFECTS_ENABLED` | var | `true`/`false` — Telegram dice effects on hand end |

A dev environment (`--env dev`) mirrors production with its own bot, allowlist and worker.
`EFFECTS_ENABLED=false` turns the dice effects off for quiet testing.

## Development

```bash
bun install
bun run dev          # wrangler dev --env dev: local Worker and Durable Objects
bun run test         # vitest: unit, workers, and workers-noeffects projects
bun run test:unit    # node-only unit tests
bun run test:workers # Miniflare tests for the Worker and TableDO
bun run test:heavy   # TEST_HEAVY=1 oracle test against pokersolver
bun run typecheck    # tsc --noEmit
bun run lint         # biome check .
bun run format       # biome format --write .
```

Tests in `test/engine/`, `test/game/`, `test/telegram/` and `test/util/` run in Node;
`test/do/` boots the real Worker and TableDO in Miniflare with a mocked Telegram transport;
`test/noeffects/` runs the same Durable Object with `EFFECTS_ENABLED=false`.

User-facing strings live in `src/telegram/messages/`, one catalogue per language (`en.ts`,
`fa.ts`) behind a shared `Messages` interface. The engine in `src/engine/` imports nothing from
the rest of the codebase; a purity test enforces that, so it can be audited standalone.

Local secrets live in `.dev.vars` (gitignored; see `.dev.vars.example`).

## Architecture

```
Telegram ──webhook──▶ Worker (src/index.ts)
                        │ verify secret header, dedupe update_id
                        ▼
               TableDO (one per group, src/game/table-do.ts)
                 ├─ pure engine (src/engine/)
                 ├─ SQLite: players, matches, stats (src/game/store.ts)
                 ├─ turn alarm (60 s)
                 └─ throttled Telegram sender (src/telegram/)
```

All game state lives in the Durable Object; the Worker is a thin router.

## Security notes

- This is a play-money game: no payments, no chip transfers between players, no real-value
  settlement.
- Secrets are never committed; `.dev.vars` is gitignored, and only placeholders ship in the repo.
- The webhook is protected by a secret header (constant-time compare) and a random path; the
  admin routes use a separate constant-time key check.
- User-facing strings are HTML-escaped, and callbacks validate actor, match, turn and action
  server-side. Updates are deduplicated by `update_id`.
- Hand history is pruned to the newest 1,000 matches per group. The owner can wipe all group data
  from DM with `/resetgroup`.

## License

[DO WHATEVER YOU WANT LICENSE](LICENSE).
