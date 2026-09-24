import fs from "fs";
import path from "path";
import {
  ActorData,
  LeadersData,
  LeadersDataSchema,
  PartyData,
  Traits,
} from "../../../src/veritable/data/schemas/leaders";
import {
  Ideology,
  IdeologyTableSchema,
  NamePoolSchema,
  RegimesSchema,
} from "../../../src/veritable/data/schemas/politics";
import { meanIdeology } from "../../../src/veritable/sim/politics/ideology";
import { traitsFromIdeology } from "../../../src/veritable/sim/politics/leaders";
import { Lock, REPO_ROOT } from "./sources";
import {
  loadWikidata,
  PARTIES_FILE,
  PartiesFile,
  WikidataPerson,
  WikidataSnapshot,
} from "./wikidata";

// data/veritable/leaders/<iso3>.json from the Wikidata snapshots (offline):
// heads of state and government, the main parties with their leaders,
// ideologies mapped to the three axes through politics/ideologies.json,
// starting shares from parties.json. Traits of the heads come from
// estimates.json (written by hand, justified); those of the party leaders
// are derived from the ideology of their party. Names: the parody key must
// exist in i18n/fr.json (written by hand, the tool lists the missing ones);
// the fictional name is drawn once from the name pool, deterministically.
//
// J6, the nations of politics-world.json (all but europe-10): what Wikidata
// lacks comes from that file, marked estimate — a party the search did not
// resolve, the ideology of a party without a mapped P1142, a party leader
// without a chair statement, a head without a mandate at the date. A
// presidential nation without a head of government has its head of state
// in that role. Parody names exist only for the main nations (estimates ->
// parodyNations); elsewhere the parody key holds the fictional name.

const DATA = path.join(REPO_ROOT, "data/veritable");

export interface LeaderTraitEstimate {
  person: string; // as labelled by Wikidata at the time of writing
  traits: Traits;
  note: string;
  // Party of the head when Wikidata gives none of the listed ones (an
  // "independent" president backed by a party, a leader who left the party
  // chair): a QID of parties.json.
  partyQid?: string;
}

export function slug(label: string): string {
  return label
    .replace(/[łŁ]/g, "l")
    .replace(/[øØ]/g, "o")
    .replace(/ı/g, "i")
    .replace(/ß/g, "ss")
    .replace(/[đĐ]/g, "d")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

// Deterministic 32-bit hash (FNV-1a) for the fictional names.
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

interface WorldEntry {
  headOfState: { name: string; party: string | null } | null;
  headOfGovernment: { name: string; party: string | null } | null;
  election: string;
  parties: {
    label: string;
    support: number;
    leader: string | null;
    ideology: Ideology;
  }[];
}

// J6: a head written by hand where Wikidata is stale on the start date of
// the scenario (a statement without its end date) and the world file too
// (estimates.json -> headOverrides, key "<ISO3>/<role>").
export interface HeadOverride {
  person: string;
  born?: string;
  party?: string; // label of parties.json
  note: string;
}

const norm = (text: string) => slug(text).replace(/-/g, "");

// Share of the words two names have in common, over the longer one
// (diacritics and case ignored): 1 for the same name, 0 for two people.
function nameLikeness(a: string, b: string): number {
  const words = (text: string) =>
    new Set(
      text
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w !== ""),
    );
  const x = words(a);
  const y = words(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / Math.max(x.size, y.size);
}

// Two spellings of one name: the words of one contain all the words of the
// other, two words at least (suffixes such as Jr. ignored).
function sameName(a: string, b: string): boolean {
  const words = (text: string) =>
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w !== "" && !["jr", "sr", "ii", "iii"].includes(w));
  const [x, y] = [words(a), words(b)].sort((u, v) => u.length - v.length);
  return x.length >= 2 && x.every((w) => y.includes(w));
}

