import fs from "fs";
import path from "path";
import {
  RelationsFile,
  RelationsFileSchema,
} from "../../../src/veritable/data/schemas/relations";
import { LOCK_FILE, readLock, REPO_ROOT, sha256 } from "./sources";

// Relations of the first day of a scenario (J6b) ->
// data/veritable/relations/<scenario>.json. Replayable:
//
//   npm run veritable:ingest -- fetch-voeten --scenario world-2026
//       the ideal points of the votes at the UN General Assembly (Bailey,
//       Strezhnev and Voeten, Harvard Dataverse, CC0) into the cache (outside
//       git), sha256 in sources.lock.json.
//   npm run veritable:ingest -- build-relations --scenario world-2026
//       offline: relation = intercept - slope x |ideal point a - ideal point
//       b| (means over the last sessions), + a common military alliance, +
//       a common economic union, + a guarantee between them, - full
//       sanctions between them; a de facto entity: its claimant hostile, the
//       nations that recognise it warmer; then the pairs written by hand
//       (estimates.json -> relations.keyPairs). Wars are set by the
//       simulation (-100).

export const VOETEN = {
  url: "https://dataverse.harvard.edu/api/access/datafile/14098429?format=original",
  cache: "cache/voeten-idealpoints.csv",
};
const HERE = path.join(REPO_ROOT, "tools/veritable/ingest");
const DATA = path.join(REPO_ROOT, "data/veritable");

