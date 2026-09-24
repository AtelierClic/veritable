import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  IMF_DEBT_INDICATOR,
  loadImfDebt,
  loadOwidEnergy,
  OWID_ENERGY_COMMIT,
  readLock,
  REPO_ROOT,
  WORLD,
  WORLD_BANK_INDICATORS,
} from "./sources";
import {
  AnyWorldBankKey,
  indicatorOf,
  loadCapitals,
  loadImfWorld,
  loadVdem,
  loadWorldSeries,
  WORLD_EXTRA_INDICATORS,
} from "./world";

// Snapshots -> data/veritable/: the nation sheets of a scenario, row.json
// (its rest of the world, when it has one) and the goods. Every figure
// carries `source` and `asOf`; anything that has no open source comes from
// estimates.json and is marked `source: "estimate"`.
//
// J6: the sheets no longer depend on the scenario that builds them (goods
// once measured as an index are measured in value, 1 unit = 1 bn US$), so a
// nation built by europe-10 and by world-2026 gets the same sheet. The ten
// nations of europe-10 keep the estimates written by hand for them; every
// other nation takes the rules of estimates.json -> worldRules where an open
// figure is missing, and its identity (name, capital, regime, politics)
// comes from Natural Earth, V-Dem and politics-world.json.

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
// Year of the IMF figures: the last year before the campaign starts.
const DEBT_YEAR = 2025;
// The ten nations of europe-10, whose hand-written estimates predate the J6.
const EUROPE_10 = [
  "FRA",
  "DEU",
  "GBR",
  "ITA",
  "ESP",
  "POL",
  "UKR",
  "RUS",
  "TUR",
  "NOR",
];

const round = (v: number, digits = 4) => Number(v.toPrecision(digits + 2));

// Identity of a nation that has no sheet yet (J6).
interface WorldPolitics {
  regime: string;
  vdemRow: string;
  regimeNote: string;
  lastElection: string | null;
  lastElectionKind: string;
  electionIntervalMonths: number | null;
  electionsSuspendedAtWarAtHome: boolean;
  election: string;
  electionSource: string;
}

const DEMOCRATIC = ["parliamentary", "presidential", "semi-presidential"];
const AUTOCRATIC_FORMS = [
  "junta",
  "failed-state",
  "theocracy",
  "single-party",
  "absolute-monarchy",
];

// The archetype of a nation from V-Dem's Regimes of the World (its last
// year) and the constitutional form of politics-world.json: a democracy by
// V-Dem keeps its form; an electoral autocracy is electoral-authoritarian
// unless the form says junta, failed state, theocracy, single party or
// absolute monarchy; a closed autocracy keeps the autocratic form given.
function regimeOf(
  form: string,
  row: number | undefined,
): { regime: string; rule: string } {
  if (row === undefined)
    return {
      regime: form,
      rule: "forme seule (V-Dem ne couvre pas cette nation)",
    };
  if (row >= 2) {
    return DEMOCRATIC.includes(form)
      ? { regime: form, rule: "démocratie (V-Dem), forme constitutionnelle" }
      : {
          regime: "presidential",
          rule: `démocratie selon V-Dem, forme « ${form} » ramenée à présidentielle (à valider)`,
        };
  }
  if (row === 1) {
    return AUTOCRATIC_FORMS.includes(form)
      ? {
          regime: form,
          rule: "autocratie électorale (V-Dem), forme particulière",
        }
      : {
          regime: "electoral-authoritarian",
          rule: "autocratie électorale (V-Dem)",
        };
  }
  return DEMOCRATIC.includes(form)
    ? {
        regime: "electoral-authoritarian",
        rule: "autocratie fermée selon V-Dem, forme démocratique écartée (à valider)",
      }
    : { regime: form, rule: "autocratie fermée (V-Dem), forme donnée" };
}

