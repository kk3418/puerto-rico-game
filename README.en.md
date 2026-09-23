# Puerto Rico

[中文](README.md)

A browser implementation of Aleksander's classic board game *Puerto Rico*: one human vs local heuristic AI. The rules engine and UI are TypeScript. Play still runs in the browser; the backend handles accounts, match records, a structured captain's log, and end-game score verification.

You plant, build, produce goods, and ship them out. The goal is to have the most victory points when the game ends.

## Features

- 3 / 4 / 5 player games (you + the rest as AI)
- Two AI styles: balanced and aggressive
- Role rounds: Settler, Mayor, Builder, Craftsman, Trader, Captain, Prospector
- Building effects, colonist placement, ships and warehouses, end-game scoring
- Board hints and a Chinese UI
- Start as a guest with a nickname; optionally sign in with Google or GitHub to view your own stats
- Match events are written to the database; the server replays the engine at finish before recording the score
- Solo save / load (later multiplayer will require consent from every human)

End-game conditions match the original: the VP chip supply is exhausted, colonists cannot refill the colonist ship, or any player's city is full.

## Getting started

You need Node.js 18 or later, and Postgres (local Docker or an equivalent connection).

```bash
cp .env.example .env          # at least change SESSION_SECRET
docker compose up -d          # Postgres 16, port 5432
npm install
npx prisma migrate deploy
npm run dev
```

Open `http://localhost:5173` in a browser. `npm run dev` starts Vite and Express (`:3001`) together; the frontend proxies same-origin `/api` and sends the session cookie.

Guest play with a nickname still works when OAuth env vars are unset. Google / GitHub buttons appear only after the matching client ids are configured. For GitHub in development, set the callback to `http://localhost:5173/api/auth/github/callback`.

| Command | Description |
| --- | --- |
| `npm run dev` | Start frontend and API together |
| `npm run dev:client` | Vite only |
| `npm run dev:server` | Express only |
| `npm run build` | Type-check frontend and backend, then build the frontend |
| `npm run preview` | Preview the production build |
| `npm test` | Rules engine and backend unit tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run db:up` | Start Postgres from compose |
| `npm run db:deploy` | Apply Prisma migrations |

## How to play

1. Enter a nickname (required), pick player count and AI style, then press Start. Google / GitHub sign-in is optional.
2. Each round, in governor order, choose an unclaimed role and take that role's privilege and action.
3. The other players take the same role in turn (without the privilege).
4. Unchosen roles accumulate doubloons and become more tempting next round.
5. After the game ends, score from VP chips, building printed values, and large-building bonuses (Guild Hall, Residence, Fortress, Customs House, City Hall).

Roles:

| Role | Effect |
| --- | --- |
| Settler | Take a plantation or quarry |
| Mayor | Take colonists from the colonist ship and place them |
| Builder | Spend doubloons to construct a building |
| Craftsman | Produce goods from manned plantations and production buildings |
| Trader | Sell 1 barrel of goods to the trading house |
| Captain | Load goods onto cargo ships for victory points |
| Prospector | Take 1 doubloon (4- and 5-player games only; two in a 5-player game) |

Rule details follow the project's `Puerto rule us korrigiert 2 - Puerto-Rico-Rules.pdf`.

## Project structure

```
src/
  engine/     Pure rules engine: setup, legal actions, role resolution, scoring (no UI deps)
  agents/     PlayerAgent: HumanAgent, HeuristicAgent, turn loop
  ui/         React UI; state changes only through Action
  api/        Calls /api (session cookie)
  data/       Building definitions
server/
  prisma/     Postgres schema and migrations
  src/        Express: auth, matches, events, finish replay, saves
```

Core loop:

```
legal = getLegalActions(state)
action = await agent.chooseAction({ state, legalActions, playerId })
state = applyAction(state, action)   // only place game state changes
```

The current AI is heuristic scoring (balanced mode sometimes picks a second-best move), not an LLM. The UI never writes doubloons, goods, colonists, or similar fields directly.

## Extensibility (already reserved)

Realtime online play and LLM opponents are not built yet, but accounts and match records are in place. The remaining interfaces land when those features do:

1. **Engine has zero UI dependency** — `src/engine/` is pure TypeScript: no React, no `window` / DOM. The only state-change entry is `applyAction`.
2. **`GameState` / `Action` are JSON-serializable** — plain data only, so they round-trip through `JSON.stringify`; useful for saves, WebSocket sync, and structured model output.
3. **Every `PlayerAgent` is async** — human, heuristic, and later LLM or remote opponents share the same turn loop. Illegal Actions are rejected in `dispatchAction` and never reach the engine.

```ts
type PlayerAgent = {
  chooseAction(input: {
    state: GameState
    legalActions: Action[]
    playerId: string
  }): Promise<Action>
}
```

| Implementation | Status |
| --- | --- |
| `HumanAgent` | Done: resolves after a UI click |
| `HeuristicAgent` | Done: local heuristic |
| `LlmAgent` | Later: prompt + structured output, parsed into a legal Action |
| Remote opponent | Later: Action over WebSocket, same interface |

Decision-making and transport can change; the rules engine stays put.

## Later: LLM

An LLM and the heuristic do the same job: given a state, pick one legal action. Expected approach:

- Add an `LlmAgent` that implements `PlayerAgent`. At setup, swap a seat from `HeuristicAgent` to it — no changes to `reduce.ts`.
- Encode `state` + `legalActions` into a prompt and ask the model for a serializable Action (or action id). If the reply is not in the legal set, discard and retry, or fall back to the heuristic.
- Later, add `toObservation(state)` to shrink the observation, cut tokens, and hide extra internal fields.

Not needed in this phase — only when adding an LLM: a backend proxy (do not put API keys in the frontend), prompt / JSON schema, latency and a “thinking” UI, cost and rate limits. You do not need a server or a second state machine just to prepare for an LLM.

## Later: online play / full-stack

Accounts, guests, match records, and finish replay are done. The rules layer will not be rewritten; the next step is “authoritative state + realtime sync”.

| | Now | Later realtime |
| --- | --- | --- |
| Rules | Browser runs `engine/`; the server replays the same engine at finish | The server also `applyAction` during play |
| State | Local match; events and saves in Postgres | Live `GameState` in a room |
| Opponents | Local Heuristic | Other humans, server-run AI / LLM |
| Sync | HTTP event batches | WebSocket (Socket.IO) |

Suggested path:

1. **Phase 1 (done)** — SPA play + Express / Prisma accounts and records; finish scores by replaying `seed + events`.
2. **Half-step (optional)** — Extract `src/engine` into a shared package imported by both frontend and backend.
3. **Full-stack** — The server holds the authoritative `GameState`; clients only send Actions and receive full or patched state; AI / LLM run on the server. `LlmAgent` and online rooms can stack on the same layer.

Full-stack will grow extra pieces that do not overturn the engine: room codes, reconnect, acting only on your own turn, latency and optimistic updates, and multiplayer saves that require everyone's consent. Solo vs AI can keep using the local engine.

## Stack

React 19, TypeScript, Vite, Vitest, Express, Prisma, Postgres.
