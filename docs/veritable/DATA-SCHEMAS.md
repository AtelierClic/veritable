# Véritable — schémas de données (v1)

Forme de chaque fichier JSON de `data/veritable/`. Claude Code en dérive les schémas zod dans `src/veritable/data/schemas/` ; ce fichier reste la référence lisible. Chaque champ chiffré issu d'une source réelle porte `source` et `asOf`. Tout champ non listé ici est une extension à noter dans `DECISIONS.md`.

Conventions : identifiants en `kebab-case` ou ISO 3166-1 alpha-3 ; nombres en unités SI ou en % ; dates ISO 8601 ; les chaînes visibles sont des clés i18n (`"name": "nation.fra.name"`).

## nation (`nations/<iso3>.json`)

```jsonc
{
  "id": "FRA",
  "name": "nation.fra.name",
  "capital": { "tileHint": [x, y] },
  "regime": "semi-presidential",          // voir regimes ci-dessous
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

## leader (`leaders/<iso3>.json`)

```jsonc
{
  "nation": "FRA",
  "actors": [
    {
      "id": "fra-head-of-state-2026",
      "role": "head-of-state",                     // head-of-state | head-of-government | opposition | party-leader | military-chief
      "names": { "parody": "leader.fra.hos.parody", "fictional": "leader.fra.hos.fictional" },
      "born": "1977-12-21",
      "party": "fra-renaissance",
      "traits": {
        "economic": 0.3,          // -1 gauche … +1 droite
        "authority": -0.2,        // -1 libéral … +1 autoritaire
        "sovereignty": -0.6,      // -1 internationaliste … +1 souverainiste
        "aggressiveness": 0.3, "corruption": 0.2, "charisma": 0.6, "competence": 0.6    // 0 … 1
      },
      "source": "wikidata", "asOf": "2026-01-01"
    }
  ],
  "parties": [ { "id": "fra-renaissance", "name": "party.fra.renaissance", "ideology": { "economic": 0.3, "authority": -0.2, "sovereignty": -0.6 }, "support": 0.22 } ]
}
```

Le réglage global `config.json → leaderNames: "parody" | "fictional"` choisit quel nom est affiché.

## goods (`goods/goods.json`)

```jsonc
[
  { "id": "oil", "name": "good.oil", "tier": 1, "transportable": true, "storable": true,  "basePrice": 80,  "unit": "Mbbl" },
  { "id": "electricity", "name": "good.electricity", "tier": 1, "transportable": "neighbors-only", "storable": false, "basePrice": 60, "unit": "TWh",
    "producedFrom": { "oil": 0.1, "gas": 0.4, "coal": 0.3, "nuclearRenewableCapacity": 1.0 } },
  { "id": "services", "name": "good.services", "tier": 1, "transportable": "free", "storable": false, "basePrice": 1, "unit": "index" }
]
```

Palier 1 : `oil, gas, coal, electricity, food, critical-minerals, steel, consumer-goods, electronics, arms, pharma, services`. Le palier 2 ajoute des lignes avec `"parent": "oil"` sans changer le moteur.

## law (`laws/<domain>.json`)

```jsonc
{
  "id": "media-control",
  "name": "law.media-control.name", "description": "law.media-control.desc",
  "domain": "institutions",                 // economy | social | security | institutions | environment | defense
  "regimes": ["electoral-authoritarian", "single-party", "junta", "theocracy", "absolute-monarchy"],
  "politicalCapitalCost": 30,
  "reversible": { "cost": 60, "delayMonths": 12 },
  "effects": [
    { "target": "election.mediaLever", "op": "set", "value": 0.5 },
    { "target": "groups.youth.satisfaction", "op": "add", "value": -0.1 },
    { "target": "relations.blocs.eu", "op": "add", "value": -20 }
  ]
}
```

Curseurs (`sliders.json`) : même forme d'`effects`, avec `min`, `max`, `default`, `rampMonths`.

## event (`events/scripted/*.json`, `events/templates/*.json`)

```jsonc
{
  "id": "sea-climate-crisis",
  "kind": "scripted",                       // scripted | template
  "title": "event.sea-climate-crisis.title", "text": "event.sea-climate-crisis.text",
  "trigger": { "dateRange": ["2027-01-01", "2029-12-31"], "region": "southeast-asia", "monthlyProbability": 0.02, "conditions": [] },
  "params": {},                             // pour un template : { "region": "any-region", "good": "any-good" }
  "choices": [
    { "id": "help", "label": "event.sea-climate-crisis.help",
      "effects": [ { "target": "budget.balance", "op": "add", "value": -2e9 }, { "target": "relations.region", "op": "add", "value": 10 }, { "target": "leader.image", "op": "add", "value": 0.05 } ] },
    { "id": "ignore", "label": "event.sea-climate-crisis.ignore",
      "effects": [ { "target": "relations.region", "op": "add", "value": -5, "uncertain": true } ] }
  ],
  "pause": true, "journal": true
}
```

## bloc (`blocs/<slug>.json`)

```jsonc
{
  "id": "eu", "name": "bloc.eu.name",
  "members": [ { "nation": "FRA", "status": "full" }, { "nation": "UKR", "status": "candidate" } ],
  "joinCriteria": { "regimes": ["parliamentary", "presidential", "semi-presidential"], "maxDebtToGdp": 0.6, "geography": "europe" },
  "exit": { "delayMonths": 24, "cost": 0.02 },
  "decisionRules": { "sanctions": "unanimity", "trade": "qualified-majority", "budget": "qualified-majority", "defense": "unanimity" },
  "budget": { "contributionPctGdp": 0.01, "spending": { "aid": 0.3, "structural": 0.5, "defense": 0.2 } },
  "competencies": ["trade", "sanctions", "currency", "free-movement", "norms"],
  "leadership": "rotating",                 // rotating | elected | hegemon
  "techBranch": "eu-strategic-autonomy",
  "layer": 1                                // couche implémentée : 1 modificateur, 2 entité, 3 leadership
}
```

## tech (`tech/trunk.json`, `tech/branches/<bloc>.json`)

```jsonc
{ "id": "energy-nuclear-4", "name": "tech.energy-nuclear-4", "domain": "energy", "tier": 1, "cost": 120, "monthsMin": 18,
  "requires": ["energy-nuclear-3"], "effects": [ { "target": "production.electricity", "op": "mul", "value": 1.1 } ] }
```

## scenario (`scenarios/<slug>.json`)

```jsonc
{
  "id": "world-2026", "map": "world", "startDate": "2026-01-01",
  "nations": ["FRA", "DEU", "..."],           // sous-ensemble pour europe-10
  "borders": { "source": "natural-earth-de-facto", "rasterized": "borders/world-2026.bin" },
  "contested": [ { "region": "crimea", "controller": "RUS", "claimants": ["UKR"], "recognizedBy": [] } ],
  "wars": [ { "id": "...", "belligerents": [["A"], ["B"]], "since": "2022-02-24", "intensity": 0.8, "fronts": [] } ],
  "playerDefault": "FRA"
}
```

## save (fichier de sauvegarde)

```jsonc
{ "schemaVersion": 1, "seed": 42, "rngState": "...", "calendar": { "date": "2029-04-12", "speed": 1 },
  "nations": [], "blocs": [], "world": {}, "tilesRef": "tiles.bin", "journal": [], "metrics": {} }
```

Migrations : `migrations/v1-to-v2.ts` exporte `(save: SaveV1) => SaveV2`. Le chargeur applique la chaîne jusqu'à la version courante.
