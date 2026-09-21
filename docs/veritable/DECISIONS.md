# Véritable — journal des décisions

Une entrée par décision, datée, jamais supprimée : une décision annulée reçoit une nouvelle entrée qui la remplace. Claude Code ajoute une entrée à chaque choix structurant pris en session (forme d'une donnée, modification de `src/core`, constante d'équilibrage majeure, écart par rapport à DESIGN.md). Format : date, décision, raison, ce que ça exclut.

## 2026-09-20 — Cadre initial (entretien 1)

- **Solo local, campagne persistante, une seule nation, bac à sable sans victoire.** Libère le déterminisme client/serveur ; exclut tout retour multijoueur sans réécriture.
- **Base OpenFront.io (AGPL-3.0), pas un mod.** Combat, économie et IA remplacés ; carte, tuiles, diplomatie, nucléaire, structures conservés.
- **Distribution Windows via Electron.** Tauri en repli.
- **Données réelles, ~195 nations, économie détaillée, politique interne complète, blocs dirigeables.**
- **Guerre libre mais sanctionnée ; nucléaire utilisable avec conséquences ; effondrement = gouvernement en exil.**
- **Événements scriptés et procéduraux ; plafond technologique spéculatif lointain.**

## 2026-09-21 — Décisions de conception (entretien 2)

- **Nom du projet : Véritable.**
- **Le joueur est l'État, pas le gouvernement.** Un changement de dirigeant, un coup ou une révolution ne terminent rien. Exclut le mode « perdre l'élection = fin ».
- **Temps : 1er janvier 2026 ; à ×1, 1 minute réelle = 1 mois de jeu ; vitesses pause / ×1 / ×2 / ×5.** Sauvegarde auto par mois de jeu, pas par jour.
- **Économie de biens en paliers : 12 biens au palier 1, ~40 au palier 2.** Un prix mondial par bien + flux bilatéraux. Exclut une économie à or unique.
- **Dette/PIB avec taux, austérité forcée ou défaut, réprimande des blocs (UE 3 % / 60 %).**
- **Sanctions = embargos par bien et par pays**, effets sur PIB, budget, opinion, tension, contournement, flux d'armes, présence militaire. Test de la sanction cosmétique au J3a.
- **Simulation politique asymétrique.** Politique complète pour le joueur ; régime + stabilité scalaire + traits du dirigeant + agenda pour l'IA. Exclut la symétrie, y compris plus tard.
- **9 archétypes de régime** : parlementaire, présidentiel, semi-présidentiel, autoritaire électoral, parti unique, monarchie absolue, junte, théocratie, État failli.
- **Élections orientables** par propagande, contrôle des médias, fraude, clientélisme — chacun avec son risque.
- **Chute de l'État** : exil tant que reconnaissance + soutien > seuil ; sous le seuil ou annexion reconnue → dissolution → baroud d'honneur sur un petit État de la même campagne.
- **Dirigeants = entités à traits, source Wikidata.** Noms parodiques par défaut, interrupteur « fictif » dans les données. Risque de droit à l'image connu et accepté.
- **Modèle de front : ensemble des tuiles frontalières, segments, divisions affectées sans position exacte, postures, résolution par rapport de force** (modèle Hearts of Iron).
- **J3 scindé** : J3a terre + réaction internationale ; J3b marine, air, logistique, effectifs.
- **Structures OpenFront conservées** : villes, postes de défense, ports, navires, silos, SAM.
- **Nucléaire : doctrine par nation dans les données ; main morte à l'annexion, probabilité visible ; tout tir = réaction internationale maximale.**
- **Blocs = entités complètes** (membres, adhésion, sortie, règle de décision par domaine, budget, compétences, leadership), en trois couches. Palier 1 : UE, OTAN, BRICS, ASEAN, UA, Mercosur, OPEP, CEDEAO, Ligue arabe, OCS, G7, G20.
- **Frontières de facto (Natural Earth), territoires occupés = tuiles du contrôleur étiquetées « contesté ».** Exclut les frontières de jure.
- **Micro-États = nations sans tuile, rattachées à une tuile hôte.**
- **Le monde démarre avec les conflits en cours**, listés dans le scénario et validés à la main.
- **Arbre technologique : tronc commun + branches de doctrine par bloc**, en paliers ; réserve du premier entretien levée.
- **Noyau opinion/stabilité dès le J2**, avant la guerre.
- **Gratuit ; contenu et interface en français, code en anglais, clés i18n dès le départ ; modding ouvert.**
- **Distribution itch.io ou GitHub Releases, binaire non signé** (avertissement SmartScreen accepté), pas de Steam. Budget hors Claude : 10 €.
- **Rupture avec l'amont OpenFront** : le fork ne fusionne plus jamais après le commit de départ.
- **RNG seedé obligatoire** dans toute la simulation.
- **Modèles Claude Code** : Fable 5.1 pour J0 et l'architecture ; Opus 5 pour les systèmes spécifiés ; Sonnet 5 pour le volume ; `opusplan` en session courante.

