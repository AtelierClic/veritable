# Véritable — schémas de données (v1)

Forme de chaque fichier JSON de `data/veritable/`. Claude Code en dérive les schémas zod dans `src/veritable/data/schemas/` ; ce fichier reste la référence lisible. Chaque champ chiffré issu d'une source réelle porte `source` et `asOf`. Tout champ non listé ici est une extension à noter dans `DECISIONS.md`.

Conventions : identifiants en `kebab-case` ou ISO 3166-1 alpha-3 ; nombres en unités SI ou en % ; dates ISO 8601 ; les chaînes visibles sont des clés i18n (`"name": "nation.fra.name"`).

## nation (`nations/<iso3>.json`)

```jsonc
{
  "id": "FRA",
  "name": "nation.fra.name",
  "capital": { "name": "nation.fra.capital", "lon": 2.3522, "lat": 48.8566, "source": "manual", "asOf": "2026-01-01" },   // la tuile dépend de la carte : calculée par tools/veritable/borders → borders/<scénario>.meta.json
  "regime": "semi-presidential",          // voir regimes ci-dessous
  "regimeSource": { "source": "manual", "asOf": "2026-01-01" },
  "blocs": ["eu", "nato", "g7", "g20"],
  "nuclear": { "warheads": 290, "doctrine": "first-use-possible" } | null,
  "territory": { "kind": "tiles" } | { "kind": "microstate", "hostTile": [x, y] },
  "contested": [ { "region": "region-id", "controller": "FRA", "claimants": ["..."], "recognizedBy": ["..."] } ],
  "population": { "value": 68.5e6, "source": "worldbank", "asOf": "2025" },
  "gdp": { "value": 3.1e12, "source": "worldbank", "asOf": "2025" },
  "debtToGdp": { "value": 1.10, "source": "worldbank", "asOf": "2025" },
  "production": { "oil": 0.02, "gas": 0.01, "electricity": 1.0, "food": 1.2, "...": 0 },   // capacité / consommation domestique, par bien
  "military": { "spendingPctGdp": 2.0, "activePersonnel": 200000, "airPower": 0.6, "navalPower": 0.7, "source": "sipri", "asOf": "2025" },
  "startingTech": ["energy-nuclear-3", "air-4"],
  "interestGroups": { "business": 0.15, "workers": 0.20, "farmers": 0.05, "military": 0.05, "religious": 0.05, "youth": 0.15, "retirees": 0.20, "minorities": 0.15 },
  "aiAgenda": [ { "goal": "security", "weight": 0.4 }, { "goal": "growth", "weight": 0.3 }, { "goal": "regional-influence", "weight": 0.2 }, { "goal": "ideology", "weight": 0.1 } ]
}
```

Régimes (`regime`) : `parliamentary`, `presidential`, `semi-presidential`, `electoral-authoritarian`, `single-party`, `absolute-monarchy`, `junta`, `theocracy`, `failed-state`. Chaque régime est décrit dans `regimes.json` : `successionRule`, `electionIntervalMonths | null`, `coupBaseProbability`, `availableLawDomains`.

Doctrines nucléaires : `first-use-possible`, `no-first-use`, `undeclared`, `unpredictable`.

Jusqu'à l'ingestion du J2, les champs chiffrés (`nuclear`, `population`, `gdp`, `debtToGdp`, `production`, `military`, `startingTech`, `interestGroups`, `aiAgenda`) sont optionnels dans le schéma ; ils redeviennent obligatoires ensuite.

### Économie d'une nation (depuis le J2)

Le champ `production` en ratios est remplacé par `economy`, en quantités par an dans l'unité du bien, chaque chiffre avec `source`, `asOf` et, pour `derived` et `estimate`, une `note` :

