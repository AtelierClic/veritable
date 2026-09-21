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

## 2026-09-21 — Clôture du J0 (validation du rapport)

- **J0 validé par Lukas**, export → rechargement de page → import d'un `.vsave` vérifié à la main dans le navigateur.
- **Bots (tribus) forcés à 0 en solo : confirmé.**
- **`adHocNations` : accepté comme échafaudage du J0, à retirer au J1** avec le chargeur de scénario.
- **Calendrier réel conservé ; « 1 minute réelle = 1 mois » est une approximation.** La règle exacte est : à ×1, un jour de jeu = 2 secondes réelles (`gameMinutesPerTick = 72`, 20 ticks par jour). Un mois dure 56 à 62 s, une année ≈ 12,2 min (730 s). Exclut un calendrier à mois de 30 jours ou à année de 360 jours. Phrase de DESIGN.md (section « Le temps ») corrigée en conséquence ; les mentions « 1 min = 1 mois » ailleurs (tableau des décisions, ARCHITECTURE, ROADMAP) restent comme raccourci.
- **Règle d'ajout de dépendance** (section Véritable de CLAUDE.md) : `npm install --save-dev <paquet> --ignore-scripts`, puis `npm run inst` ; jamais `npm install` nu. Remplace l'interdiction absolue qui avait empêché d'ajouter `fake-indexeddb` au J0.
- **`fake-indexeddb` ajouté en dépendance de dev** ; `IndexedDbSaveStore` a désormais son test unitaire (`src/veritable/save/IndexedDbSaveStore.test.ts`).

## 2026-09-21 — J1 : on joue (session Claude Code)

### Décisions validées par Lukas avant le code

- **Terres hors scénario : neutres et non conquérables, par un masque de tuiles** (`Game.setUnclaimableTiles`). Le masque vient des frontières du scénario, jamais des propriétaires courants : une tuile qu'une nation perd (retombées nucléaires) reste reprenable ; une tuile possédée n'est jamais neutre, même dans le masque. Écarté : interdire toute attaque sur terre sans propriétaire (une zone irradiée serait devenue imprenable à jamais) ; marquer ces tuiles infranchissables (altère le terrain partagé avec le rendu et le pathfinding).
- **Pas d'IA héritée en campagne.** `NationExecution` n'est pas enregistré en mode Véritable : les nations restent inertes jusqu'au J3a (guerre) et au J5 (IA). Le joueur garde le combat hérité en attendant. Conséquence heureuse : l'identité octet pour octet d'une sauvegarde rechargée tient maintenant aussi dans la durée (testé sur 100 ticks), puisque plus rien ne réengage de troupes au tick de restauration.
- **Sauvegardes du J0 refusées, avec un message explicite** (`save.error.legacy-j0`). Elles décrivent un monde à nations ad hoc que plus rien ne sait recréer. **L'invariant n° 2 (« une sauvegarde antérieure se charge toujours ») court à partir des premières sauvegardes de scénario du J1** ; celles du J0 sont de la préhistoire locale, jamais distribuée. Le format reste `schemaVersion: 1` : la forme de l'en-tête n'a pas changé (le scénario et la nation jouée vivent dans `world.coreStart.config`), aucune migration n'était donc nécessaire.
- **Carte compacte retirée du parcours Véritable** : un scénario est rasterisé pour la carte en taille normale, et le chargeur refuse toute autre grille.
- **Régimes des dix fiches, posés à la main, révisables au J4 avec V-Dem** : FRA, POL, UKR semi-présidentiel ; DEU, GBR, ITA, ESP, NOR parlementaire ; RUS, TUR autoritaire électoral.
- **Champs chiffrés des fiches nations optionnels jusqu'au J2** (`population`, `gdp`, `debtToGdp`, `production`, `military`, `startingTech`, `interestGroups`, `aiAgenda`, `nuclear`) : l'ingestion du J2 les remplit, **et ils redeviennent obligatoires dans le schéma à ce moment-là**. Ce sont des données, pas de la sauvegarde : aucune migration.