## 2026-09-21 — J0 : socle (session Claude Code)

### Décisions structurantes

- **Drapeau unique `GameConfig.veritable`.** Toute modification de `src/core` est derrière ce drapeau (`Config.isVeritable()`), pour que les tests OpenFront restent verts. Toute partie solo est une campagne Véritable (`veritableSoloConfig`, appliqué dans `joinLobby`) ; le multijoueur hérité reste tel quel, sans maintenance. Exclut un mode solo « OpenFront classique ».
- **« À l'identique » = identité du fichier de sauvegarde (option A).** snapshot → restauration → snapshot donne les mêmes octets. Le rejeu du journal de commandes (option B) est écarté : temps de chargement proportionnel à la durée de campagne.
- **La simulation vit dans le worker, à côté du `GameRunner`** (`VeritableSession`). Le client passe par `RemoteVeritableSim` (mêmes opérations que `VeritableSim`, asynchrones ; pas d'`advance` côté client : le worker avance la sim à chaque tick du cœur). Le runner headless du J2 réutilisera `VeritableSession`.
- **Frontière sim ↔ monde tuilé : interface `WorldPort`** (`tileCounts`, `capture`, `restore`), définie dans `sim/`, implémentée par `adapters/CoreBridge.ts` et par `sim/testing/MemoryWorld.ts`. `sim/` n'importe ni `src/core` ni le client.
- **Rattachement des tuiles.** La nation est l'entité ; la tuile pointe vers elle. Dans le cœur : `smallID` sur 12 bits (inchangé). Dans `CoreBridge` : table `smallID ↔ NationId`. Dans la sauvegarde : index dans `nations[]` + 1 (0 = sans propriétaire), bit 13 = retombées. Jamais de `smallID` dans une sauvegarde.
- **`NationState`** : `id`, `name` (`{kind:"key"}` | `{kind:"literal"}`), `regime` (nullable au J0), `territory` (`tiles` | `microstate`), `status` (`active` | `exiled` | `dissolved`), `tileCount` (cache, jamais un critère de vie), `isPlayer`. Au J0 seul `active ↔ exiled` est dérivé du territoire ; `dissolved` n'est jamais dérivé d'un nombre de tuiles (J7).
- **Restauration = recréer le jeu cœur depuis `world.coreStart` (GameStartInfo, JSON canonique à clés triées), puis reposer l'état par une `Execution`** (`RestoreExecution`, dans `tick()` et non `init()` : le cœur perd les exécutions ajoutées pendant une phase d'`init`). Elle tourne dans un tick pour que tuiles, joueurs et unités atteignent le client par le flux normal de mises à jour. La session est créée avant `GameRunner.init()` pour que la restauration passe avant les `NationExecution` (sinon les nations re-spawnent par-dessus la sauvegarde). Le tick de restauration n'est pas du temps de campagne.
- **Conteneur `.vsave`** : `"VRTB"` · `schemaVersion` u16 (lu avant tout décodage) · longueur + en-tête zbin · longueur + bloc de tuiles. zbin n'ayant ni octet de version ni étiquettes de champ, **le schéma d'en-tête de chaque version est figé** (`data/schemas/save.ts` → `SaveHeaderV1Schema`) et enregistré dans `HEADER_CODECS` ; toute évolution = nouveau schéma `VN` + migration `from: N-1` dans `save/migrations/`. Chaîne vide en v1 mais toujours exécutée par `decodeSave` ; testée avec une fausse v0.
- **Compression des tuiles : RLE + varints (LEB128), TypeScript pur, synchrone, déterministe.** Pas de `CompressionStream` (asynchrone, incertain sous jsdom). Mesures (territoire de Voronoï couvrant toutes les terres, pire cas réaliste) : `giantworldmap` 4108×1948 = 8,0 M tuiles, 195 nations → **188 208 octets** (brut 16,0 Mo, ×85 ; encodage 55 ms, décodage 8 ms) ; 107 nations → 157 294 octets ; `channelislands` 4744×2628 = 12,5 M tuiles (plus grande carte du dépôt), 44 nations → 60 306 octets. Partie réelle dans le navigateur, carte Monde 2000×1000, 73 nations, début de partie : fichier complet de 29 858 octets. Des frontières réelles, plus découpées qu'un Voronoï, coûteront davantage ; un deflate par-dessus reste possible en v2 via migration.
- **Stockage : interface `SaveStore`** ; `IndexedDbSaveStore` (deux object stores : métadonnées / octets) vérifié dans le navigateur, `MemorySaveStore` pour les tests. Pas de `fake-indexeddb` : l'ajouter imposait un `npm install`, interdit.
- **`Rng` propre à Véritable** (`sim/rng.ts`, sfc32, `getState`/`setState`) ; `PseudoRandom` du cœur n'est pas touché. Graine de campagne = `simpleHash(gameID)`. Un test échoue si un fichier de `src/veritable/` appelle le générateur global.
- **Commande joueur du J0 : `set-speed`** (stocke la vitesse dans le calendrier ; la cadence réelle, la pause et les vitesses sont le calendrier du J1). `SimEvent` du J0 : `nation-status-changed`.
- **Placement de nom** : `GameRunner` ne calcule pas `placeName` pour un joueur vivant à 0 tuile (boîte englobante vide).