```jsonc
"economy": {
  "growthBase": { "value": 0.0125, "source": "worldbank:NY.GDP.MKTP.KD.ZG", "asOf": "2015-2024", "note": "…" },
  "goods": { "gas": { "production": { "value": 0, "source": "owid-energy@7e387a16:gas_production", "asOf": "2016" },
                      "consumption": { "value": 320.4, "source": "owid-energy@7e387a16:gas_consumption", "asOf": "2024" } }, "…": {} },
  "electricityFromFossil": { "gas": { "value": 17, "…": "" }, "coal": {}, "oil": {} },   // TWh produits à partir de chaque combustible
  "budget": {
    "revenuePctGdp": {}, "expensePctGdp": {}, "grantsPctGdp": {},
    "revenueShares": { "value": { "income": 0.42, "corporate": 0.14, "vat": 0.435, "tariffs": 0.005, "rents": 0 }, "source": "estimate", "asOf": "…", "note": "…" },
    "spending": { "defense": {}, "social": {}, "healthEducation": {}, "research": {}, "infrastructure": {}, "subsidies": {} }   // parts du PIB
  }
}
```

`source` vaut `worldbank:<indicateur>`, `owid-energy@<commit>:<colonne>`, `derived` (calculé à partir de chiffres sourcés, méthode en note) ou `estimate` (aucune source ouverte : justification en note, liste dans `tools/veritable/ingest/estimates.json`). `interestGroups` (surcharge des poids par défaut) et `aiAgenda` (J5) restent optionnels.

## reste du monde (`row.json`)

```jsonc
{
  "id": "ROW",
  "name": "nation.row.name",
  "scenario": "europe-10",
  "goods": {
    "oil": {
      "production": {
        "value": 45190.6,
        "source": "derived",
        "asOf": "2024",
        "note": "Production mondiale moins celle des dix nations.",
      },
      "consumption": { "…": "" },
    },
  },
}
```

Participant du marché, pas une nation : hors carte, jamais jouable, sans politique ni budget. Il ferme le bilan mondial de chaque bien. Depuis le J3 il porte aussi `gdp` (PIB mondial moins celui des nations du scénario, dérivé) : son poids parmi les partenaires commerciaux d'une nation.

### Dépendance commerciale (depuis le J3)

`economy.tradeOpenness` : commerce (exportations + importations) en part du PIB, `worldbank:NE.TRD.GNFS.ZS`. C'est l'assiette de la dépendance commerciale : PIB visé = 1 − friction × ouverture × part des partenaires (par distance et PIB) qui sanctionnent ou combattent la nation × (1 − contournement).

## guerre (`war/divisions.json`, `war/casus-belli.json`)

```jsonc
[{ "id": "armored", "name": "division.armored", "attack": 3, "defense": 1.5, "men": 12000, "arms": 5 }]
[{ "id": "contested-territory", "name": "casus.contested-territory", "check": "contested-territory", "relationsCost": 5 }]
```

Quatre gabarits (`infantry`, `mechanized`, `armored`, `artillery`) ; `arms` = unités d'armement (× `war.armsIndexPerEquipmentUnit` points d'indice) pour un rééquipement complet. Casus belli : `check` ∈ `contested-territory`, `ally-attacked`, `humanitarian`, `none` ; `relationsCost` = relations perdues avec toute nation par mois de guerre, avant le multiplicateur de puissance.

## zones maritimes (`maps/<carte>.seas.json`, `borders/<scénario>.zones.bin`)

```jsonc
{
  "map": "europe",
  "zones": [
    { "id": "north-sea", "name": "sea.north-sea", "lon": 3, "lat": 56 },
  ],
}
```

Germes projetés en tuiles par le géoréférencement, ramenés à l'eau la plus proche ; partition des tuiles d'eau par parcours en largeur multi-source sur l'eau (`tools/veritable/borders zones`). Format `VZON` : `"VZON"` u8 version u32 largeur u32 hauteur u16 nombre de zones, identifiants (u8 longueur + ASCII), u32 longueur + bloc RLE du codec des sauvegardes ; valeur = index de zone + 1, 0 = terre ou eau hors zone. `borders/<scénario>.zones.json` : germes en tuiles et tuiles par zone.

