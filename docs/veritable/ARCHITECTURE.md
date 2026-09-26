# Véritable — architecture

Règles techniques que tout code du projet respecte. Ce fichier est importé dans chaque session Claude Code. Le pourquoi de chaque règle est dans `DESIGN.md` (section « Contraintes architecturales non négociables »).

## Invariants — ne jamais violer

1. **Une nation n'est pas ses tuiles.** `Nation` est une entité autonome (id, régime, dirigeant, économie, politique, blocs). Les tuiles référencent une nation ; une nation peut avoir zéro tuile (exil, micro-État) et reste vivante. Aucune règle d'élimination ne dépend du nombre de tuiles.
2. **Tout état sauvegardable porte `schemaVersion`.** Chaque changement de forme de l'état ajoute une migration `vN → vN+1` dans `src/veritable/save/migrations/`. Une sauvegarde d'une version antérieure doit toujours se charger.
3. **Aucune donnée de jeu en dur.** Pays, dirigeants, biens, lois, événements, blocs, arbre, scénarios : JSON dans `data/veritable/`, validé par un schéma zod dans `src/veritable/data/schemas/`. Une constante d'équilibrage vit dans `data/veritable/config.json`, pas dans un fichier `.ts`.
4. **La simulation est isolée.** `src/veritable/sim/` n'importe jamais `src/client/`, le DOM, Electron ou un module de rendu. Elle expose une interface unique (ci-dessous). Le client et le runner headless sont deux consommateurs de la même interface.
5. **Tout hasard passe par le RNG seedé.** Jamais `Math.random()` dans `src/veritable/`. Un `Rng` est injecté, son état fait partie de la sauvegarde.
6. **Toute chaîne visible passe par une clé i18n.** Fichiers `data/veritable/i18n/fr.json` (et plus tard `en.json`). Jamais de français en dur dans le code.

## Frontière de simulation

```ts
interface VeritableSim {
  init(scenario: Scenario, seed: number): void;
  restore(snapshot: SaveFile): void;
  snapshot(): SaveFile;
  apply(command: PlayerCommand): void;       // curseur, loi, ordre de front, vote, choix d'événement…
  advance(gameMinutes: number): SimEvent[];  // fait tourner les horloges ; renvoie ce qui s'est passé
  read(): ReadonlyWorldView;                  // vue lecture seule pour l'UI et les métriques
}
```

- Le client appelle `advance` à cadence réelle selon la vitesse choisie ; le runner headless l'appelle en boucle sans attendre.
- Les `SimEvent` alimentent le journal, les pop-ups et les métriques. La sim ne sait pas qu'une UI existe.
- Tout ce qui touche `src/core` d'OpenFront passe par `src/veritable/adapters/` : c'est le seul endroit où les deux mondes se rencontrent.

## Horloges

| Domaine | Fréquence | Module |
| --- | --- | --- |
| Militaire, tuiles, fronts | tick OpenFront | `sim/war/` |
| Mise à jour d'une nation : croissance, population, budget, dette, opinion, stabilité, politique, recherche, armée, diplomatie de la nation, IA | **file tournante** (`sim/schedule.ts`) : chaque jour pour le joueur, au moins chaque semaine pour les nations en interaction avec lui ou ayant un enjeu, chaque mois pour les autres ; au plus `maxUpdatesPerTick` par tick | `sim/economy/`, `sim/politics/`, `sim/diplomacy/`, `sim/tech/`, `ai/` |
| Commerce | **file des biens** : un bien par tour, les douze en `tradeCycleDays` jours | `sim/economy/` |
| Prix mondiaux, reste du monde, marine, nucléaire, contestation, livres de guerre | 1 / jour de jeu | `sim/economy/`, `sim/naval/`, `sim/nuclear/`, `sim/war/` |
| Événements | tirage quotidien, réparti sur les ticks du jour | `sim/events/` |
| Votes et propositions des blocs | jour de séance de chaque bloc | `sim/blocs/` |
| Présidences, budgets des blocs, règle budgétaire de l'UE, sauvegarde auto | 1er du mois (calendaire) | `sim/blocs/`, `save/` |