export function buildLeaders(
  countries: readonly string[],
  lock: Lock,
  estimates: {
    asOf: string;
    leaderTraits: Record<string, LeaderTraitEstimate>;
    partyIdeologies: Record<string, { ideology: Ideology; note: string }>;
    parodyNations?: string[];
    headOverrides?: Record<string, HeadOverride>;
  },
  i18n: Record<string, string>,
): {
  files: Record<string, LeadersData>;
  missingParody: string[];
  warnings: string[];
} {
  const snapshots = loadWikidata(lock, countries);
  const parties = JSON.parse(
    fs.readFileSync(PARTIES_FILE, "utf8"),
  ) as PartiesFile;
  const table = IdeologyTableSchema.parse(
    JSON.parse(
      fs.readFileSync(path.join(DATA, "politics/ideologies.json"), "utf8"),
    ),
  );
  const regimes = RegimesSchema.parse(
    JSON.parse(
      fs.readFileSync(path.join(DATA, "politics/regimes.json"), "utf8"),
    ),
  );
  const files: Record<string, LeadersData> = {};
  const missingParody: string[] = [];
  const warnings: string[] = [];
  const worldFile = path.join(
    REPO_ROOT,
    "tools/veritable/ingest/politics-world.json",
  );
  const world = (
    fs.existsSync(worldFile)
      ? JSON.parse(fs.readFileSync(worldFile, "utf8")).nations
      : {}
  ) as Record<string, WorldEntry>;
  const parodyNations = estimates.parodyNations ?? null;

  for (const nation of countries) {
    const snapshot: WikidataSnapshot = snapshots[nation];
    const entry = parties.nations[nation];
    const sheet = JSON.parse(
      fs.readFileSync(
        path.join(DATA, "nations", `${nation.toLowerCase()}.json`),
        "utf8",
      ),
    ) as { regime: string };
    const regime = regimes.find((r) => r.id === sheet.regime)!;
    const pool = NamePoolSchema.parse(
      JSON.parse(
        fs.readFileSync(
          path.join(DATA, "names", `${nation.toLowerCase()}.json`),
          "utf8",
        ),
      ),
    );
    const lower = nation.toLowerCase();
    const actors: ActorData[] = [];
    const partyList: PartyData[] = [];
    const partyIdOf = new Map<string, string>(); // QID -> id

    // Parties first: ideologies, shares, leaders.
    for (const wd of snapshot.parties) {
      const listed = entry.parties.find((p) => p.qid === wd.qid);
      if (listed === undefined) continue;
      const id = `${lower}-${slug(wd.label)}`;
      partyIdOf.set(wd.qid, id);
      const mapped = wd.ideologies
        .filter((i) => i.qid in table)
        .map((i) => ({ ideology: table[i.qid], weight: 1 }));
      const unmapped = wd.ideologies.filter((i) => !(i.qid in table));
      for (const i of unmapped) {
        warnings.push(
          `${nation} ${wd.label}: ideology ${i.qid} (${i.label}) not in ideologies.json`,
        );
      }
      let ideology: Ideology;
      let ideologySource: string;
      const agentParty = world[nation]?.parties.find(
        (p) => p.label === listed.label,
      );
      if (mapped.length > 0) {
        ideology = meanIdeology(mapped);
        ideologySource = `wikidata:P1142 x ideologies.json (${mapped.length} of ${wd.ideologies.length})`;
      } else if (wd.qid in estimates.partyIdeologies) {
        ideology = estimates.partyIdeologies[wd.qid].ideology;
        ideologySource = `estimate: ${estimates.partyIdeologies[wd.qid].note}`;
      } else if (agentParty !== undefined) {
        ideology = agentParty.ideology;
        ideologySource = "estimate: politics-world.json (J6)";
      } else {
        ideology = { economic: 0, authority: 0, sovereignty: 0 };
        ideologySource = "estimate: no ideology known, centre";
        warnings.push(`${nation} ${wd.label}: no ideology at all`);
      }
      const round3 = (v: number) => Math.round(v * 1000) / 1000;
      ideology = {
        economic: round3(ideology.economic),
        authority: round3(ideology.authority),
        sovereignty: round3(ideology.sovereignty),
      };
      i18n[`party.${id}`] ??= wd.label;
      partyList.push({
        id,
        name: `party.${id}`,
        wikidata: wd.qid,
        ideologies: wd.ideologies.map((i) => i.qid),
        ideology,
        ideologySource,
        support: listed.support,
        supportSource: {
          source: "estimate",
          asOf: snapshot.referenceDate,
          note: entry.election,
        },
        leader: null,
      });
    }
    // J6: the parties of politics-world.json Wikidata did not resolve.
    const worldEntry = world[nation];
    if (worldEntry !== undefined) {
      for (const listed of entry.parties) {
        if (listed.qid !== undefined && partyIdOf.has(listed.qid)) continue;
        const agent = worldEntry.parties.find((p) => p.label === listed.label);
        if (agent === undefined) continue;
        const id = `${lower}-${slug(listed.label)}`;
        if (partyList.some((p) => p.id === id)) continue;
        i18n[`party.${id}`] ??= listed.label;
        partyList.push({
          id,
          name: `party.${id}`,
          wikidata: listed.qid ?? null,
          ideologies: [],
          ideology: agent.ideology,
          ideologySource: "estimate: politics-world.json (J6)",
          support: listed.support,
          supportSource: {
            source: "estimate",
            asOf: snapshot.referenceDate,
            note: entry.election,
          },
          leader: null,
        });
      }
    }

    // Actors: heads, then party leaders. One actor per person.
    const byQid = new Map<string, ActorData>();
    const usedNames = new Set<string>(); // fictional names of this nation
    const labels = new Map<string, string>(); // actor id -> person label
    const addActor = (
      person: WikidataPerson,
      role: ActorData["role"],
      partyId: string | null,
      traits: Traits,
      source: string,
      note?: string,
    ): ActorData => {
      const existing = byQid.get(person.qid);
      if (existing !== undefined) return existing;
      const id = `${lower}-${slug(person.label)}`;
      const born = person.born ?? "1965-01-01";
      if (person.born === null && parodyNations === null)
        warnings.push(
          `${nation} ${person.label}: no birth date, 1965-01-01 assumed`,
        );
      const parodyKey = `leader.${id}.parody`;
      const fictionalKey = `leader.${id}.fictional`;
      if (!(fictionalKey in i18n)) {
        // J6: never the name of another actor of the nation (with 195
        // nations, five pairs drew the same name).
        for (let salt = 0; ; salt++) {
          const h = hash(salt === 0 ? id : `${id}#${salt}`);
          const name = `${pool.first[h % pool.first.length]} ${pool.last[(h >>> 8) % pool.last.length]}`;
          if (!usedNames.has(name) || salt > 50) {
            i18n[fictionalKey] = name;
            break;
          }
        }
      }
      usedNames.add(i18n[fictionalKey]);
      labels.set(id, person.label);
      // J6: outside the main nations, no parody: the fictional name.
      if (parodyNations !== null && !parodyNations.includes(nation)) {
        i18n[parodyKey] = i18n[fictionalKey];
      }
      if (!(parodyKey in i18n))
        missingParody.push(`${parodyKey} (${person.label})`);
      const actor: ActorData = {
        id,
        role,
        names: { parody: parodyKey, fictional: fictionalKey },
        born,
        party: partyId,
        traits,
        wikidata:
          person.qid.startsWith("agent:") || person.qid.startsWith("estimate:")
            ? null
            : person.qid,
        source,
        // Validity date of the data: the start of the scenario.
        asOf: snapshot.referenceDate,
        ...(note === undefined ? {} : { note }),
      };
      byQid.set(person.qid, actor);
      actors.push(actor);
      return actor;
    };
    const partyOf = (qid: string | null) =>
      qid === null ? null : (partyIdOf.get(qid) ?? null);
    const ideologyOf = (partyId: string | null): Ideology =>
      partyList.find((p) => p.id === partyId)?.ideology ?? {
        economic: 0,
        authority: 0.2,
        sovereignty: 0.2,
      };

    // J6: a head Wikidata has no mandate for on the date comes from
    // politics-world.json (no QID); without a head of government (a
    // presidential nation), the head of state takes that role, which the
    // schema requires — as Erdoğan in Turkey since the J4. Its hand-written
    // traits may be filed under either role.
    const heads = [...snapshot.heads];
    if (worldEntry !== undefined) {
      for (const [role, agent] of [
        ["head-of-state", worldEntry.headOfState],
        ["head-of-government", worldEntry.headOfGovernment],
      ] as const) {
        if (agent === null || heads.some((h) => h.role === role)) continue;
        heads.push({
          role,
          person: {
            qid: `agent:${slug(agent.name)}`,
            label: agent.name,
            born: null,
            parties: [],
          },
        });
      }
    }
    const overridden = new Map<string, HeadOverride>(); // qid -> override
    for (const role of ["head-of-state", "head-of-government"] as const) {
      const o = estimates.headOverrides?.[`${nation}/${role}`];
      if (o === undefined) continue;
      const person: WikidataPerson = {
        qid: `estimate:${slug(o.person)}`,
        label: o.person,
        born: o.born ?? null,
        parties: [],
      };
      const i = heads.findIndex((h) => h.role === role);
      if (i >= 0) heads[i] = { role, person };
      else heads.push({ role, person });
      overridden.set(person.qid, o);
    }
    // A party of parties.json by its label, once built.
    const partyByLabel = (label: string): string | null => {
      const listed = entry.parties.find((p) => norm(p.label) === norm(label));
      if (listed === undefined) return null;
      if (listed.qid !== undefined && partyIdOf.has(listed.qid)) {
        return partyIdOf.get(listed.qid)!;
      }
      const id = `${lower}-${slug(listed.label)}`;
      return partyList.some((p) => p.id === id) ? id : null;
    };
    const merged = new Set<string>();
    if (!heads.some((h) => h.role === "head-of-government")) {
      const state = heads.find((h) => h.role === "head-of-state");
      if (state !== undefined) {
        heads.splice(heads.indexOf(state), 1, {
          role: "head-of-government",
          person: state.person,
        });
        merged.add(state.person.qid);
      }
    }
    for (const head of heads) {
      let key = `${nation}/${head.role}`;
      if (
        !(key in estimates.leaderTraits) &&
        merged.has(head.person.qid) &&
        `${nation}/head-of-state` in estimates.leaderTraits
      ) {
        key = `${nation}/head-of-state`;
      }
      // J6, world nations: the hand-written entry whose person looks most
      // like the one Wikidata gives, either role (South Korea: Wikidata has
      // the president as head of government too).
      if (worldEntry !== undefined) {
        let best = nameLikeness(
          estimates.leaderTraits[key]?.person ?? "",
          head.person.label,
        );
        for (const role of ["head-of-state", "head-of-government"]) {
          const other = estimates.leaderTraits[`${nation}/${role}`];
          if (other === undefined) continue;
          const score = nameLikeness(other.person, head.person.label);
          if (score > best) {
            best = score;
            key = `${nation}/${role}`;
          }
        }
      }
      const estimate = estimates.leaderTraits[key];
      const agentHead =
        worldEntry === undefined
          ? null
          : head.role === "head-of-state"
            ? worldEntry.headOfState
            : (worldEntry.headOfGovernment ?? worldEntry.headOfState);
      const agentParty =
        agentHead?.party === null || agentHead?.party === undefined
          ? null
          : (partyByLabel(agentHead.party) ??
            partyList.find(
              (p) => norm(i18n[p.name] ?? "") === norm(agentHead.party!),
            )?.id ??
            null);
      const override = overridden.get(head.person.qid);
      const partyId =
        (override === undefined
          ? null
          : override.party === undefined
            ? null
            : partyByLabel(override.party)) ??
        head.person.parties.map(partyOf).find((p) => p !== null) ??
        partyOf(estimate?.partyQid ?? null) ??
        (override === undefined ? agentParty : null);
      if (estimate !== undefined) {
        if (estimate.person !== head.person.label) {
          warnings.push(
            `${key}: estimates.json says ${estimate.person}, Wikidata says ${head.person.label}`,
          );
        }
        addActor(
          head.person,
          head.role,
          partyId,
          estimate.traits,
          "estimate",
          override === undefined
            ? estimate.note
            : `${override.note} ${estimate.note}`,
        );
      } else {
        warnings.push(
          `${key} (${head.person.label}): no hand-written traits, derived from the party`,
        );
        addActor(
          head.person,
          head.role,
          partyId,
          traitsFromIdeology(
            ideologyOf(partyId),
            regime.legitimacyBase,
            0,
            null,
          ),
          "derived",
          override === undefined
            ? "Traits dérivés de l'idéologie du parti (aucune estimation manuelle)."
            : `${override.note} Traits dérivés de l'idéologie du parti (aucune estimation manuelle).`,
        );
      }
    }
    // J6: a party without a chair on Wikidata takes the leader named by
    // politics-world.json (no QID, no birth date).
    for (const party of partyList) {
      if (worldEntry === undefined) break;
      const wd = snapshot.parties.find((w) => w.qid === party.wikidata);
      if (wd?.leader !== null && wd?.leader !== undefined) continue;
      // The party as parties.json lists it (its label is the world file's).
      const listed = entry.parties.find(
        (p) =>
          (p.qid !== undefined && p.qid === party.wikidata) ||
          `${lower}-${slug(p.label)}` === party.id,
      );
      const agent = worldEntry.parties.find(
        (p) =>
          (listed !== undefined && p.label === listed.label) ||
          norm(p.label) === norm(i18n[party.name] ?? ""),
      );
      if (agent?.leader === null || agent?.leader === undefined) continue;
      // The same person under another spelling: the head the world file
      // names as this leader (Bongbong Marcos is its Ferdinand Marcos Jr.),
      // or a name whose words contain the other's (Salva Kiir Mayardit).
      const asHead = (
        [
          ["head-of-state", worldEntry.headOfState],
          ["head-of-government", worldEntry.headOfGovernment],
        ] as const
      ).find(([, h]) => h !== null && norm(h.name) === norm(agent.leader!));
      // (A head of state alone was moved to the head-of-government role.)
      const known =
        (asHead === undefined
          ? undefined
          : (actors.find((a) => a.role === asHead[0]) ??
            actors.find((a) => a.role === "head-of-government"))) ??
        actors.find((a) => sameName(labels.get(a.id) ?? "", agent.leader!));
      const actor =
        known ??
        addActor(
          {
            qid: `agent:${slug(agent.leader)}`,
            label: agent.leader,
            born: null,
            parties: [],
          },
          "party-leader",
          party.id,
          traitsFromIdeology(party.ideology, regime.legitimacyBase, 0, null),
          "estimate",
          "Dirigeant du parti d'après politics-world.json (J6) ; traits dérivés de l'idéologie du parti.",
        );
      party.leader = actor.id;
      actor.party ??= party.id;
    }
    for (const wd of snapshot.parties) {
      const partyId = partyIdOf.get(wd.qid);
      if (partyId === undefined || wd.leader === null) continue;
      const party = partyList.find((p) => p.id === partyId)!;
      const actor = addActor(
        wd.leader,
        "party-leader",
        partyId,
        traitsFromIdeology(party.ideology, regime.legitimacyBase, 0, null),
        "derived",
        "Traits dérivés de l'idéologie du parti.",
      );
      party.leader = actor.id;
      actor.party ??= partyId;
    }
    files[nation] = LeadersDataSchema.parse({
      nation,
      actors,
      parties: partyList,
    });
  }
  return { files, missingParody, warnings };
}

export function writeLeaders(files: Record<string, LeadersData>): void {
  fs.mkdirSync(path.join(DATA, "leaders"), { recursive: true });
  for (const [nation, data] of Object.entries(files)) {
    fs.writeFileSync(
      path.join(DATA, "leaders", `${nation.toLowerCase()}.json`),
      JSON.stringify(data, null, 2) + "\n",
    );
  }
}