export async function fetchVoeten(): Promise<void> {
  const response = await fetch(VOETEN.url, {
    headers: { "User-Agent": "Veritable-ingest/1.0" },
  });
  if (!response.ok) throw new Error(`Voeten: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(path.join(HERE, VOETEN.cache), data);
  const lock = readLock();
  lock[VOETEN.cache] = sha256(data);
  fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2) + "\n");
  console.log(`Voeten ideal points: ${data.length} bytes`);
}

// Mean ideal point of each country over [from, to] (years of the sessions).
function idealPoints(from: number, to: number): Map<string, number> {
  const file = path.join(HERE, VOETEN.cache);
  if (!fs.existsSync(file)) {
    throw new Error(
      "Voeten cache missing: run `veritable:ingest -- fetch-voeten`",
    );
  }
  const data = fs.readFileSync(file);
  if (readLock()[VOETEN.cache] !== sha256(data)) {
    throw new Error("Voeten cache does not match sources.lock.json");
  }
  const lines = data.toString("utf8").split(/\r?\n/);
  const header = lines[0].split(",").map((h) => h.replace(/"/g, ""));
  const at = (name: string) => header.indexOf(name);
  const [iIso, iPoint, iYear] = [at("iso3c"), at("IdealPointFP"), at("year")];
  const sums = new Map<string, { sum: number; n: number }>();
  for (const line of lines.slice(1)) {
    if (line === "") continue;
    const cells = line.split(",").map((c) => c.replace(/"/g, ""));
    const year = Number(cells[iYear]);
    const point = Number(cells[iPoint]);
    if (year < from || year > to || !Number.isFinite(point)) continue;
    const s = sums.get(cells[iIso]) ?? { sum: 0, n: 0 };
    s.sum += point;
    s.n += 1;
    sums.set(cells[iIso], s);
  }
  return new Map([...sums].map(([iso, s]) => [iso, s.sum / s.n]));
}

interface RelationsRules {
  note: string;
  years: [number, number];
  intercept: number;
  slope: number;
  unknownVoting: number;
  militaryAlliance: number;
  economicUnion: number;
  guarantee: number;
  sanctions: number;
  claimant: number;
  recognition: number;
  keyPairs: { pairs: [string, string, number][]; note: string }[];
}

export function buildRelations(scenarioId: string): void {
  const scenario = JSON.parse(
    fs.readFileSync(path.join(DATA, "scenarios", `${scenarioId}.json`), "utf8"),
  );
  if (scenario.relations === undefined) {
    throw new Error(`${scenarioId}: no relations file in the scenario`);
  }
  const estimates = JSON.parse(
    fs.readFileSync(path.join(HERE, "estimates.json"), "utf8"),
  );
  const rules = estimates.relations as RelationsRules;
  const nations: string[] = [...scenario.nations].sort();
  const points = idealPoints(rules.years[0], rules.years[1]);
  const blocs = fs
    .readdirSync(path.join(DATA, "blocs"))
    .filter((f) => f.endsWith(".json"))
    .map((f) =>
      JSON.parse(fs.readFileSync(path.join(DATA, "blocs", f), "utf8")),
    ) as {
    id: string;
    type?: string;
    members: { nation: string; status: string }[];
  }[];
  const full = (type: string) =>
    blocs
      .filter((b) => b.type === type)
      .map(
        (b) =>
          new Set(
            b.members.filter((m) => m.status === "full").map((m) => m.nation),
          ),
      );
  const alliances = full("military-alliance");
  const unions = full("economic-union");
  const together = (sets: Set<string>[], a: string, b: string) =>
    sets.some((s) => s.has(a) && s.has(b));
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const guaranteed = new Set<string>(
    (scenario.guarantees ?? []).map(
      (g: { guarantor: string; protected: string }) =>
        key(g.guarantor, g.protected),
    ),
  );
  // Full sanctions of the first day: a bloc spread to its full members,
  // "*" to every nation but `except` (a regime of the UN).
  const members = (id: string): string[] => {
    const bloc = blocs.find((b) => b.id === id);
    return bloc === undefined
      ? [id]
      : bloc.members.filter((m) => m.status === "full").map((m) => m.nation);
  };
  const sanctioned = new Set<string>();
  for (const s of scenario.sanctions ?? []) {
    if (s.goods !== undefined) continue;
    const except: string[] = s.except ?? [];
    const by = s.by === "*" ? nations : members(s.by);
    for (const target of members(s.against)) {
      for (const n of by) {
        if (n !== target && !except.includes(n)) sanctioned.add(key(n, target));
      }
    }
  }
  // De facto entities: their claimants, and who recognises them.
  const sheets = new Map<string, { recognition?: { recognizedBy: string[] } }>(
    nations.map((n) => [
      n,
      JSON.parse(
        fs.readFileSync(
          path.join(DATA, "nations", `${n.toLowerCase()}.json`),
          "utf8",
        ),
      ),
    ]),
  );
  const claimed = new Set<string>();
  for (const c of scenario.contested as {
    controller: string;
    claimants: string[];
  }[]) {
    for (const claimant of c.claimants)
      claimed.add(key(claimant, c.controller));
  }
  const hand = new Map<string, number>();
  for (const group of rules.keyPairs) {
    for (const [a, b, v] of group.pairs) {
      if (!nations.includes(a) || !nations.includes(b)) {
        throw new Error(`relations.keyPairs: ${a}-${b} not in ${scenarioId}`);
      }
      hand.set(key(a, b), v);
    }
  }

  const values: number[] = [];
  for (let i = 0; i < nations.length; i++) {
    for (let j = i + 1; j < nations.length; j++) {
      const [a, b] = [nations[i], nations[j]];
      const k = key(a, b);
      const pa = points.get(a);
      const pb = points.get(b);
      let r =
        pa === undefined || pb === undefined
          ? rules.unknownVoting
          : rules.intercept - rules.slope * Math.abs(pa - pb);
      if (together(alliances, a, b)) r += rules.militaryAlliance;
      if (together(unions, a, b)) r += rules.economicUnion;
      if (guaranteed.has(k)) r += rules.guarantee;
      if (sanctioned.has(k)) r += rules.sanctions;
      if (claimed.has(k)) r = Math.min(r, rules.claimant);
      const recognisedBy = (x: string, y: string) =>
        sheets.get(x)?.recognition?.recognizedBy.includes(y) ?? false;
      if (recognisedBy(a, b) || recognisedBy(b, a)) r += rules.recognition;
      r = hand.get(k) ?? r;
      values.push(Math.round(Math.max(-100, Math.min(100, r))));
    }
  }
  const file: RelationsFile = RelationsFileSchema.parse({
    scenario: scenarioId,
    asOf: scenario.startDate,
    source:
      "Votes à l'Assemblée générale de l'ONU, points idéaux de Bailey, Strezhnev et Voeten (Harvard Dataverse, CC0), moyenne des sessions " +
      `${rules.years[0]}-${rules.years[1]} ; blocs et garanties du scénario ; paires écrites à la main (estimates.json → relations)`,
    note: rules.note,
    nations,
    values,
  });
  const out = path.join(DATA, scenario.relations);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(file) + "\n");
  const known = nations.filter((n) => points.has(n)).length;
  console.log(
    `relations of ${scenarioId}: ${nations.length} nations (${known} with votes), ${values.length} pairs, ${hand.size} by hand`,
  );
}
