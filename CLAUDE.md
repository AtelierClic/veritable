# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run inst             # Install deps (uses npm ci --ignore-scripts — do NOT use npm install)
npm run dev              # Run client + server in dev mode with hot reload
npm run start:client     # Client only
npm run start:server-dev # Server only
npm test                 # Run all tests (Vitest)
npm run test:coverage    # Tests with coverage
npm run lint             # Oxlint + ESLint
npm run lint:fix         # Oxlint + ESLint with auto-fix
npm run format           # Prettier
npm run build-prod       # Production build
```

**Run a single test file:**

```bash
npx vitest tests/YourTest.test.ts --run
npx vitest NationAllianceBehavior --run # match by name pattern
```

## Architecture

OpenFront.io is a real-time multiplayer territorial strategy game. There are four components:

1. **`src/core/`** — Deterministic game simulation. Pure TypeScript with **no external dependencies**. Must remain fully deterministic (seeded PRNG, no floating-point math). Runs in a Web Worker thread. All `src/core` changes **must** include tests.
2. **`src/client/`** — Rendering (Pixi.js/WebGL), UI (Lit web components + Tailwind CSS 4), WebSocket communication.
3. **`src/server/`** — Game coordination, intent relay, WebSocket management (Node.js/Express/ws).
4. **API** — Closed-source Cloudflare Worker handling auth, stats, cosmetics, monetization. Not in this repo.

### Simulation Flow (Intent → Execution)

The game simulation runs **on each client**, not the server. The server only relays intents.

1. Player action → client creates an **Intent** → sent to server
2. Server bundles all intents for the tick into a **Turn** → relays to all clients
3. Client forwards Turn to the Core worker
4. Core creates an **Execution** for each intent
5. Core calls `executeNextTick()` — all executions run and mutate game state
6. Core sends **GameUpdates** back to client → client renders

Intents and all wire messages are Zod-validated schemas defined in `src/core/Schemas.ts`.
Every WebSocket frame is a compact binary encoding of those schemas
(`src/core/ZbinWire.ts`, library docs in `zbin/README.md`). HTTP stays JSON.

### CDN / Static Assets

The game server only serves `index.html` and the WebSocket. All other assets (JS bundle, images, maps, worker) come from a CDN bucket. `CDN_BASE` is an empty string in dev (falls back to same-origin) and a full origin (e.g. `https://cdn.example.com`) in production. It is set as both a Vite build-time variable and a server runtime env var.

## Key Files

| File                        | Purpose                                |
| --------------------------- | -------------------------------------- |
| `src/core/Schemas.ts`       | All intent/message types (Zod schemas) |
| `src/core/GameRunner.ts`    | Simulation orchestrator                |
| `src/core/game/GameImpl.ts` | Game state implementation              |
| `src/server/GameServer.ts`  | Main WebSocket server, game loop       |
| `src/server/Master.ts`      | Lobby and game registry                |
| `tests/util/Setup.ts`       | Test helper — creates test games       |
| `docs/Architecture.md`      | Architecture overview                  |
| `zbin/README.md`            | Binary wire format for zod schemas     |
| `docs/Auth.md`              | JWT/auth flow                          |
| `docs/API.md`               | Public API endpoints                   |
| `vite.config.ts`            | Build config, CDN handling             |

## UI Text / i18n

All user-visible text must go through `translateText()` and have a corresponding entry added to `resources/lang/en.json`. Translations are managed via Crowdin. DO NOT modify any other translation files.

## Testing Patterns

Tests use a `setup()` helper from `tests/util/Setup.ts` that creates a full game instance with map data from `tests/testdata/maps/`. Write tests that exercise the core simulation directly — not mocks.

## Tech Stack

- **Bundler:** Vite + TypeScript 5.7
- **Rendering:** Pixi.js (WebGL)
- **UI Components:** Lit (LitElement) + Tailwind CSS 4
- **Audio:** Howler.js
- **Schemas/Validation:** Zod
- **Testing:** Vitest
- **Server:** Node.js, Express, ws (WebSocket)

