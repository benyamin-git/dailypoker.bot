# 00 — Overview

**Project:** `dailypoker.bot`
**Status:** Implementation in progress (M0 code complete 2026-09-28; deploy steps pending owner).
Planning completed 2026-09-28.
**One-liner:** A social-first poker bot for private friend groups that lives entirely inside a
Telegram group chat and runs on the Cloudflare Workers free tier.

---

## Vision

Friends play a fast, custom poker variant inside their existing Telegram group chat. The chat
stays the game table: banter, reactions and results all happen in the group. The bot handles
the rules, hidden cards (via DM), chips and stats — never asking anyone to leave the group or
learn a complex interface.

## Goals

1. **Social first** — maximize time spent in the group chat; the table is a chat message.
2. **Zero cost, zero maintenance** at friend-group scale (Cloudflare free tier).
3. **No VPN, no port forwarding, no home-server uptime dependency** at runtime.
4. **Secure by default** — allowlisted groups, least privilege, secrets never in the repo.
5. **Lightweight and auditable** — small pure game engine, few dependencies, tests that prove
   the rules.
6. **Safe to open-source** — no leaked tokens, chat IDs or personal data; fairness auditable.
7. **Fun** — animated effects at dramatic moments, visible banter, leaderboards.

## Non-goals (v1)

- No Telegram Mini App / web UI. (Also: `web_app` inline buttons are private-chat-only, so a
  group-first Mini App was never viable.)
- No real money, payments or IOUs — play chips only.
- No poker variants (Omaha, etc.) and no multi-hand sessions — one hand = one match.
- No turn notifications / pings (owner decision).
- No i18n — English UI only in v1.
- No CI/CD — manual `wrangler deploy`.
- No public multi-tenant service — each operator runs their own allowlisted instance.

## Principles

1. **Group chat is the table; private info goes to DM.** Hole cards and personal stats in DM;
   everything else in the group.
2. **One message lifecycle:** Lobby → Table → Result, edited in place and pinned.
3. **Pure engine, no I/O.** Deterministic with injected randomness; all Telegram and database
   work happens outside it.
4. **Uniform effective stacks by construction.** Join requires ≥100 chips and the cap is 100
   total per hand — therefore **side pots cannot exist**. This deletes a whole class of bugs.
5. **Least privilege everywhere** — bot admin rights limited to pin + delete; allowlisted
   groups; owner-only maintenance commands.
6. **Free-tier discipline** — bounded storage, throttled edits, no polling (webhooks only).
7. **Docs before code** — this plan folder is the source of truth; code follows it.

## Plan index

| File | Contents |
|---|---|
| `00-overview.md` | This document: vision, goals, principles, glossary |
| `01-decisions.md` | Full decision log with rationale + open items |
| `02-hosting.md` | Cloudflare topology, environments, secrets, deploy runbook, budget |
| `03-game-rules.md` | Normative ruleset, edge cases, invariants, worked example |
| `04-ux-flows.md` | Every user flow with message/button mockups |
| `05-architecture.md` | Modules, engine API, DO design, request paths, failure modes |
| `06-data-model.md` | Durable Object SQLite schema, retention, migrations |
| `07-security.md` | Threat model, controls, open-source hygiene, incident playbook |
| `08-repo-tooling.md` | Repo layout, scripts, tooling, testing strategy, README outline |
| `09-roadmap.md` | Milestones M0–M4 with acceptance criteria, backlog, open items |

## Glossary

- **Balance / bankroll** — per-group play chips owned by a player.
- **Match** — one poker hand; the entire game loop.
- **Ante / preblind** — the 10 chips every player pays to enter a match.
- **Contribution** — total chips a player has put into the current match (ante included).
- **Cap** — 100 chips total contribution per player per match; reaching it = all-in.
- **Room** — remaining contribution space (`100 − contribution`).
- **Deal** — the starter's action that begins the hand.
- **Lobby** — the join phase before the deal.
- **Take over** — button (`/takeover`) that hands the starter role to a remaining player
  after the starter leaves the lobby.
- **DO** — Cloudflare Durable Object (one per group, SQLite-backed).
- **Engine** — the pure TypeScript game-logic module (no I/O).