### Politique d'une nation (depuis le J4)

Champ `politics`, obligatoire : `{ electionIntervalMonths, lastElection, electionsSuspendedAtWarAtHome, groupIdeologies?, source, asOf, note? }`. `lastElection` = dernière élection nationale réelle ; la prochaine = dernière + intervalle. `electionsSuspendedAtWarAtHome` : les élections sont reportées tant qu'un front touche le territoire (vrai pour UKR). `groupIdeologies` : surcharge de l'idéologie des huit groupes (défaut dans `config.json → politics.groupIdeologies`).

## regimes (`politics/regimes.json`)

```jsonc
{
  "id": "parliamentary",
  "name": "regime.parliamentary",
  "electionIntervalMonths": 48, // null : pas d'élection
  "successionRule": "election", // election | party | hereditary | military-council | clerical | warlord
  "government": "coalition", // coalition | leading-party | appointed
  "democratic": true, // compte comme démocratie (relations, critère des blocs)
  "coupBase": 0.001,
  "legitimacyBase": 0.8,
  "pressFreedom": 0.9,
  "mediaControl": 0, // valeurs structurelles ; les lois s'y ajoutent
  "lawDomains": [
    "economy",
    "social",
    "security",
    "institutions",
    "environment",
    "defense",
  ],
}
```

## ideologies (`politics/ideologies.json`)

Table QID Wikidata → `{ label, economic, authority, sovereignty }` (trois axes dans [−1, 1] : gauche…droite, libéral…autoritaire, internationaliste…souverainiste). L'idéologie d'un parti = moyenne de ses idéologies (P1142) connues de la table ; une idéologie absente est ignorée et signalée par l'outil.

## objectives (`politics/objectives.json`)

`{ id, name, description, condition }` avec `condition.kind` ∈ `gdp-ratio` (value), `join-bloc` (bloc), `stability-above` (value, years), `retake-region`, `no-war` (years), `debt-below` (value), `self-sufficient` (good), `legitimacy-above` (value), `win-election`, `shortage-below` (value, years), `export-share` (good, value). Cinq épinglables ; complétion → journal, +20 de capital, +0,05 de légitimité.

## names (`names/<iso3>.json`)