Le calendrier démarre au 1er janvier 2026. À vitesse ×1 : 1 minute réelle = 1 mois de jeu. Un `Scheduler` central déclenche les horloges quotidiennes et calendaires ; la file des nations et celle des biens sont indexées sur le numéro du tick. **Chaque mise à jour intègre le temps écoulé depuis la précédente** (`sim/time.ts`) : les taux restent exprimés par mois et se composent exactement, les durées (« douze mois de suite ») se comptent en mois de calendrier traversés ; avancer tick par tick ou d'un seul appel donne le même état. Aucun système ne lit l'horloge murale.

## Sauvegarde

- Fichier = `{ schemaVersion, seed, rngState, calendar, nations[], blocs[], world, tiles (compressé à part), journal, metrics }`.
- Sérialisation via `/zbin` (schémas zod → binaire) ; les tuiles en tableau typé compressé.
- Rotation : les 6 dernières sauvegardes automatiques mensuelles + sauvegardes manuelles nommées.
- J0 : stockage IndexedDB + export/import fichier dans le navigateur. J7 : fichiers dans le dossier utilisateur via Electron.
- Compactage : les entrées du journal de plus de 10 ans de jeu sont agrégées par année.

## Arborescence

```
CLAUDE.md                   OpenFront + section Véritable (importe ARCHITECTURE, DECISIONS, ROADMAP)
docs/veritable/             DESIGN, ARCHITECTURE, DATA-SCHEMAS, ROADMAP, DECISIONS
data/veritable/
  config.json               constantes d'équilibrage
  scenarios/                world-2026.json, europe-10.json (J1)
  nations/<iso3>.json       une fiche par nation
  leaders/<iso3>.json       dirigeants et acteurs politiques d'une nation
  goods/goods.json          les biens (palier 1 puis 2)
  laws/                     catalogue de lois par domaine
  events/scripted/          événements scriptés ; events/templates/ gabarits procéduraux
  blocs/<slug>.json         UE, OTAN, BRICS…
  tech/                     tronc commun et branches
  i18n/fr.json              toutes les chaînes visibles
src/veritable/
  sim/                      economy/ politics/ war/ diplomacy/ blocs/ events/ nuclear/ tech/ scheduler.ts rng.ts
  save/                     serialize.ts migrations/
  ai/                       IA des nations (agenda, traits, échelonnement, LOD)
  adapters/                 pont vers src/core (tuiles, structures, nucléaire) et src/client (écrans)
  data/schemas/             schémas zod, un fichier par type de donnée
  ui/                       écrans Véritable (Lit, comme le client OpenFront)
tools/veritable/
  ingest/                   sources ouvertes → JSON (rejouable)
  borders/                  Natural Earth → tuiles
  headless/                 runner IA contre IA + métriques
```

## Ce qu'on ne touche pas dans le code hérité

- La boucle de tick et le rendu de la carte : on s'y branche, on ne les réécrit pas.
- Le format des cartes et `map-generator`.
- Les structures (villes, postes de défense, ports, navires, silos, SAM) : leur logique reste, seule leur alimentation économique change.
- Les tests existants d'OpenFront restent verts.

Les modifications inévitables dans `src/core` (élimination à 0 tuile, condition de victoire, Overtime, spawn) sont chacune isolées, commentées `// VERITABLE:` et listées dans `DECISIONS.md`.

## Conventions

- Code, commentaires, noms de fichiers : anglais. Contenu et interface : français.
- Tests Vitest colocalisés (`foo.test.ts`), obligatoires pour tout ce qui est dans `sim/`, `save/`, `ai/`.
- Un système par pull request ou commit de session ; l'état est jouable à la fin de chaque session.
- Les nombres d'équilibrage ont un nom et vivent dans `config.json`.
- Performance : instrumenter chaque domaine (`perf.mark`) dès le J1 ; l'IA est échelonnée (≈10 nations par tick) ; les nations sans enjeu tournent en niveau de détail réduit.

## Runner headless

`npm run veritable:headless -- --scenario world-2026 --years 50 --runs 100 --seed 42`

Sortie : un JSON par campagne avec guerres/an, tirs nucléaires, effondrements, PIB mondial, prix par bien, stabilité moyenne, temps CPU par système. C'est le test d'intégration et l'outil d'équilibrage du projet ; il tourne à la fin de chaque jalon.