### Géoréférencement et frontières (`tools/veritable/borders/`)

- **La carte Europe n'avait aucun géoréférencement** (ni projection ni bornes dans `map-generator` ou `resources`). **Auto-calibration sur le trait de côte**, sans point de contrôle humain : on cherche la projection et le placement qui maximisent le recouvrement (IoU) entre les terres Natural Earth projetées et le masque terre/mer de `map.bin`, du grossier au fin (×8, ×4, ×2, ×1), par recherche par motifs (l'objectif est constant par morceaux). Graine : les nations du manifeste appariées aux points d'étiquette de Natural Earth.
- **Résultat : projection équirectangulaire (plate carrée), IoU 0,9564 à pleine résolution** ; 40,63 tuiles par degré, rapport d'aspect 1,0004, rotation 0,004° ; emprise ≈ 24,7° O – 46,7° E, 30,2° N – 71,3° N. Candidats écartés : LCC 0,79, Albers 0,77, LAEA 0,73, stéréographique 0,72. L'écart à 1 est de l'eau intérieure (lacs, fleuves creusés par OpenFront), pas un décalage. Validé à l'œil par Lukas sur l'image de contrôle. Stocké dans `data/veritable/maps/europe.georef.json`, qui prévoit aussi des `controlPoints` (repli non utilisé) et des `insets`.
- **Source : Natural Earth v5.1.2, 1:10m, version de facto**, domaine public, depuis `github.com/nvkelso/natural-earth-vector` ; sha256 vérifiés à chaque exécution : `ne_10m_admin_0_countries.geojson` `239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255`, `ne_10m_admin_0_disputed_areas.geojson` `9cafef8b7dfb6b164dc58f218f981f4ace9f716f6c03795d4c62d1ac9f3d50f5`. Cache `tools/veritable/borders/cache/` ignoré par git ; seuls les produits sont commités. Aucune dépendance ajoutée : projections, remplissage de polygones (règle pair-impair, arêtes partagées sans recouvrement ni lacune) et encodeur PNG sont écrits dans l'outil.
- **Règles de rasterisation.** (1) Seules les tuiles terrestres de `map.bin` reçoivent un propriétaire : lacs et fleuves creusés par OpenFront restent de l'eau même où Natural Earth voit de la terre. (2) Tous les pays sont rasterisés, pas seulement ceux du scénario. (3) Les surcharges de facto s'appliquent ensuite. (4) Les côtes orphelines (14 405 tuiles) vont au pays Natural Earth le plus proche **parmi tous les pays**, à 60 tuiles au plus, mer comprise. (5) Le filtre aux nations du scénario ne vient qu'après : une côte belge devient neutre, jamais française.
- **Canaries : encart hors position, laissé neutre.** Les vraies Canaries sont au sud du bord de la carte ; l'encart dessiné en bas à gauche (128 tuiles) est déclaré dans `europe.georef.json` (`insets`, règle `neutral`) et n'est rattaché à personne. Le champ survit à une recalibration.
- **Kaliningrad revient à la Russie** sans règle particulière (multipolygone RUS de Natural Earth). Chypre-Nord (`CYN`) n'est pas la Turquie : neutre au J1.
- **`data/veritable/borders/overrides/<carte>.geojson` est le mécanisme général des territoires contestés.** Une surcharge ne réattribue que les tuiles dont le propriétaire Natural Earth figure dans `from`, si bien qu'un polygone peut déborder sans risque. Au J1 : `crimea` (polygone Natural Earth ; sans effet, la Crimée y est déjà russe ; conservé pour définir la région) et `ukraine-occupied-mainland`.
- **Précision du front ukrainien : approximative, 10 à 30 km.** Tracé à la main par Claude Code d'après sa connaissance de la ligne de contact fin 2025, sans source cartographique importée, marqué `status: "approximate"` et « à valider à la main » dans le fichier ; validé à l'œil par Lukas le 2026-09-21, avec vérification que Koupiansk (rive ouest de l'Oskil) reste ukrainienne. Russe : Louhansk presque entier, est de l'oblast de Kharkiv le long de l'Oskil, Siversk, Tchassiv Yar, Toretsk, Pokrovsk, Houliaïpole, rive gauche du Dniepr. Ukrainien : Kramatorsk, Sloviansk, Kostiantynivka, Orikhiv, Zaporijjia, Kherson. Non tracés : poche de Vovtchansk, incursions frontalières. 17 119 tuiles, soit ≈ 86 000 km² pour ≈ 89 000 réels hors Crimée.
- **Produits** : `borders/europe-10.bin` (76 294 octets ; format `VBRD` = en-tête + liste des nations + bloc RLE du même codec que la sauvegarde), `europe-10.report.json` (tuiles par nation), `europe-10.meta.json` (tuile de chaque capitale). Dix nations : 1 331 874 tuiles sur 2 345 907 terrestres ; 1 013 905 neutres.

### Scénario, chargeur, fiches

- **Un nouveau monde est une restauration.** `initialWorld()` exprime le premier jour du scénario comme un état de sauvegarde (tuiles des frontières, une ville OpenFront sur chaque capitale, qui sert de `spawnTile`) et passe par `CoreBridge.restore()`, le chemin éprouvé au J0. La phase de spawn se clôt au même tick, sans clic. **L'artefact « exilé dès le départ » a disparu** : la sim voit les frontières avant même le premier tick du cœur (testé, y compris sur la vraie carte Europe : dix nations `active`, journal réduit à `campaign-started`).
- **`adHocNations`, `scenarioFromCoreGame` et les noms littéraux sont supprimés.** `scenario.borders` devient obligatoire. Les noms de nations sont des clés i18n (`nation.<iso3>.name`).
- **Écart de DATA-SCHEMAS.md : `capital` = `{ name, lon, lat, source, asOf }`** au lieu de `{ tileHint }`. Une capitale est une donnée géographique ; sa tuile dépend de la carte et c'est l'outil de frontières qui la calcule (`<scénario>.meta.json`), ramenée à la tuile de la nation la plus proche. Ajout : `regimeSource`.
- **Roster du cœur** : une nation du scénario = un joueur de type `Nation` créé par `coreRoster()`, sauf celle du joueur, incarnée par le joueur humain. Liaison nation ↔ joueur par le nom affiché (unique dans un scénario). `GameConfig` porte `veritableScenario` et `veritablePlayerNation`.
- **Chargement des données** : `src/veritable/data/catalog.ts` (`import.meta.glob`, validation zod au premier accès). La sim ne l'importe jamais : elle reçoit les fiches par injection, pour qu'un runner hors Vite (headless, J2) lise les mêmes fichiers sur disque. Le `.bin` est importé en `?inline` (le worker tourne depuis une URL `blob:`, où les URL relatives ne se résolvent pas) ; d'où `assetsInclude: ["**/data/veritable/**/*.bin"]` dans `vite.config.ts`.
- **Guerre en cours** : `rus-ukr-2022` figure dans le scénario comme donnée, sans effet en jeu avant le J3a.

### Temps

- **`Scheduler` central sans état** (`sim/scheduler.ts`) : tout se dérive de `elapsedGameMinutes`, qui est sauvegardé ; le résultat ne dépend pas du découpage du temps (testé tick par tick contre un seul appel). Jour : `economy`, `events`, `diplomacy` ; semaine (tous les 7 jours depuis le départ) : `politics` ; mois (le 1er du mois calendaire) : `politics`, `blocs`, `save`. Les six domaines sont enregistrés et vides. Nouveaux `SimEvent` : `day-started`, `month-started`.
- **Instrumentation par domaine derrière une sonde injectée** (`PerfProbe`) : la sim ne touche pas à `performance`. Dans le worker, `PerformanceProbe` pose un `performance.mark` / `measure` `veritable:<domaine>:<horloge>` par appel, les efface aussitôt (une campagne dure des heures) et cumule appels, total et maximum, lisibles par la requête `perf`.
- **Vitesses = cadence du tick OpenFront.** Pause, ×1, ×2, ×5 pilotent la boucle de tours solo de `LocalServer` (`PauseGameIntentEvent`, `ReplaySpeedChangeEvent(1 / vitesse)`) : le militaire et le calendrier accélèrent ensemble, la sim avance toujours de 72 min par tick. La vitesse est sauvegardée et réappliquée au chargement.
- **Sauvegardes automatiques** : sur `month-started`, le client prend un snapshot et l'écrit avec `kind: "auto"` et l'identifiant `auto-<date de jeu>` (repasser par le même mois écrase son emplacement). `writeAutosave` garde les `save.autosaveSlots = 6` plus récentes (constante dans `config.json`) et ne touche jamais aux sauvegardes manuelles.

### Mesure de ×5 sur la carte Europe (2026-09-21)

- **Navigateur (build de dev, panneau intégré de l'application Claude, carte Europe 2904×1672, dix nations) : ×1 = 9,99 ticks/s, ×2 = 20,09, ×5 = 49,95**, pour des cibles de 10, 20 et 50. Pause : 0.
- **Avant correction, ×5 plafonnait à 41,7 ticks/s** (×1 = 9,5 ; ×2 = 18,7) : ce n'était pas la charge mais la boucle de tours solo de `LocalServer`, qui repartait de « maintenant » à chaque tour et ajoutait ainsi la granularité de son interrogation (≈ 5 ms) à chaque intervalle. **Correction, en campagne uniquement (`// VERITABLE:` dans `src/client/LocalServer.ts`) : planification sans dérive** (`turnStartTime += intervalle`, avec au plus un intervalle de rattrapage pour qu'un blocage ne soit pas suivi d'une rafale). C'est une retouche de la boucle de tours héritée, limitée au mode campagne ; sans elle « un jour = deux secondes » était faux de 5 % à ×1 et de 17 % à ×5. Les tests `LocalServer*` existants restent verts.
- **Banc headless (`VERITABLE_BENCH=1 npx vitest src/veritable/adapters/fiveYears.bench --run`) : cinq ans de jeu, 2026-01-01 → 2031-01-01, soit 36 520 ticks, cœur + sim, sans rendu.** Tick moyen 0,021 ms, médiane 0,017, p99 0,077, maximum 5,4 ms, pour un budget de 20 ms à ×5. Chargement du scénario (1 331 874 tuiles posées, dix villes) : 672 ms. Sauvegarde : 95 ms, 77 004 octets dont 76 235 de tuiles. Rechargement : 679 ms, octets identiques. 60 mois, 260 semaines, 1 826 jours déclenchés ; les sept horloges de domaine (vides) cumulent 1,2 ms sur les cinq ans. Ces chiffres valent pour des nations inertes : ils serviront de base de comparaison au J2.
- **Limite de la mesure navigateur** : le panneau intégré bride ses timers quand il n'est pas interrogé (0 image/s mesurée hors interaction). Les cadences ci-dessus sont mesurées pendant des fenêtres de 8 à 12 s ; les cinq ans de jeu d'une traite ont été joués headless, et dans le navigateur sur 17 mois de jeu (16 sauvegardes automatiques écrites, 6 conservées).

### Modifications de `src/core` au J1

Toutes sous le drapeau `veritable`, commentées `// VERITABLE:`, testées avec un contrôle sans drapeau dans `tests/veritable/NeutralLand.test.ts` et `src/veritable/adapters/VeritableSession.test.ts`.

| Fichier                                 | Modification                                                                                                                                                                                            | Raison                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `src/core/Schemas.ts`                   | `veritableScenario`, `veritablePlayerNation` (optionnels) dans `GameConfigSchema`                                                                                                                       | Le scénario et la nation jouée recréent le jeu cœur d'une sauvegarde |
| `src/core/game/Game.ts`, `GameImpl.ts`  | `setUnclaimableTiles(mask)` / `isUnclaimable(tile)` ; additif, refusé hors campagne, taille vérifiée                                                                                                    | Terres neutres (pré-autorisation reconduite)                         |
| `src/core/game/PlayerImpl.ts`           | `canAttack` refuse une tuile neutre et ne traverse pas de terres neutres pour atteindre une cible                                                                                                       | Idem                                                                 |
| `src/core/execution/AttackExecution.ts` | Une attaque sur terre sans propriétaire saute les tuiles neutres (conquête et front)                                                                                                                    | Idem                                                                 |
| `src/core/game/TransportShipUtils.ts`   | Pas de débarquement sur un rivage neutre                                                                                                                                                                | Idem                                                                 |
| `src/core/GameRunner.ts`                | `createGameRunner(…, veritable?: { nations, onGameCreated })` : roster du scénario à la place du manifeste (remplace le paramètre `onGameCreated` du J0) ; `NationExecution` non enregistré en campagne | Chargeur de scénario ; nations inertes                               |
| `src/core/worker/Worker.worker.ts`      | Charge la campagne (`loadCampaign`) avant de créer le jeu                                                                                                                                               | Roster et frontières viennent du scénario                            |

`TransportShipExecution.ts` n'a pas eu besoin d'être modifié, contrairement au plan : il passe par `targetTransportTile`, où vit la garde. Aucun test OpenFront existant n'a été modifié.

### Schémas zod créés ou modifiés (sauvegarde : toujours `schemaVersion` 1)

`nation.ts` (capitale géographique, `regimeSource`, champs chiffrés optionnels jusqu'au J2), `scenario.ts` (`adHocNations` supprimé, `borders` obligatoire, au moins une nation), `config.ts` (`time.defaultStartDate`, `save.autosaveSlots`), nouveau format binaire `data/bordersFile.ts` (`VBRD` v1).

## 2026-09-21 — Clôture du J1 (validation du rapport)

- **J1 validé par Lukas.** Correction de dérive de `LocalServer` validée.
- **Le bouton « Solo » hérité ouvre le panneau de départ Véritable** au lieu de lancer une campagne France par défaut (`GameModeSelector.openSinglePlayerModal`, `// VERITABLE:`). Suppression du bouton au J7. La modale solo d'OpenFront n'est plus atteignable que par le tutoriel.
- **Chypre-Nord reste neutre au J1. À traiter au J6 comme région contestée de facto distincte de la Turquie** (Natural Earth la donne comme entité à part, `CYN`) : contrôleur de facto à modéliser, reconnue par la seule Turquie.
- **Dette n° 1 — catalogue de données.** `src/veritable/data/catalog.ts` repose sur `import.meta.glob` (Vite) ; un runner lancé par `tsx` ne peut pas l'importer. Réglée au J2 par un chargeur à deux implémentations (Vite et `fs`) derrière une même interface.
- **Dette n° 2 — liaison nation ↔ joueur du cœur par nom d'affichage** (`bindScenario`) : deux nations d'un même scénario ne peuvent pas partager un nom, et une traduction change la liaison. À remplacer par un identifiant (la `NationId` portée par le `PlayerInfo`) la prochaine fois qu'on touche le cœur, au plus tard au J3a.

## À compléter par Claude Code

- Commit de départ du fork (`upstream-base`) : `4bf92e3c98201326003f790839e04dfcc43ff41a` (« meta: raise saturation midpoints… #5587 »), tag `upstream-base`. Noté le 2026-09-21.
- Échecs de `npm test` connus sur la machine de développement Windows, présents sur le code d'origine et indépendants du jeu — ne pas réparer ; « tests verts » = aucun échec au-delà de ces trois :
  1. `tests/UpdateRegister.test.ts` (2 tests) — exécute le script shell `update.sh`.
  2. `tests/client/clan/ClanDonateDialog.test.ts` (1 test) — format de nombre dépendant de la locale `fr`.
- Chaque modification de `src/core` : fichier, raison, ligne `// VERITABLE:`.
- Chaque schéma zod créé ou modifié : version de `schemaVersion` associée.
