import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  loadOwidEnergy,
  loadWorldBank,
  OWID_ENERGY_COMMIT,
  readLock,
  REPO_ROOT,
  WORLD,
  WORLD_BANK_INDICATORS,
  WorldBankKey,
} from "./sources";

// Snapshots -> data/veritable/: the ten nation sheets, row.json (rest of the
// world) and the dollar value of an index point for the goods measured as an
// index. Every figure carries `source` and `asOf`; anything that has no open
// source comes from estimates.json and is marked `source: "estimate"`.

interface Sourced {
  value: number;
  source: string;
  asOf: string;
  note?: string;
}

const DATA = path.join(REPO_ROOT, "data/veritable");
const HERE = path.dirname(fileURLToPath(import.meta.url));

const ENERGY = {
  oil: ["oil_production", "oil_consumption"],
  gas: ["gas_production", "gas_consumption"],
  coal: ["coal_production", "coal_consumption"],
  electricity: ["electricity_generation", "electricity_demand"],
} as const;
const FOSSIL_ELECTRICITY = {
  gas: "gas_electricity",
  coal: "coal_electricity",
  oil: "oil_electricity",
} as const;

// The World Bank world aggregate of cereal production is partial for the most
// recent year (1 644 Mt in 2024 against 3 124 Mt in 2023): every cereal figure
// is read at the last complete year.
const CEREALS_LAST_COMPLETE_YEAR = 2023;

const round = (v: number, digits = 4) => Number(v.toPrecision(digits + 2));