### Écarts assumés par rapport à DESIGN.md / DATA-SCHEMAS.md

- **`rngState` = 4 × uint32 (sfc32)** au lieu d'une chaîne.
- **Tuiles en section du conteneur `.vsave`** au lieu de `tilesRef: "tiles.bin"` ; l'en-tête porte `tilesInfo { width, height }`.
- **`calendar` = `{ startDate, elapsedGameMinutes, date, speed }`** (`date` dérivée, gardée lisible) au lieu de `{ date, speed }`.
- **Noms de nations en littéraux jusqu'au J1.** Pas de scénario (J1) ni de fiches (J2) : les nations du J0 viennent du roster du cœur (`scenarioFromCoreGame` : joueur humain → `player`, nations du manifeste de carte → slug du nom). Extension du schéma `scenario` : `adHocNations[{ id, literalName }]`, à retirer quand le chargeur de scénario existe. `regime` est `null` pour ces nations.
- **Rotation des 6 sauvegardes automatiques reportée au J1** (avec le `Scheduler`). Le J0 ne fait que des sauvegardes manuelles ; `SaveMeta.kind` prévoit déjà `auto`.
- **État en vol non sauvegardé jusqu'à son remplacement** : attaques, bateaux, ogives en vol, état interne de l'IA héritée, alliances et embargos du cœur (diplomatie : J3a), relations, statistiques, structures en construction (sauvées comme achevées). Conséquence observée : au tick de restauration l'IA héritée réengage aussitôt des troupes ; l'identité octet pour octet est garantie sur l'état sauvegardé (tuiles, nations, calendrier, Rng, état du joueur), pas sur les troupes des nations IA une fois ce tick passé.
- **Doomsday Clock forcé à off côté client** (mécanique d'élimination), sans toucher au cœur.
- **Tribus (bots) forcées à 0 en solo** — décision prise en session, non prévue au plan. Ce ne sont pas des nations : leurs tuiles n'appartiendraient à personne dans une sauvegarde et disparaîtraient au rechargement. Dans le cœur, un bot meurt toujours à 0 tuile, même en mode Véritable.
- **`maxTimerValue` et `overtime` retirés de la configuration solo** côté client, en plus de la neutralisation dans le cœur.
- **`gameMinutesPerTick = 72`** dans `config.json` (1 mois de 30 jours = 43 200 min par minute réelle = 600 ticks). Le calendrier réel ayant 365 jours, une année dure 12,17 min à ×1 : à régler au J1 avec le calendrier. `defaultStartDate = "2026-01-01"` y vit aussi.
- **Pas de `perf.mark`** au J0 (tâche du J1).

### Modifications de `src/core`

Toutes commentées `// VERITABLE:`, testées dans `tests/veritable/CoreNeutralization.test.ts` et `src/veritable/adapters/VeritableSession.test.ts`.

| Fichier                                                                    | Modification                                                                                                                                               | Raison                                                                                                  |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/core/Schemas.ts`                                                      | `veritable: z.boolean().optional()` en fin de `GameConfigSchema`                                                                                           | Drapeau unique                                                                                          |
| `src/core/configuration/Config.ts`                                         | `isVeritable()` ; `overtimeConfig().enabled` forcé à `false`                                                                                               | Overtime neutralisé (lu aussi par `NationMIRVBehavior`)                                                 |
| `src/core/GameRunner.ts`                                                   | `WinCheckExecution` non enregistré ; crochet optionnel `onGameCreated(game)` dans `createGameRunner` ; pas de `placeName` à 0 tuile                        | Ni victoire, ni minuteur, ni plafond 170 min ; attacher la session avant les exécutions                 |
| `src/core/execution/WinCheckExecution.ts`                                  | Garde en tête de `tick()` (lit `gameConfig().veritable`, compatible avec les mocks des tests existants)                                                    | Couvre seuil de victoire, `maxTimerValue`, `HARD_TIME_LIMIT_SECONDS` même si quelque chose l'enregistre |
| `src/core/game/PlayerImpl.ts`                                              | `isAlive()` : un joueur non-bot qui a spawné reste vivant à 0 tuile                                                                                        | Invariant n° 1                                                                                          |
| `src/core/worker/WorkerMessages.ts`, `Worker.worker.ts`, `WorkerClient.ts` | Canal générique `veritable_request` / `veritable_response` / `veritable_events` ; `veritableSave` optionnel dans `init` ; `onCoreTick()` après chaque tick | La sim vit dans le worker                                                                               |

`PlayerExecution.ts` n'a **pas** été modifié, contrairement au plan : sa branche de mort dépend d'`isAlive()`, elle est donc sautée d'elle-même (ni purge de l'or et des unités, ni désactivation). Aucun crochet de restauration n'a été nécessaire dans `Game.ts` / `GameImpl.ts` : l'API publique suffit. Aucun test OpenFront existant n'a été modifié.

### Schémas zod créés (sauvegarde `schemaVersion` 1)

`data/schemas/common.ts`, `nation.ts` (fiche `nations/<iso3>.json`), `scenario.ts` (+ `adHocNations`), `config.ts`, `save.ts` (`SaveHeaderV1Schema`, figé).

## À compléter par Claude Code

- Commit de départ du fork (`upstream-base`) : `4bf92e3c98201326003f790839e04dfcc43ff41a` (« meta: raise saturation midpoints… #5587 »), tag `upstream-base`. Noté le 2026-09-21.
- Échecs de `npm test` connus sur la machine de développement Windows, présents sur le code d'origine et indépendants du jeu — ne pas réparer ; « tests verts » = aucun échec au-delà de ces trois :
  1. `tests/UpdateRegister.test.ts` (2 tests) — exécute le script shell `update.sh`.
  2. `tests/client/clan/ClanDonateDialog.test.ts` (1 test) — format de nombre dépendant de la locale `fr`.
- Chaque modification de `src/core` : fichier, raison, ligne `// VERITABLE:`.
- Chaque schéma zod créé ou modifié : version de `schemaVersion` associée.
