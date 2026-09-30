# Puerto Rico

[中文](README.md)

A browser implementation of Aleksander's classic board game *Puerto Rico*: play solo against local heuristic AI, or create a room and play online against other humans. The rules engine and UI are TypeScript. Solo matches run in the browser; online matches are server-authoritative and synced over Socket.IO. The backend also handles accounts, match records, a structured captain's log, and end-game score verification.

You plant, build, produce goods, and ship them out. The goal is to have the most victory points when the game ends.

## Features

- Solo: 3 / 4 / 5 player games (you + the rest as AI), with balanced or aggressive AI styles
- Online: 2 / 3 / 4 / 5 all-human tables; host creates a room with a join code, or join from the open-room list; the match starts when seats fill
- Online play: the server runs `applyAction` and broadcasts state (hidden deck / RNG never leave the server); auth reuses the cookie session
- Role rounds: Settler, Mayor, Builder, Craftsman, Trader, Captain, Prospector
- Building effects, colonist placement, ships and warehouses, end-game scoring
- Board hints; UI in Traditional Chinese and English
- Start as a guest with a nickname; optionally sign in with Google or GitHub to view your own stats
- Match events are written to the database; the server replays the engine at finish before recording the score
- Solo save / load; online saves require consent from every human seat before a `MatchSave` is written

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

**Solo**

1. Enter a nickname (required), pick player count and AI style, then press Start. Google / GitHub sign-in is optional.
2. Each round, in governor order, choose an unclaimed role and take that role's privilege and action.
3. The other players take the same role in turn (without the privilege).
4. Unchosen roles accumulate doubloons and become more tempting next round.
5. After the game ends, score from VP chips, building printed values, and large-building bonuses (Guild Hall, Residence, Fortress, Customs House, City Hall).

**Online**

1. On the setup screen, use Online play: create a room (2 / 3 / 4 / 5 seats) or join by code / from the open list.
2. The lobby shows the join code and seats; when full, the match starts. You can act only on your seat's turn.
3. To test multiplayer locally, use **two browsers or one normal window plus one private window** (`localhost` shares one session cookie, so two tabs of the same browser count as the same guest and cannot hold two seats).

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
  agents/     PlayerAgent: HumanAgent, HeuristicAgent, turn loop (solo)
  ui/         React UI; solo applies Actions locally, online sends socket actions
  api/        Calls /api and Socket.IO (session cookie)
  data/       Building definitions
server/
  prisma/     Postgres schema and migrations
  src/        Express: auth, matches, rooms, save consent
  src/live/   Socket.IO: authoritative GameState, redaction, broadcast
```

Core loop:

```
legal = getLegalActions(state)
action = await agent.chooseAction({ state, legalActions, playerId })
state = applyAction(state, action)   // only place game state changes
```

The current AI is heuristic scoring (balanced mode sometimes picks a second-best move), not an LLM. The UI never writes doubloons, goods, colonists, or similar fields directly.

## Extensibility (already reserved)

Human online play is in place (rooms, Socket.IO, server-authoritative state). LLM opponents and scale work are still ahead; the reserved interfaces are:

1. **Engine has zero UI dependency** — `src/engine/` is pure TypeScript: no React, no `window` / DOM. The only state-change entry is `applyAction` (same engine for solo and online).
2. **`GameState` / `Action` are JSON-serializable** — plain data only, so they round-trip through `JSON.stringify`; online play syncs and replays on that.
3. **Every `PlayerAgent` is async** — human, heuristic, and later LLM share the same interface. Illegal Actions are rejected in `dispatchAction` and never reach the engine.

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
| `HumanAgent` | Done: solo UI click resolves |
| `HeuristicAgent` | Done: local heuristic (solo) |
| Online human | Done: client sends Action; server validates and broadcasts |
| `LlmAgent` | Later: prompt + structured output, parsed into a legal Action |

Decision-making and transport can change; the rules engine stays put.

## Later: LLM

An LLM and the heuristic do the same job: given a state, pick one legal action. Expected approach:

- Add an `LlmAgent` that implements `PlayerAgent`. At setup or in an online room, swap a seat to it — no changes to `reduce.ts`.
- Encode `state` + `legalActions` into a prompt and ask the model for a serializable Action (or action id). If the reply is not in the legal set, discard and retry, or fall back to the heuristic.
- Keep API keys on the server; later add `toObservation(state)` to shrink the observation.

## Roadmap status

| Phase | Scope | Status |
| --- | --- | --- |
| Phase 1 | SPA solo + Express / Prisma accounts and records; finish by replaying `seed + events` | Done |
| Phase 2 | Rooms (join code + open list), Socket.IO, server-authoritative play, all-human tables (2–5), save consent | Done |
| Phase 3 | `LlmAgent`, Discord OAuth | Later |
| Phase 4 | Connection pool, event batching, idle room memory caps; Redis only if needed | Later |

Solo vs AI still uses the local engine; online tables are all-human for now (no AI mix).

## Stack

React 19, TypeScript, Vite, Vitest, Express, Prisma, Postgres, Socket.IO.