`{ nation, first: [...], last: [...] }` : réservoirs de prénoms et de noms pour les dirigeants générés en campagne (noms littéraux tirés au `Rng`) et pour le nom fictif des dirigeants réels (tiré une fois à l'ingestion, déterministe par identifiant).

## leader (`leaders/<iso3>.json`)

```jsonc
{
  "nation": "FRA",
  "actors": [
    {
      "id": "fra-emmanuel-macron",
      "role": "head-of-state", // head-of-state | head-of-government | party-leader | military-chief
      "names": {
        "parody": "leader.fra-emmanuel-macron.parody",
        "fictional": "leader.fra-emmanuel-macron.fictional",
      },
      "born": "1977-12-21",
      "party": "fra-renaissance",
      "traits": {
        "economic": 0.3,
        "authority": -0.1,
        "sovereignty": -0.7,
        "aggressiveness": 0.4,
        "corruption": 0.15,
        "charisma": 0.6,
        "competence": 0.6,
      },
      "wikidata": "Q3052772",
      "source": "estimate", // estimate (traits écrits à la main, `note` les justifie) | derived (depuis l'idéologie du parti)
      "asOf": "2026-09-23",
      "note": "…",
    },
  ],
  "parties": [
    {
      "id": "fra-renaissance",
      "name": "party.fra-renaissance",
      "wikidata": "Q23731823",
      "ideologies": ["Q201712", "…"],
      "ideology": { "economic": 0.1, "authority": -0.5, "sovereignty": -0.5 },
      "ideologySource": "wikidata:P1142 x ideologies.json (3 of 3)",
      "support": 0.2,
      "supportSource": {
        "source": "estimate",
        "asOf": "2026-09-23",
        "note": "Législatives 2024, premier tour",
      },
      "leader": "fra-gabriel-attal",
    },
  ],
}
```

Produit par `npm run veritable:ingest -- fetch-wikidata` (instantanés SPARQL commités, sha256 dans le verrou) puis `build-leaders` (hors ligne) : chefs d'État et de gouvernement (P35, P6), partis listés dans `tools/veritable/ingest/parties.json` (parts de la dernière élection, `estimate`), leurs chefs (P488), naissances (P569), idéologies (P1142) projetées sur les trois axes par `politics/ideologies.json`. Les traits des chefs d'État et de gouvernement viennent de `estimates.json → leaderTraits`, écrits à la main et justifiés ; ceux des chefs de parti sont dérivés de l'idéologie. Le réglage `config.json → leaderNames: "parody" | "fictional"` choisit le nom affiché ; les noms parodiques sont écrits à la main dans `fr.json`, les fictifs générés par l'outil.

## goods (`goods/goods.json`)

```jsonc
[
  {
    "id": "oil",
    "name": "good.oil",
    "tier": 1,
    "transportable": true,
    "storable": true,
    "basePrice": 80,
    "unit": "Mbbl",
  },
  {
    "id": "electricity",
    "name": "good.electricity",
    "tier": 1,
    "transportable": "neighbors-only",
    "storable": false,
    "basePrice": 60,
    "unit": "TWh",
    "producedFrom": {
      "oil": 0.1,
      "gas": 0.4,
      "coal": 0.3,
      "nuclearRenewableCapacity": 1.0,
    },
  },
  {
    "id": "services",
    "name": "good.services",
    "tier": 1,
    "transportable": "free",
    "storable": false,
    "basePrice": 1,
    "unit": "index",
  },
]
```

Palier 1 : `oil, gas, coal, electricity, food, critical-minerals, steel, consumer-goods, electronics, arms, pharma, services`. Depuis le J2 chaque bien porte aussi `epsilon` (élasticité de la demande), `eta` (de l'offre), `shortageWeight`, `rent`, `industrial`, `transport` (`normal` | `neighbors-only` | `free`) et `basePriceSource`. Depuis la clôture du J3, un bien peut porter `circumvention: { initial, perMonth, max }` (part du marché perdu qu'un exportateur embargoé réoriente d'emblée, montée mensuelle proportionnelle à la part perdue, plafond) ; défaut dans `config.json → economy.circumvention`. Un bien fongible transporté par mer (pétrole, charbon) se contourne plus vite qu'un gaz de gazoduc. Unités : TWh par an pour l'énergie, Mt pour l'alimentation, indice 100 = production du scénario (avec un `basePrice` en M$ par point) pour le reste. Le palier 2 ajoute des lignes avec `"parent": "oil"` sans changer le moteur.

## law (`laws/<domain>.json`)

```jsonc
{
  "id": "media-control",
  "name": "law.media-control.name",
  "description": "law.media-control.desc",
  "domain": "institutions", // economy | social | security | institutions | environment | defense
  "capitalCost": 30,
  "reversible": { "cost": 60, "delayMonths": 12 }, // null : irréversible
  "window": {
    "economic": [-1, 1],
    "authority": [0.2, 1],
    "sovereignty": [-1, 1],
  }, // boîte idéologique du gouvernement
  "regimes": ["parliamentary", "…"],
  "requiresLegitimacy": 0.6, // réformes constitutionnelles seulement
  "effects": [
    { "target": "mediaControl", "op": "set", "value": 0.5, "mode": "while" },
    { "target": "legitimacy", "op": "add", "value": -0.1, "mode": "once" },
    {
      "target": "relations.democracies",
      "op": "add",
      "value": -20,
      "mode": "once",
    },
  ],
}
```

`mode: "once"` s'applique à la promulgation (`legitimacy`, `capital`, `relations.democracies`, `groups.<g>`, `spending.<poste>` et `taxes.<impôt>` sur les cibles des curseurs, `regime`) ; `mode: "while"` tant que la loi est en vigueur (`groups.<g>` décalage de la cible de satisfaction, `growthBase`, `mediaControl`, `pressFreedom`, `corruption`, `coupRisk` (`mul`), `conscriptionCeiling`, `manpowerBonus`, `electionIntervalMonths`, `legitimacyBase`). Le gouvernement en place refuse une loi hors de sa fenêtre et abroge en `config.politics.laws.repealDelayMonths` celles en vigueur qui en sortent. Quarante-six lois au J4.

Curseurs : les impôts et les postes de dépense ont une cible (`taxTargets`, `spendingTargets` dans la sauvegarde) que la valeur en vigueur rejoint en fermant `1 / rampMonths` de l'écart chaque mois.

## event (`events/scripted/<id>.json`, `events/templates/<id>.json`)

Forme du J5, validée par `src/veritable/data/schemas/event.ts` (liste complète des conditions et des effets, avec leur sens). Un fichier par événement, nommé d'après son `id`. Un événement désigne des fonctions (le chef du gouvernement, un ministre, l'état-major), jamais une personne réelle, et n'attribue aucun crime ni scandale à un dirigeant réel.

```jsonc
{
  "id": "border-incident",
  "kind": "template", // scripted (une fois par nation, 2026-2030) | template (répétable)
  "title": "event.border-incident.title", // textes : {nation} {other} {good}
  "text": "event.border-incident.text",
  "scope": "nation", // nation : une nation à la fois ; world : une fois dans le monde
  "trigger": {
    "dateRange": ["2026-01-01", "2030-12-31"], // facultatif
    "nations": ["POL", "NOR"], // facultatif : toutes sinon
    "monthlyProbability": 0.004,
    "conditions": [{ "target": "stability", "op": "lt", "value": 0.5 }],
    "once": false,
    "cooldownMonths": 36,
  },
  "params": { "other": "neighbor" }, // other : neighbor | any | rival ; good : any | energy | food | industrial
  "worldEffects": [], // scope world : appliqués une fois
  "effects": [], // appliqués au déclenchement, avant le choix
  "choices": [
    {
      "id": "escalate",
      "label": "event.border-incident.escalate",
      "effects": [
        { "target": "grievance.other", "op": "set", "value": 1, "months": 24 },
        { "target": "relations.other", "op": "add", "value": -15 },
        { "target": "opinion", "op": "add", "value": -0.02, "uncertain": true },
      ],
    },
  ],
  "pause": true, // la fenêtre met le jeu en pause
  "journal": true,
}
```

Effets : `budget.pctGdp`, `gdp`, `growth` (avec `months`), `stability`, `opinion`, `legitimacy`, `exhaustion`, `capital`, `group.<groupe>`, `production.<bien>`, `consumption.<bien>`, `spending.defense`, `spending.research`, `unrest`, `relations.all|neighbors|other|<ISO3>`, `grievance.other|<ISO3>` (casus belli « grief » pour `months` mois), `worldSupply.<bien>`. Conditions : stabilité, opinion, légitimité, épuisement, dette, déficit, croissance, pénurie, couverture et prix d'un bien, guerre, troubles, démocratie, arme nucléaire, joueur, part des tuiles perdues, PIB par habitant, régime, appartenance à un bloc.

## bloc (`blocs/<slug>.json`)

Forme du J5 (couches 2 et 3), validée par `src/veritable/data/schemas/bloc.ts`. Tous les pays membres figurent dans la liste ; en europe-10 seuls les membres simulés votent, paient et reçoivent (artefact levé au J6).

```jsonc
{
  "id": "eu",
  "name": "bloc.eu.name",
  "members": [
    { "nation": "FRA", "status": "full" }, // full | candidate | observer | partner | associate | suspended
    { "nation": "UKR", "status": "candidate" },
  ],
  // Une règle par domaine : unanimity | consensus | qualified-majority | simple-majority
  "decisionRules": {
    "sanctions": "unanimity",
    "lift": "unanimity",
    "accession": "unanimity",
    "suspension": "unanimity",
    "budget": "qualified-majority",
    "defense": "unanimity",
    "tech": "qualified-majority",
    "trade": "qualified-majority",
  },
  "qualifiedMajority": { "memberShare": 0.55, "populationShare": 0.65 },
  "budget": {
    "contributionPctGdp": 0.01,
    "structuralFundsBelowGdpPerCapitaShare": 0.9,
    "shares": {
      "structural": 0.5,
      "defense": 0.15,
      "candidates": 0.05,
      "programs": 0.3,
    },
  },
  // Sans regimes ni minRelations : bloc sur invitation, pas de candidature.
  "accession": {
    "regimes": ["parliamentary", "presidential", "semi-presidential"],
    "maxDebtToGdp": 1.2,
    "minRelations": 20,
    "monthsMin": 24,
    "monthsMax": 60,
  },
  "exit": { "delayMonths": 24, "tradeCostPctGdp": 0.02 },
  // rotating (ordre et durée du mandat) | hegemon | elected
  "leadership": {
    "kind": "rotating",
    "termMonths": 6,
    "order": ["CYP", "IRL", "LTU"],
  },
  // Défense collective (OTAN) : probabilité d'entrer en guerre dans le mois.
  "collectiveDefense": {
    "joinProbability": 0.9,
    "sovereignJoinProbability": 0.5,
    "sovereigntyAbove": 0.7,
  },
  "competencies": ["trade", "sanctions", "defense", "tech"],
  "techBranch": "eu-strategic-autonomy",
  "fiscalRule": {
    "maxDeficitToGdp": 0.03,
    "deficitYears": 2,
    "maxDebtToGdp": 0.6,
    "debtRisingMonths": 12,
    "opinionMalus": 0.03,
    "malusFadeMonths": 6,
  },
  "tradeBonus": 1.5,
  "suspendsOnCoup": true,
  "layer": 3,
}
```

## tech (`tech/trunk.json`, `tech/branches/<bloc>.json`)

Forme du J5, validée par `src/veritable/data/schemas/tech.ts`. Le tronc est un tableau de nœuds (dix domaines, paliers 1 et 2) ; une branche est le tableau des nœuds d'un bloc (`bloc` renseigné).

```jsonc
{
  "id": "energy-smr",
  "name": "tech.energy-smr.name",
  "description": "tech.energy-smr.desc",
  "domain": "energy", // energy industry agriculture digital health land naval air nuclear space
  "tier": 1,
  "cost": 110, // points de recherche
  "monthsMin": 9,
  "requires": ["nuclear-industry"],
  "adoptedAbove": null, // indice de développement à partir duquel une nation l'a le 1er janvier 2026
  "adoptedBy": ["FRA"], // facultatif : nations qui l'ont en 2026 quel que soit leur indice
  "bloc": "eu", // facultatif : nœud de branche, réservé aux membres pleins
  "effects": [
    { "target": "production.electricity", "op": "mul", "value": 1.04 },
  ],
}
```

Effets : `production.<bien>` et `consumption.<bien>` (`mul`, une fois, sur les capacités), `growth` (`add`, par an), `military.land`, `military.air`, `military.naval`, `research` (`mul`, tant que le nœud est en vigueur). La part de l'effet qui compte est dans `config.json` (`tech.effectScale`).

## scenario (`scenarios/<slug>.json`)

```jsonc
{
  "id": "world-2026",
  "map": "world",
  "startDate": "2026-01-01",
  "nations": ["FRA", "DEU", "..."], // sous-ensemble pour europe-10
  "borders": {
    "source": "natural-earth-de-facto",
    "rasterized": "borders/world-2026.bin",
  },
  "contested": [
    {
      "region": "crimea",
      "controller": "RUS",
      "claimants": ["UKR"],
      "recognizedBy": [],
    },
  ],
  "wars": [
    {
      "id": "...",
      "belligerents": [["A"], ["B"]],
      "since": "2022-02-24",
      "intensity": 0.8,
      "fronts": [],
    },
  ],
  "playerDefault": "FRA",
}
```

## save (fichier de sauvegarde)

```jsonc
{
  "schemaVersion": 1,
  "seed": 42,
  "rngState": "...",
  "calendar": { "date": "2029-04-12", "speed": 1 },
  "nations": [],
  "blocs": [],
  "world": {},
  "tilesRef": "tiles.bin",
  "journal": [],
  "metrics": {},
}
```

Depuis le J2 (`schemaVersion: 2`) la sauvegarde porte aussi `economy` (marché : prix, volumes bloqués, reste du monde, embargos ; économie de chaque nation : PIB, dette, capacités, couverture, curseurs, soldes…) et `politics` (groupes du joueur, opinion, stabilité, troubles, réprimande). Schéma de référence : `src/veritable/data/schemas/save.ts` ; v1 figée dans `saveV1.ts`.

Depuis le J3 (`schemaVersion: 3`) la sauvegarde porte `diplomacy` (relations, guerres avec score, recul, tuiles prises et offres de paix, sanctions, appels de coalition, régions contestées issues des cessions, réparations, démilitarisations), `military` (par nation : conscription, réserve d'effectifs, divisions avec affectation et posture, épuisement, entraînement, pertes, puissances aérienne et navale), `naval` (déploiements, contrôle des zones, blocus), et l'économie gagne prix à l'import, production effective du reste du monde, exportations vendues et part de référence, frappes aériennes, commerce maritime, contournement, ouverture et facteur de dépendance commerciale. Le bit 12 d'une tuile sauvegardée marque une terre contestée.

Depuis le J4 (`schemaVersion: 4`) le contournement est un enregistrement par bien, les curseurs ont des cibles (`taxTargets`, `spendingTargets`), et `politics.nations[id]` porte le moteur politique : `regime` (en jeu), `legitimacy`, `capital`, `corruption`, `pressFreedom`, `mediaControl`, `leader` (acteur : nom clé ou littéral, naissance, parti, rôle, sept traits), `parties[]` (idéologie, part, chef), `government` (partis, date, idéologie), `nextElection`, `lastElection` (résultats, part du sortant, alternance, fraude détectée), `electionsSuspended`, `levers` (propagande, fraude, clientélisme), `laws[]`, `repealing[]`, `lowStabilityMonths`, `fraudCoupUntil`, `coupRisk`, `groupIdeologies`, compteurs (`alternations`, `coups`, `revolutions`, `electionsWon`), `suspendedFrom` (blocs). `politics.player` porte les objectifs épinglés (`id`, `since`, `baseline`, `progress`, `done`) et les notes. Nouveaux `kind` du journal : `election-held`, `government-formed`, `elections-suspended`, `law-enacted`, `law-refused`, `law-repealed`, `law-repeal-announced`, `coup-attempted`, `coup-succeeded`, `revolution`, `leader-died`, `leader-succeeded`, `fraud-detected`, `objective-completed`, `regime-changed`, `bloc-suspended`, `note`. Schéma de référence : `src/veritable/data/schemas/save.ts` ; v1, v2 et v3 figées dans `saveV1.ts`, `saveV2.ts` et `saveV3.ts`.

Migrations : `migrations/v1-to-v2.ts` exporte `(save: SaveV1, contexte) => SaveV2` ; `migrations/v2-to-v3.ts` exporte `(save: SaveV2, contexte) => SaveV3` (contexte : config, données, fiches, scénario). Le chargeur applique la chaîne jusqu'à la version courante.