export function build(scenarioId: string): void {
  const scenario = JSON.parse(
    fs.readFileSync(path.join(DATA, "scenarios", `${scenarioId}.json`), "utf8"),
  );
  const nations: string[] = scenario.nations;
  const estimates = JSON.parse(
    fs.readFileSync(path.join(HERE, "estimates.json"), "utf8"),
  );
  const lock = readLock();
  const wb = Object.fromEntries(
    (Object.keys(WORLD_BANK_INDICATORS) as WorldBankKey[]).map((k) => [
      k,
      loadWorldBank(k, lock),
    ]),
  ) as Record<WorldBankKey, ReturnType<typeof loadWorldBank>>;
  const owid = loadOwidEnergy(lock);

  const wbValue = (key: WorldBankKey, iso3: string, scale = 1): Sourced => {
    const v = wb[key].latest(
      iso3,
      key === "cereals" ? CEREALS_LAST_COMPLETE_YEAR : undefined,
    );
    if (v === null) throw new Error(`World Bank ${key}: no value for ${iso3}`);
    return {
      value: round(v.value * scale),
      source: `worldbank:${WORLD_BANK_INDICATORS[key]}`,
      asOf: String(v.year),
    };
  };
  const owidValue = (iso3: string, column: string): Sourced => {
    const v = owid.latest(iso3, column);
    return v === null
      ? {
          value: 0,
          source: `owid-energy@${OWID_ENERGY_COMMIT.slice(0, 8)}:${column}`,
          asOf: "n/a",
          note: "Série absente de la source : production nulle ou négligeable.",
        }
      : {
          value: round(v.value),
          source: `owid-energy@${OWID_ENERGY_COMMIT.slice(0, 8)}:${column}`,
          asOf: String(v.year),
        };
  };
  const estimate = (value: number, justification: string): Sourced => ({
    value,
    source: "estimate",
    asOf: estimates.asOf,
    note: justification,
  });
  const derived = (value: number, method: string, asOf: string): Sourced => ({
    value: round(value),
    source: "derived",
    asOf,
    note: method,
  });

  const gdp = Object.fromEntries(nations.map((n) => [n, wbValue("gdp", n)]));
  const worldGdp = wbValue("gdp", WORLD);
  const gdpYear = worldGdp.asOf;

  // --- goods measured as an index: 100 = production of the scenario ---------
  // Production shares come from a World Bank proxy, consumption from the share
  // of world GDP (or of world military spending, for arms).
  const militaryUsd = (iso3: string) =>
    (wb.military.latest(iso3)!.value / 100) * wb.gdp.latest(iso3)!.value;
  const proxies: Record<
    string,
    { key: WorldBankKey | "militaryUsd"; label: string }
  > = {
    steel: { key: "manufacturing", label: "valeur ajoutée manufacturière" },
    "consumer-goods": {
      key: "manufacturing",
      label: "valeur ajoutée manufacturière",
    },
    pharma: { key: "manufacturing", label: "valeur ajoutée manufacturière" },
    electronics: {
      key: "highTechExports",
      label: "exportations de haute technologie",
    },
    services: { key: "services", label: "valeur ajoutée des services" },
    arms: { key: "militaryUsd", label: "dépenses militaires en dollars" },
  };
  const proxyValue = (good: string, iso3: string): number =>
    proxies[good].key === "militaryUsd"
      ? militaryUsd(iso3)
      : wb[proxies[good].key as WorldBankKey].latest(iso3)!.value;

  const indexGoods: Record<
    string,
    {
      production: Record<string, Sourced>;
      consumption: Record<string, Sourced>;
      world: number;
    }
  > = {};
  for (const good of Object.keys(proxies)) {
    const total = nations.reduce((s, n) => s + proxyValue(good, n), 0);
    const world = (100 * proxyValue(good, WORLD)) / total;
    const consumptionBase =
      good === "arms"
        ? (n: string) => militaryUsd(n) / militaryUsd(WORLD)
        : (n: string) => gdp[n].value / worldGdp.value;
    indexGoods[good] = {
      world,
      production: Object.fromEntries(
        nations.map((n) => [
          n,
          derived(
            (100 * proxyValue(good, n)) / total,
            `Indice 100 = production des dix nations ; part d'après ${proxies[good].label} (Banque mondiale).`,
            gdpYear,
          ),
        ]),
      ),
      consumption: Object.fromEntries(
        nations.map((n) => [
          n,
          derived(
            world * consumptionBase(n),
            good === "arms"
              ? "Indice mondial × part des dépenses militaires mondiales (Banque mondiale)."
              : "Indice mondial × part du PIB mondial (Banque mondiale).",
            gdpYear,
          ),
        ]),
      ),
    };
  }
  const minerals = estimates.criticalMinerals;
  indexGoods["critical-minerals"] = {
    world: minerals.worldIndex,
    production: Object.fromEntries(
      nations.map((n) => [
        n,
        estimate(minerals.shares[n] ?? 0, minerals.justification),
      ]),
    ),
    consumption: Object.fromEntries(
      nations.map((n) => [
        n,
        derived(
          (minerals.worldIndex * gdp[n].value) / worldGdp.value,
          "Indice mondial (estimation) × part du PIB mondial (Banque mondiale).",
          gdpYear,
        ),
      ]),
    ),
  };

  // --- food: cereals, Mt per year ---------------------------------------------
  const worldCereals = wb.cereals.latest(WORLD, CEREALS_LAST_COMPLETE_YEAR)!;
  const worldPopulation = wb.population.latest(WORLD)!;
  const foodPerHead = worldCereals.value / 1e6 / worldPopulation.value;

  // --- rest of the world -------------------------------------------------------
  const row: Record<string, { production: Sourced; consumption: Sourced }> = {};
  const sumOf = (pick: (n: string) => number) =>
    nations.reduce((s, n) => s + pick(n), 0);

  const sheets: Record<string, Record<string, unknown>> = {};
  for (const n of nations) {
    const goods: Record<string, { production: Sourced; consumption: Sourced }> =
      {};
    for (const [good, [production, consumption]] of Object.entries(ENERGY)) {
      goods[good] = {
        production: owidValue(n, production),
        consumption: owidValue(n, consumption),
      };
    }
    goods.food = {
      production: wbValue("cereals", n, 1e-6),
      consumption: estimate(
        round(foodPerHead * wb.population.latest(n)!.value),
        "Consommation apparente : population × production mondiale de céréales par habitant (Banque mondiale). Aucune série ouverte de consommation homogène.",
      ),
    };
    for (const [good, data] of Object.entries(indexGoods)) {
      goods[good] = {
        production: data.production[n],
        consumption: data.consumption[n],
      };
    }

    // Budget, as shares of GDP.
    const revenue = wbValue("revenue", n, 0.01);
    const expense = wbValue("expense", n, 0.01);
    const defense = wbValue("military", n, 0.01);
    const health = wbValue("health", n, 0.01);
    const education = wbValue("education", n, 0.01);
    const research = wbValue("research", n, 0.01);
    const split = estimates.spendingSplit;
    const publicResearch = research.value * split.publicShareOfResearch;
    const known =
      defense.value + health.value + education.value + publicResearch;
    const residual = Math.max(0.02, expense.value - known);
    const spending = {
      defense: {
        ...defense,
        note: "Source primaire SIPRI, republiée par la Banque mondiale.",
      },
      healthEducation: derived(
        health.value + education.value,
        "Dépenses publiques de santé + d'éducation (Banque mondiale SH.XPD.GHED.GD.ZS + SE.XPD.TOTL.GD.ZS).",
        health.asOf,
      ),
      research: estimate(round(publicResearch), split.justification),
      social: estimate(
        round(residual * split.residual.social),
        split.justification,
      ),
      infrastructure: estimate(
        round(residual * split.residual.infrastructure),
        split.justification,
      ),
      subsidies: estimate(
        round(residual * split.residual.subsidies),
        split.justification,
      ),
    };

    const taxSplit = estimates.taxSplit;
    const rents = taxSplit.rentsShare[n] ?? taxSplit.default.rents;
    const others = 1 - rents;
    const base = 1 - taxSplit.default.rents;
    const share = (k: "income" | "corporate" | "vat" | "tariffs") =>
      (taxSplit.default[k] / base) * others;
    const revenueShares = {
      income: share("income"),
      corporate: share("corporate"),
      vat: share("vat"),
      tariffs: share("tariffs"),
      rents,
    };

    const growth = wb.growth.mean(n, 2015, 2024)!;
    const growthBase = Math.min(4, Math.max(1, growth));
    const existing = JSON.parse(
      fs.readFileSync(
        path.join(DATA, "nations", `${n.toLowerCase()}.json`),
        "utf8",
      ),
    );
    const nuclear = estimates.nuclear.values[n];
    sheets[n] = {
      id: existing.id,
      name: existing.name,
      capital: existing.capital,
      regime: existing.regime,
      regimeSource: existing.regimeSource,
      blocs: existing.blocs,
      nuclear:
        nuclear === undefined
          ? null
          : {
              ...nuclear,
              source: "estimate",
              asOf: estimates.asOf,
              note: estimates.nuclear.justification,
            },
      territory: existing.territory,
      contested: existing.contested,
      population: wbValue("population", n),
      gdp: gdp[n],
      debtToGdp: estimate(
        estimates.debtToGdp.values[n],
        estimates.debtToGdp.justification,
      ),
      economy: {
        growthBase: {
          value: round(growthBase / 100),
          source: `worldbank:${WORLD_BANK_INDICATORS.growth}`,
          asOf: "2015-2024",
          note:
            `Moyenne 2015-2024 de la croissance réelle (${growth.toFixed(2)} %/an)` +
            (growthBase !== growth
              ? ", bornée à [1 %, 4 %] : la moyenne brute est déformée par la guerre ou la pandémie."
              : "."),
        },
        goods,
        electricityFromFossil: Object.fromEntries(
          Object.entries(FOSSIL_ELECTRICITY).map(([fuel, column]) => [
            fuel,
            owidValue(n, column),
          ]),
        ),
        budget: {
          revenuePctGdp: revenue,
          expensePctGdp: expense,
          grantsPctGdp: estimate(
            estimates.grantsPctGdp.values[n] ?? 0,
            estimates.grantsPctGdp.justification,
          ),
          revenueShares: {
            value: Object.fromEntries(
              Object.entries(revenueShares).map(([k, v]) => [k, round(v)]),
            ),
            source: "estimate",
            asOf: estimates.asOf,
            note: taxSplit.justification,
          },
          spending,
        },
      },
      military: {
        spendingPctGdp: round(defense.value * 100),
        ...estimates.military.values[n],
        source: "estimate",
        asOf: estimates.asOf,
        note:
          estimates.military.justification +
          " spendingPctGdp : Banque mondiale MS.MIL.XPND.GD.ZS (source primaire SIPRI).",
      },
      startingTech: [],
    };
  }

  const owidSource = `owid-energy@${OWID_ENERGY_COMMIT.slice(0, 8)}`;
  const close = (
    good: string,
    worldProduction: number,
    asOf: string,
    source: string,
  ) => {
    const tenProduction = sumOf(
      (n) => (sheets[n].economy as any).goods[good].production.value,
    );
    const tenConsumption = sumOf(
      (n) => (sheets[n].economy as any).goods[good].consumption.value,
    );
    row[good] = {
      production: derived(
        Math.max(0, worldProduction - tenProduction),
        `Production mondiale (${source}) moins celle des dix nations.`,
        asOf,
      ),
      // The rest of the world closes the balance: world consumption is taken
      // equal to world production, so statistical differences between the
      // production and consumption series land here and not in the price.
      consumption: derived(
        Math.max(0, worldProduction - tenConsumption),
        `Production mondiale (${source}) moins la consommation des dix nations : le reste du monde ferme le bilan, écarts statistiques compris.`,
        asOf,
      ),
    };
  };
  for (const [good, [production]] of Object.entries(ENERGY)) {
    const world = owid.latest(WORLD, production)!;
    close(good, world.value, String(world.year), `${owidSource}:${production}`);
  }
  close(
    "food",
    worldCereals.value / 1e6,
    String(worldCereals.year),
    `worldbank:${WORLD_BANK_INDICATORS.cereals}`,
  );
  for (const [good, data] of Object.entries(indexGoods)) {
    close(
      good,
      data.world,
      gdpYear,
      good === "critical-minerals" ? "estimate" : "derived",
    );
  }

  // --- dollar value of an index point ------------------------------------------
  const manufacturing = sumOf((n) => wb.manufacturing.latest(n)!.value) / 1e6;
  const msplit = estimates.manufacturingSplit;
  const pointValue: Record<string, { value: number; note: string }> = {
    services: {
      value: sumOf((n) => wb.services.latest(n)!.value) / 1e6 / 100,
      note: "Valeur ajoutée des services des dix nations (Banque mondiale) / 100.",
    },
    arms: {
      value:
        ((sumOf(militaryUsd) / 1e6) * msplit.armsShareOfMilitarySpending) / 100,
      note: `Dépenses militaires des dix (Banque mondiale) × ${msplit.armsShareOfMilitarySpending} (part d'équipement, estimation) / 100.`,
    },
    "critical-minerals": {
      value: minerals.scenarioValueMusd / 100,
      note: minerals.justification,
    },
  };
  for (const [good, share] of Object.entries(
    msplit.shareOfManufacturingValueAdded as Record<string, number>,
  )) {
    pointValue[good] = {
      value: (manufacturing * share) / 100,
      note: `Valeur ajoutée manufacturière des dix (Banque mondiale) × ${share} (part du bien, estimation) / 100.`,
    };
  }

  // --- write ---------------------------------------------------------------------
  const write = (file: string, data: unknown) =>
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  for (const n of nations) {
    write(path.join(DATA, "nations", `${n.toLowerCase()}.json`), sheets[n]);
  }
  write(path.join(DATA, "row.json"), {
    id: "ROW",
    name: "nation.row.name",
    scenario: scenarioId,
    note: "Reste du monde : hors carte, jamais jouable, sans politique. Totaux mondiaux moins les dix nations.",
    goods: row,
  });
  const goodsFile = path.join(DATA, "goods/goods.json");
  const goods = JSON.parse(fs.readFileSync(goodsFile, "utf8"));
  for (const good of goods) {
    const point = pointValue[good.id];
    if (point === undefined) continue;
    good.basePrice = round(point.value);
    good.unit = "indice (M$ par point)";
    good.basePriceSource = {
      source: "derived",
      asOf: gdpYear,
      note: point.note,
    };
  }
  write(goodsFile, goods);
  console.log(
    `built ${nations.length} nation sheets, row.json and goods prices`,
  );
}
