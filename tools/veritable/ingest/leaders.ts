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

const DATA = path.join(REPO_ROOT, "data/veritable");

export interface LeaderTraitEstimate {
  person: string; // as labelled by Wikidata at the time of writing
  traits: Traits;
  note: string;
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

export function buildLeaders(
  countries: readonly string[],
  lock: Lock,
  estimates: {
    asOf: string;
    leaderTraits: Record<string, LeaderTraitEstimate>;
    partyIdeologies: Record<string, { ideology: Ideology; note: string }>;
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
      if (mapped.length > 0) {
        ideology = meanIdeology(mapped);
        ideologySource = `wikidata:P1142 x ideologies.json (${mapped.length} of ${wd.ideologies.length})`;
      } else if (wd.qid in estimates.partyIdeologies) {
        ideology = estimates.partyIdeologies[wd.qid].ideology;
        ideologySource = `estimate: ${estimates.partyIdeologies[wd.qid].note}`;
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
          asOf: parties.asOf,
          note: entry.election,
        },
        leader: null,
      });
    }

    // Actors: heads, then party leaders. One actor per person.
    const byQid = new Map<string, ActorData>();
    const addActor = (
      person: {
        qid: string;
        label: string;
        born: string | null;
        party: string | null;
      },
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
      if (person.born === null)
        warnings.push(
          `${nation} ${person.label}: no birth date, 1965-01-01 assumed`,
        );
      const parodyKey = `leader.${id}.parody`;
      const fictionalKey = `leader.${id}.fictional`;
      if (!(parodyKey in i18n))
        missingParody.push(`${parodyKey} (${person.label})`);
      if (!(fictionalKey in i18n)) {
        const h = hash(id);
        i18n[fictionalKey] =
          `${pool.first[h % pool.first.length]} ${pool.last[(h >>> 8) % pool.last.length]}`;
      }
      const actor: ActorData = {
        id,
        role,
        names: { parody: parodyKey, fictional: fictionalKey },
        born,
        party: partyId,
        traits,
        wikidata: person.qid,
        source,
        asOf: snapshot.fetchedAt,
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

    for (const head of snapshot.heads) {
      const key = `${nation}/${head.role}`;
      const estimate = estimates.leaderTraits[key];
      const partyId = partyOf(head.person.party);
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
          estimate.note,
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
          "Traits dérivés de l'idéologie du parti (aucune estimation manuelle).",
        );
      }
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
      if (actor.party === null) actor.party = partyId;
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