<!-- ============================================================
     VÉRITABLE — à coller tel quel À LA FIN du CLAUDE.md d'OpenFront.
     Ne rien supprimer au-dessus : les conventions OpenFront restent valables,
     cette section prime en cas de contradiction.
     ============================================================ -->

# Véritable

Ce dépôt est un fork d'OpenFrontIO devenu **Véritable** : un grand strategy géopolitique du monde de 2026, solo, sans condition de victoire, distribué gratuitement en application Windows. Le joueur incarne l'État d'une nation parmi 195 ; l'économie est une économie de biens ; la politique interne est le moteur du jeu ; les blocs supranationaux sont des acteurs ; la guerre est libre mais lourdement sanctionnée. Le fork ne fusionne plus jamais depuis OpenFront.

Documents de référence, présents dans chaque session :

@docs/veritable/ARCHITECTURE.md
@docs/veritable/ROADMAP.md
@docs/veritable/DECISIONS.md

Référence complète, à ouvrir dès qu'une décision de conception est en jeu : `docs/veritable/DESIGN.md`. Forme des données : `docs/veritable/DATA-SCHEMAS.md`.

## Règles absolues

1. Une nation n'est pas ses tuiles : zéro tuile n'élimine jamais une nation.
2. Tout état sauvegardable porte `schemaVersion` et une migration par changement de forme.
3. Aucune donnée de jeu ni constante d'équilibrage en dur : JSON validé zod dans `data/veritable/`.
4. `src/veritable/sim/` n'importe jamais le client, le DOM ni Electron ; tout passe par l'interface `VeritableSim` et par `src/veritable/adapters/`.
5. Jamais `Math.random()` : le `Rng` seedé injecté, dont l'état est sauvegardé.
6. Jamais de texte visible en dur : clés i18n dans `data/veritable/i18n/fr.json`.

## Ce qui ne se rediscute pas

Solo local · le joueur est l'État, pas le gouvernement · 1er janvier 2026, 1 min réelle = 1 mois à ×1 · 12 biens au palier 1, prix mondial + flux bilatéraux · simulation politique asymétrique (complète pour le joueur, régime + stabilité + traits pour l'IA) · 9 régimes · fronts = tuiles frontalières segmentées, divisions sans position exacte · structures OpenFront conservées · frontières de facto, territoires occupés = tuiles du contrôleur « contesté » · micro-États sans tuile · doctrines nucléaires + main morte · blocs = entités complètes en trois couches · exil puis dissolution puis baroud d'honneur · français pour le contenu, anglais pour le code · rupture avec l'amont.

Une contradiction entre une tâche demandée et cette liste se signale avant de coder ; elle ne se résout pas en silence.

## Ce qu'on ne touche pas dans le code hérité

Boucle de tick et rendu de la carte, format des cartes et `map-generator`, logique des structures, tests existants d'OpenFront. Les modifications inévitables dans `src/core` (élimination à 0 tuile, `WinCheckExecution.ts`, Overtime, plafond 170 min, spawn) sont isolées, commentées `// VERITABLE:` et consignées dans `DECISIONS.md`.

## Rythme de session

- **Début** : lire le jalon en cours dans `ROADMAP.md` et les dernières entrées de `DECISIONS.md` ; annoncer le système de la session en une phrase.
- **Un seul système par session.** Aucune tâche d'un jalon futur ne se commence, même si elle semble facile.
- **Pendant** : tests Vitest colocalisés pour tout ce qui est dans `sim/`, `save/`, `ai/` ; constantes nommées dans `config.json` ; chaque écran livré fonctionnel, même laid.
- **Ambiguïté ou impossibilité** dans `DESIGN.md` : proposer deux options avec leurs conséquences et attendre, plutôt que trancher seul.
- **Fin** : `npm test` vert, état jouable, cases cochées dans `ROADMAP.md` avec la date, entrée dans `DECISIONS.md` pour toute décision prise, commit avec un message qui nomme le jalon (`J0: seeded Rng + save v1`).

## Commandes

- Installation : `npm run inst` — jamais `npm install`.
- Développement : `npm run dev`. Tests : `npm test`.
- Runner headless (à partir du J2) : `npm run veritable:headless -- --scenario europe-10 --years 20 --runs 10 --seed 42`.