function addMonthsIso(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function build(scenarioId: string): void {
  const scenario = JSON.parse(
    fs.readFileSync(path.join(DATA, "scenarios", `${scenarioId}.json`), "utf8"),
  );
  const nations: string[] = scenario.nations;
  const withRow = scenario.restOfWorld !== false;
  const estimates = JSON.parse(
    fs.readFileSync(path.join(HERE, "estimates.json"), "utf8"),
  );
  const rules = estimates.worldRules;
  const lock = readLock();
  const keys = [
    ...Object.keys(WORLD_BANK_INDICATORS),
    ...Object.keys(WORLD_EXTRA_INDICATORS),
  ] as AnyWorldBankKey[];
  const wb = Object.fromEntries(
    keys.map((k) => [k, loadWorldSeries(k, lock)]),
  ) as Record<AnyWorldBankKey, ReturnType<typeof loadWorldSeries>>;
  const owid = loadOwidEnergy(lock);
  const imf = loadImfDebt(lock);
  const imfWorld = loadImfWorld(lock);
  const vdem = loadVdem(lock);
  const capitals = loadCapitals(lock);
  const politicsWorld = JSON.parse(
    fs.readFileSync(path.join(HERE, "politics-world.json"), "utf8"),
  ).nations as Record<string, WorldPolitics>;
  const blocs = fs
    .readdirSync(path.join(DATA, "blocs"))
    .filter((f) => f.endsWith(".json"))
    .map((f) =>
      JSON.parse(fs.readFileSync(path.join(DATA, "blocs", f), "utf8")),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const countryNames = new Map<string, string>();
  for (const f of JSON.parse(
    fs.readFileSync(
      path.join(
        REPO_ROOT,
        "tools/veritable/borders/cache/ne_10m_admin_0_countries.geojson",
      ),
      "utf8",
    ),
  ).features as { properties: Record<string, string> }[]) {
    const p = f.properties;
    const iso = p.ISO_A3 !== "-99" ? p.ISO_A3 : p.ADM0_A3;
    if (p.NAME_FR) countryNames.set(iso, p.NAME_FR);
  }
  const i18nFile = path.join(DATA, "i18n/fr.json");
  const i18n = JSON.parse(fs.readFileSync(i18nFile, "utf8")) as Record<
    string,
    string
  >;

  const estimate = (value: number, justification: string): Sourced => ({
    value,
    source: "estimate",
    asOf: estimates.asOf,
    note: justification,
  });
  const ruled = (value: number, note: string): Sourced => ({
    value: round(value),
    source: "estimate",
    asOf: rules.asOf,
    note,
  });
  const derived = (value: number, method: string, asOf: string): Sourced => ({
    value: round(value),
    source: "derived",
    asOf,
    note: method,
  });
  const wbSourced = (
    key: AnyWorldBankKey,
    iso3: string,
    scale = 1,
  ): Sourced | null => {
    const v = wb[key].latest(
      iso3,
      key === "cereals" ? CEREALS_LAST_COMPLETE_YEAR : undefined,
    );
    if (v === null) return null;
    return {
      value: round(v.value * scale),
      source: `worldbank:${indicatorOf(key)}`,
      asOf: String(v.year),
    };
  };
  const imfSourced = (
    indicator: "NGDPD" | "GGR_G01_GDP_PT" | "G_X_G01_GDP_PT",
    iso3: string,
    scale: number,
  ): Sourced | null => {
    const v = imfWorld.at(indicator, iso3, DEBT_YEAR);
    if (v === null) return null;
    return {
      value: round(v.value * scale),
      source: `imf-weo:${indicator}`,
      asOf: String(v.year),
      note: `FMI, Perspectives de l'économie mondiale / Moniteur des finances publiques (API DataMapper, extraction du ${imfWorld.fetchedAt}), à défaut de la Banque mondiale.`,
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

  // --- population, GDP, military spending, with their fallbacks -----------------
  const population = (n: string): Sourced =>
    wbSourced("population", n) ??
    ruled(rules.population.values[n] ?? 1e5, rules.population.note);
  const gdp = Object.fromEntries(
    nations.map((n) => [
      n,
      wbSourced("gdp", n) ??
        imfSourced("NGDPD", n, 1e9) ??
        ruled(rules.gdpUsd.values[n] ?? 1e9, rules.gdpUsd.note),
    ]),
  ) as Record<string, Sourced>;
  const worldGdp = wbSourced("gdp", WORLD)!;
  const gdpYear = worldGdp.asOf;
  const noArmy = new Set<string>(rules.noArmy.values);
  const militaryShare = (n: string): Sourced => {
    const v = wbSourced("military", n, 0.01);
    if (v !== null)
      return {
        ...v,
        note: "Source primaire SIPRI, republiée par la Banque mondiale.",
      };
    if (noArmy.has(n)) return ruled(0, rules.noArmy.note);
    return ruled(
      rules.militaryPctGdp.values[n] ?? 0.01,
      rules.militaryPctGdp.note,
    );
  };
  const militaryUsd = (n: string) =>
    n === WORLD
      ? (wb.military.latest(WORLD)!.value / 100) * wb.gdp.latest(WORLD)!.value
      : militaryShare(n).value * gdp[n].value;

  // --- goods measured in value: 1 unit = 1 bn US$ of output (J6) -------------
  // Before the J6 these goods were an index (100 = production of the nations
  // of the scenario), which made the sheets depend on the scenario. The value
  // of a nation's production comes from a World Bank proxy; its consumption
  // is the world value times its share of world GDP (of world military
  // spending, for arms).
  const BN = 1e9;
  const msplit = estimates.manufacturingSplit;
  const shares = msplit.shareOfManufacturingValueAdded as Record<
    string,
    number
  >;
  const manufacturing = (n: string) =>
    wb.manufacturing.latest(n)?.value ??
    gdp[n].value * rules.manufacturingShareOfGdp;
  const services = (n: string) =>
    wb.services.latest(n)?.value ?? gdp[n].value * rules.servicesShareOfGdp;
  const highTech = (n: string) => wb.highTechExports.latest(n)?.value ?? 0;
  const worldManufacturing = wb.manufacturing.latest(WORLD)!.value;
  // Electronics: high-technology exports, scaled so that the world total is
  // the electronics share of world manufacturing.
  const electronicsPerHighTechDollar =
    (worldManufacturing * shares.electronics) /
    wb.highTechExports.latest(WORLD)!.value;
  const proxyNote = (n: string, key: "manufacturing" | "services") =>
    wb[key].latest(n) === null
      ? ` (valeur ajoutée absente : ${key === "manufacturing" ? rules.manufacturingShareOfGdp : rules.servicesShareOfGdp} du PIB, estimation)`
      : "";
  const valueGoods: Record<
    string,
    {
      label: (n: string) => string;
      value: (iso3: string) => number;
      world: number;
    }
  > = {
    steel: {
      label: (n) =>
        `valeur ajoutée manufacturière × ${shares.steel}${proxyNote(n, "manufacturing")}`,
      value: (n) => (manufacturing(n) * shares.steel) / BN,
      world: (worldManufacturing * shares.steel) / BN,
    },
    "consumer-goods": {
      label: (n) =>
        `valeur ajoutée manufacturière × ${shares["consumer-goods"]}${proxyNote(n, "manufacturing")}`,
      value: (n) => (manufacturing(n) * shares["consumer-goods"]) / BN,
      world: (worldManufacturing * shares["consumer-goods"]) / BN,
    },
    pharma: {
      label: (n) =>
        `valeur ajoutée manufacturière × ${shares.pharma}${proxyNote(n, "manufacturing")}`,
      value: (n) => (manufacturing(n) * shares.pharma) / BN,
      world: (worldManufacturing * shares.pharma) / BN,
    },
    electronics: {
      label: () =>
        `exportations de haute technologie × ${round(electronicsPerHighTechDollar, 3)} (part électronique de la valeur ajoutée manufacturière mondiale)`,
      value: (n) => (highTech(n) * electronicsPerHighTechDollar) / BN,
      world: (worldManufacturing * shares.electronics) / BN,
    },
    services: {
      label: (n) => `valeur ajoutée des services${proxyNote(n, "services")}`,
      value: (n) => services(n) / BN,
      world: wb.services.latest(WORLD)!.value / BN,
    },
    arms: {
      label: () =>
        `dépenses militaires × ${msplit.armsShareOfMilitarySpending} (part d'équipement)`,
      value: (n) => (militaryUsd(n) * msplit.armsShareOfMilitarySpending) / BN,
      world: (militaryUsd(WORLD) * msplit.armsShareOfMilitarySpending) / BN,
    },
  };

  const indexGoods: Record<
    string,
    {
      production: Record<string, Sourced>;
      consumption: Record<string, Sourced>;
      world: number;
    }
  > = {};
  for (const [good, spec] of Object.entries(valueGoods)) {
    const consumptionBase =
      good === "arms"
        ? (n: string) => militaryUsd(n) / militaryUsd(WORLD)
        : (n: string) => gdp[n].value / worldGdp.value;
    indexGoods[good] = {
      world: spec.world,
      production: Object.fromEntries(
        nations.map((n) => [
          n,
          derived(
            spec.value(n),
            `Md$ de production, d'après ${spec.label(n)} (Banque mondiale).`,
            gdpYear,
          ),
        ]),
      ),
      consumption: Object.fromEntries(
        nations.map((n) => [
          n,
          derived(
            spec.world * consumptionBase(n),
            good === "arms"
              ? "Valeur mondiale × part des dépenses militaires mondiales (Banque mondiale), Md$."
              : "Valeur mondiale × part du PIB mondial (Banque mondiale), Md$.",
            gdpYear,
          ),
        ]),
      ),
    };
  }
  // Critical minerals: no open series. The nations with a share written by
  // hand (europe-10) keep it; the rest of the world value is shared out in
  // proportion to the exports of ores and metals (World Bank).
  const minerals = estimates.criticalMinerals;
  const mineralPoint = minerals.scenarioValueMusd / 100 / 1000; // bn$
  const mineralsWorld = minerals.worldIndex * mineralPoint;
  const handMinerals = Object.keys(minerals.shares);
  const oresUsd = (n: string) => {
    const share = wb.oresExports.latest(n)?.value ?? 0;
    const exports = wb.merchandiseExports.latest(n)?.value ?? 0;
    return (share / 100) * exports;
  };
  const handTotal = handMinerals.reduce(
    (s: number, n: string) => s + minerals.shares[n] * mineralPoint,
    0,
  );
  const outsideHand = nations.filter((n) => !handMinerals.includes(n));
  const oresTotal = outsideHand.reduce((s, n) => s + oresUsd(n), 0);
  indexGoods["critical-minerals"] = {
    world: mineralsWorld,
    production: Object.fromEntries(
      nations.map((n) => [
        n,
        handMinerals.includes(n)
          ? estimate(
              round(minerals.shares[n] * mineralPoint),
              minerals.justification,
            )
          : ruled(
              oresTotal > 0
                ? ((mineralsWorld - handTotal) * oresUsd(n)) / oresTotal
                : 0,
              "Part de la valeur mondiale des minerais critiques (hors nations estimées à la main) au prorata des exportations de minerais et métaux (Banque mondiale TX.VAL.MMTL.ZS.UN × TX.VAL.MRCH.CD.WT), Md$.",
            ),
      ]),
    ),
    consumption: Object.fromEntries(
      nations.map((n) => [
        n,
        derived(
          (mineralsWorld * gdp[n].value) / worldGdp.value,
          "Valeur mondiale (estimation) × part du PIB mondial (Banque mondiale), Md$.",
          gdpYear,
        ),
      ]),
    ),
  };

  // --- food: cereals, Mt per year ---------------------------------------------
  const worldCereals = wb.cereals.latest(WORLD, CEREALS_LAST_COMPLETE_YEAR)!;
  const worldPopulation = wb.population.latest(WORLD)!;
  const foodPerHead = worldCereals.value / 1e6 / worldPopulation.value;

  // --- ranks used by the AI agenda rule ------------------------------------------
  const top20 = new Set([
    ...[...nations].sort((x, y) => gdp[y].value - gdp[x].value).slice(0, 20),
    ...[...nations]
      .sort((x, y) => militaryUsd(y) - militaryUsd(x))
      .slice(0, 20),
  ]);

  const row: Record<string, { production: Sourced; consumption: Sourced }> = {};
  const sumOf = (pick: (n: string) => number) =>
    nations.reduce((s, n) => s + pick(n), 0);

  const sheets: Record<string, Record<string, unknown>> = {};
  const newNames: Record<string, string> = {};
  for (const n of nations) {
    const lower = n.toLowerCase();
    const sheetFile = path.join(DATA, "nations", `${lower}.json`);
    const existing = fs.existsSync(sheetFile)
      ? JSON.parse(fs.readFileSync(sheetFile, "utf8"))
      : null;
    const pop = population(n);

    const goods: Record<string, { production: Sourced; consumption: Sourced }> =
      {};
    for (const [good, [production, consumption]] of Object.entries(ENERGY)) {
      goods[good] = {
        production: owidValue(n, production),
        consumption: owidValue(n, consumption),
      };
    }
    goods.food = {
      production:
        wbSourced("cereals", n, 1e-6) ??
        ruled(
          0,
          "Production de céréales absente de la Banque mondiale : nulle ou négligeable.",
        ),
      consumption: estimate(
        round(foodPerHead * pop.value),
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
    const revenue =
      wbSourced("revenue", n, 0.01) ??
      imfSourced("GGR_G01_GDP_PT", n, 0.01) ??
      ruled(
        rules.revenuePctGdp,
        "Recettes absentes de la Banque mondiale et du FMI : ordre de grandeur mondial.",
      );
    const expense =
      wbSourced("expense", n, 0.01) ??
      imfSourced("G_X_G01_GDP_PT", n, 0.01) ??
      ruled(
        rules.expensePctGdp,
        "Dépenses absentes de la Banque mondiale et du FMI : ordre de grandeur mondial.",
      );
    const defense = militaryShare(n);
    const health =
      wbSourced("health", n, 0.01) ??
      ruled(
        rules.healthPctGdp,
        "Dépense publique de santé absente : médiane mondiale.",
      );
    const education =
      wbSourced("education", n, 0.01) ??
      ruled(
        rules.educationPctGdp,
        "Dépense publique d'éducation absente : médiane mondiale.",
      );
    const research =
      wbSourced("research", n, 0.01) ??
      ruled(
        rules.researchPctGdp,
        "Dépense de R&D absente : ordre de grandeur des pays sans système de recherche notable.",
      );
    const split = estimates.spendingSplit;
    const publicResearch = research.value * split.publicShareOfResearch;
    const known =
      defense.value + health.value + education.value + publicResearch;
    const residual = Math.max(0.02, expense.value - known);
    const spending = {
      defense,
      healthEducation: derived(
        health.value + education.value,
        "Dépenses publiques de santé + d'éducation (Banque mondiale SH.XPD.GHED.GD.ZS + SE.XPD.TOTL.GD.ZS, estimations à défaut).",
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
    const europe = EUROPE_10.includes(n);
    const rentsPct = europe ? 0 : (wb.rents.latest(n)?.value ?? 0);
    const rents =
      taxSplit.rentsShare[n] ??
      (rentsPct > 0 && revenue.value > 0
        ? Math.min(
            rules.rents.cap,
            (rules.rents.factor * rentsPct) / 100 / revenue.value,
          )
        : taxSplit.default.rents);
    const nonRents = 1 - rents;
    const base = 1 - taxSplit.default.rents;
    const share = (k: "income" | "corporate" | "vat" | "tariffs") =>
      (taxSplit.default[k] / base) * nonRents;
    const revenueShares = {
      income: share("income"),
      corporate: share("corporate"),
      vat: share("vat"),
      tariffs: share("tariffs"),
      rents,
    };

    const growth = wb.growth.mean(n, 2015, 2024);
    const growthBase =
      growth === null
        ? rules.growthDefault * 100
        : Math.min(4, Math.max(1, growth));
    const debtToGdp = (): Sourced => {
      const v =
        imf.at(n, DEBT_YEAR) ?? imfWorld.at("GGXWDG_NGDP", n, DEBT_YEAR);
      if (v === null) {
        return estimates.debtToGdp.values[n] !== undefined
          ? estimate(
              estimates.debtToGdp.values[n],
              estimates.debtToGdp.justification,
            )
          : ruled(rules.debtToGdp.values[n] ?? 0.5, rules.debtToGdp.note);
      }
      return {
        value: round(v.value / 100),
        source: `imf-weo:${IMF_DEBT_INDICATOR}`,
        asOf: String(v.year),
        note: `Dette brute des administrations publiques en % du PIB, FMI, Perspectives de l'économie mondiale (API DataMapper) ; la valeur ${v.year} est une estimation du FMI.`,
      };
    };

    // Military: the hand-written values, else the rules.
    const spendBn = militaryUsd(n) / BN;
    const hand = estimates.military.values[n];
    const mr = rules.military;
    const personnelWb = wb.personnel.latest(n)?.value;
    const air = Math.min(
      mr.air.max,
      mr.air.base + mr.air.perLog10Bn * Math.log10(1 + spendBn),
    );
    const military =
      hand !== undefined
        ? {
            ...hand,
            source: "estimate",
            asOf: estimates.asOf,
            note:
              (europe
                ? estimates.military.justification
                : estimates.military.justificationWorld) +
              " spendingPctGdp : Banque mondiale MS.MIL.XPND.GD.ZS (source primaire SIPRI).",
          }
        : {
            activePersonnel: noArmy.has(n)
              ? 0
              : Math.round(
                  personnelWb !== undefined
                    ? personnelWb * mr.personnelShareOfWorldBank
                    : pop.value * mr.personnelPerPopulation,
                ),
            airPower: noArmy.has(n) ? 0 : round(air, 2),
            navalPower:
              noArmy.has(n) || rules.landlocked.values.includes(n)
                ? 0
                : round(
                    rules.smallIslands.values.includes(n)
                      ? air * mr.navalIslandFactor
                      : air,
                    2,
                  ),
            source: "estimate",
            asOf: rules.asOf,
            note: `${mr.note} ${rules.landlocked.note}`,
          };

    // Identity: the existing sheet, else Natural Earth, V-Dem and
    // politics-world.json.
    let identity: Record<string, unknown>;
    let politicsData: Record<string, unknown>;
    if (existing !== null) {
      identity = {
        id: existing.id,
        name: existing.name,
        capital: existing.capital,
        regime: existing.regime,
        regimeSource: existing.regimeSource,
        blocs: existing.blocs,
        territory: existing.territory,
        contested: existing.contested,
      };
      politicsData = existing.politics;
    } else {
      const pw = politicsWorld[n];
      if (pw === undefined) throw new Error(`no politics-world entry for ${n}`);
      const override = rules.capitals.values[n];
      const extra = rules.capitals.extra[n];
      const list = capitals.get(n === "PSE" ? "PSX" : n) ?? [];
      const capital =
        extra ??
        (override !== undefined
          ? list.find((c) => c.name === override)
          : list[0]);
      if (capital === undefined) throw new Error(`no capital for ${n}`);
      const v = vdem.get(n);
      const { regime, rule } = regimeOf(pw.regime, v?.row);
      newNames[`nation.${lower}.name`] = countryNames.get(n) ?? n;
      newNames[`nation.${lower}.capital`] = capital.nameFr ?? capital.name;
      identity = {
        id: n,
        name: `nation.${lower}.name`,
        capital: {
          name: `nation.${lower}.capital`,
          lon: round(capital.lon, 4),
          lat: round(capital.lat, 4),
          source:
            extra !== undefined
              ? "estimate (worldRules.capitals)"
              : "natural-earth v5.1.2, ne_10m_populated_places (Admin-0 capital)",
          asOf: "2026-01-01",
        },
        regime,
        regimeSource: {
          source:
            v === undefined
              ? "manual"
              : `vdem-row:${v.year} (V-Dem v16 par OWID, CC BY-SA 4.0)`,
          asOf: "2026-01-01",
          note: `${rule}. ${pw.regimeNote}`,
        },
        blocs: blocs
          .filter((b) =>
            b.members.some(
              (m: { nation: string; status: string }) =>
                m.nation === n && m.status === "full",
            ),
          )
          .map((b) => b.id),
        territory: { kind: "tiles" },
        contested: [],
      };
      const interval = pw.electionIntervalMonths ?? 60;
      let last = pw.lastElection ?? "2025-01-01";
      let note =
        pw.lastElectionKind === "none"
          ? "Pas d'élection nationale."
          : `${pw.election}.`;
      // An election overdue on the first day (suspended, postponed): the
      // next one comes three months in.
      if (
        pw.lastElection !== null &&
        addMonthsIso(last, interval) < scenario.startDate
      ) {
        last = addMonthsIso(scenario.startDate, 3 - interval);
        note += ` Élection en retard au 1er janvier 2026 (dernière le ${pw.lastElection}) : la suivante est placée trois mois plus tard (estimation).`;
      }
      politicsData = {
        electionIntervalMonths: interval,
        lastElection: last,
        electionsSuspendedAtWarAtHome: pw.electionsSuspendedAtWarAtHome,
        source: "estimate (politics-world.json)",
        asOf: "2026-01-01",
        note,
      };
    }

    const nuclear = estimates.nuclear.values[n];
    const regime = identity.regime as string;
    const democratic = DEMOCRATIC.includes(regime);
    const a = rules.aiAgenda;
    const raw = {
      security:
        0.3 +
        (a.conflictNations.includes(n) ? 0.2 : 0) +
        (democratic ? 0 : 0.1),
      growth: 0.35 + (democratic ? 0.1 : 0),
      "regional-influence": 0.2 + (top20.has(n) ? 0.15 : 0),
      ideology:
        0.15 + (["theocracy", "single-party"].includes(regime) ? 0.2 : 0),
    };
    const rawTotal = Object.values(raw).reduce((s, w) => s + w, 0);
    const handAgenda = estimates.aiAgenda?.values[n];
    sheets[n] = {
      ...identity,
      nuclear:
        nuclear === undefined
          ? null
          : {
              ...nuclear,
              source: "estimate",
              asOf: estimates.asOf,
              note: estimates.nuclear.justification,
            },
      population: pop,
      gdp: gdp[n],
      debtToGdp: debtToGdp(),
      economy: {
        tradeOpenness:
          wbSourced("trade", n, 0.01) ??
          ruled(
            rules.tradeOpennessDefault,
            "Ouverture commerciale absente : médiane mondiale.",
          ),
        growthBase: {
          value: round(growthBase / 100),
          source:
            growth === null
              ? "estimate"
              : `worldbank:${WORLD_BANK_INDICATORS.growth}`,
          asOf: growth === null ? rules.asOf : "2015-2024",
          note:
            growth === null
              ? "Croissance absente : 2 %/an (estimation)."
              : `Moyenne 2015-2024 de la croissance réelle (${growth.toFixed(2)} %/an)` +
                (growthBase !== growth
                  ? ", bornée à [1 %, 4 %] : la moyenne brute est déformée par la guerre, la pandémie ou un rattrapage qui ne dure pas cinquante ans."
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
            note:
              taxSplit.rentsShare[n] !== undefined || rentsPct === 0
                ? taxSplit.justification
                : `${taxSplit.justification} ${rules.rents.note}`,
          },
          spending,
        },
      },
      military: {
        spendingPctGdp: round(defense.value * 100),
        ...military,
      },
      startingTech: [],
      politics: politicsData,
      // The agenda of the nation AI (J5), written by hand and justified, or
      // by rules (J6: worldRules.aiAgenda).
      aiAgenda:
        handAgenda ??
        Object.entries(raw).map(([goal, w]) => ({
          goal,
          weight: round(w / rawTotal, 3),
        })),
    };
  }

  // The rest of the world closes the balance of a scenario that does not
  // hold every nation.
  const close = (
    good: string,
    worldProduction: number,
    asOf: string,
    source: string,
  ) => {
    const scenarioProduction = sumOf(
      (n) => (sheets[n].economy as any).goods[good].production.value,
    );
    const scenarioConsumption = sumOf(
      (n) => (sheets[n].economy as any).goods[good].consumption.value,
    );
    row[good] = {
      production: derived(
        Math.max(0, worldProduction - scenarioProduction),
        `Production mondiale (${source}) moins celle des dix nations.`,
        asOf,
      ),
      // World consumption is taken equal to world production, so the
      // statistical differences between the production and consumption
      // series land here and not in the price.
      consumption: derived(
        Math.max(0, worldProduction - scenarioConsumption),
        `Production mondiale (${source}) moins la consommation des dix nations : le reste du monde ferme le bilan, écarts statistiques compris.`,
        asOf,
      ),
    };
  };
  const owidSource = `owid-energy@${OWID_ENERGY_COMMIT.slice(0, 8)}`;
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

  // --- write ---------------------------------------------------------------------
  const write = (file: string, data: unknown) =>
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  for (const n of nations) {
    write(path.join(DATA, "nations", `${n.toLowerCase()}.json`), sheets[n]);
  }
  if (withRow) {
    const scenarioGdp = nations.reduce((s, n) => s + gdp[n].value, 0);
    write(path.join(DATA, "row.json"), {
      id: "ROW",
      gdp: derived(
        worldGdp.value - scenarioGdp,
        "PIB mondial (Banque mondiale) moins celui des dix nations.",
        gdpYear,
      ),
      name: "nation.row.name",
      scenario: scenarioId,
      note: "Reste du monde : hors carte, jamais jouable, sans politique. Totaux mondiaux moins les dix nations.",
      goods: row,
    });
  }
  // Goods measured in value (J6): 1 unit = 1 bn US$, priced 1000 M$.
  const goodsFile = path.join(DATA, "goods/goods.json");
  const goodsData = JSON.parse(fs.readFileSync(goodsFile, "utf8"));
  for (const good of goodsData) {
    if (indexGoods[good.id] === undefined) continue;
    good.basePrice = 1000;
    good.unit = "Md$ (valeur 2024)";
    good.basePriceSource = {
      source: "derived",
      asOf: gdpYear,
      note: "Bien mesuré en valeur : une unité = un milliard de dollars de production au prix de base (J6 ; indice avant le J6).",
    };
  }
  write(goodsFile, goodsData);
  // Names of the new nations and their capitals, in French.
  let added = 0;
  for (const [key, value] of Object.entries(newNames)) {
    if (i18n[key] === undefined) {
      i18n[key] = value;
      added++;
    }
  }
  if (added > 0) write(i18nFile, i18n);
  console.log(
    `built ${nations.length} nation sheets${withRow ? ", row.json" : ""} and goods; ${added} names added`,
  );
}
