import fs from "fs";
import { jsonSha256, LOCK_FILE, readLock } from "./sources";
import {
  Dated,
  PARTIES_FILE,
  PartiesFile,
  SEARCH_URL,
  USER_AGENT,
  validAt,
  WikidataParty,
  WikidataPerson,
  WikidataSnapshot,
  wikidataSnapshot,
} from "./wikidata";

// Wikidata for every nation of the world (J6), through the action API
// (wbgetclaims, wbgetentities, wbsearchentities): the SPARQL queries of
// wikidata.ts need about seven minutes a nation at the rate the public query
// service allows, and batched ones time out. Same snapshots, same filtering
// (statements valid on the reference date; a chair who died before the date
// is skipped), but the latest start comes before the rank (see current()):
//
//   npm run veritable:ingest -- fetch-wikidata-world --scenario world-2026 --only A,B,…
//
// Parties are resolved through the search API (label in its language, a
// description that says party, the country checked on P17); a party it does
// not find is left without QID and built from politics-world.json.

const PAUSE_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(params: Record<string, string>): Promise<T> {
  const url = `${SEARCH_URL}?${new URLSearchParams({ format: "json", ...params })}`;
  for (let attempt = 0; ; attempt++) {
    await sleep(PAUSE_MS);
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (response.ok) return (await response.json()) as T;
      if (attempt >= 5 || (response.status < 500 && response.status !== 429)) {
        throw new Error(`Wikidata API: HTTP ${response.status}`);
      }
    } catch (error) {
      if (attempt >= 5) throw error;
    }
    await sleep(2000 * (attempt + 1));
  }
}

interface Snak {
  datavalue?: { value: { id?: string; time?: string } };
}
interface Statement {
  mainsnak: Snak;
  rank: "preferred" | "normal" | "deprecated";
  qualifiers?: Record<string, Snak[]>;
}
type Claims = Record<string, Statement[]>;

// "+2025-01-20T00:00:00Z" -> "2025-01-20"; a year or month precision keeps
// the first day ("+2016-00-00" -> "2016-01-01").
function dateOfTime(time: string | undefined): string | null {
  if (time === undefined) return null;
  const m = /^[+-]?(\d{4})-(\d{2})-(\d{2})/.exec(time);
  if (m === null) return null;
  const month = m[2] === "00" ? "01" : m[2];
  const day = m[3] === "00" ? "01" : m[3];
  return `${m[1]}-${month}-${day}`;
}

const RANK: Record<Statement["rank"], string> = {
  preferred: "PreferredRank",
  normal: "NormalRank",
  deprecated: "DeprecatedRank",
};

function dated(
  statements: Statement[] | undefined,
): (Dated & { qid: string })[] {
  return (statements ?? []).flatMap((s) => {
    const qid = s.mainsnak.datavalue?.value.id;
    if (qid === undefined) return [];
    return [
      {
        qid,
        start: dateOfTime(s.qualifiers?.P580?.[0]?.datavalue?.value.time),
        end: dateOfTime(s.qualifiers?.P582?.[0]?.datavalue?.value.time),
        rank: RANK[s.rank],
      },
    ];
  });
}

interface Entity {
  labels?: Record<string, { value: string }>;
  claims?: Claims;
}

async function entities(ids: readonly string[]): Promise<Map<string, Entity>> {
  const out = new Map<string, Entity>();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const json = await api<{ entities: Record<string, Entity> }>({
      action: "wbgetentities",
      ids: batch.join("|"),
      props: "labels|claims",
      // "mul": Wikidata keeps a name that is the same in every language
      // (Donald Trump, Claudia Sheinbaum) under that code only.
      languages: "fr|en|mul",
    });
    for (const [id, e] of Object.entries(json.entities ?? {})) out.set(id, e);
  }
  return out;
}

const labelOf = (e: Entity | undefined, fallback: string) =>
  e?.labels?.fr?.value ??
  e?.labels?.en?.value ??
  e?.labels?.mul?.value ??
  fallback;

// The holder on the date, for the world (J6): among the valid statements
// the one that started last, then the preferred rank, ties by QID. The rank
// first (latest() of wikidata.ts, europe-10) picked stale holders whose
// statement kept the preferred rank and no end date (Thailand's prime
// minister, Saudi Arabia's).
function current<T extends Dated & { qid: string }>(
  items: T[],
  date: string,
): T | undefined {
  const preferred = (i: T) => (i.rank.endsWith("PreferredRank") ? 1 : 0);
  return items
    .filter((i) => validAt(i, date))
    .sort(
      (a, b) =>
        (b.start ?? "").localeCompare(a.start ?? "") ||
        preferred(b) - preferred(a) ||
        a.qid.localeCompare(b.qid),
    )[0];
}

const PARTY_WORDS =
  /parti|party|partido|partito|partei|coalition|alliance|front|movement|mouvement|movimiento|union|congress|league|ligue|bloc|list/i;

export async function fetchWikidataWorld(
  nations: readonly string[],
  referenceDate: string,
): Promise<void> {
  const parties = JSON.parse(
    fs.readFileSync(PARTIES_FILE, "utf8"),
  ) as PartiesFile;
  const lock = readLock();
  const fetchedAt = new Date().toISOString().slice(0, 10);

  // 1. Heads of state (P35) and of government (P6), every statement.
  const heads = new Map<
    string,
    { P35: (Dated & { qid: string })[]; P6: (Dated & { qid: string })[] }
  >();
  for (const n of nations) {
    const country = parties.nations[n]?.wikidataCountry;
    if (country === undefined) throw new Error(`parties.json: no ${n}`);
    const record = {
      P35: [] as (Dated & { qid: string })[],
      P6: [] as (Dated & { qid: string })[],
    };
    for (const property of ["P35", "P6"] as const) {
      const json = await api<{ claims: Claims }>({
        action: "wbgetclaims",
        entity: country,
        property,
      });
      record[property] = dated(json.claims?.[property]);
    }
    heads.set(n, record);
  }
  console.log(`heads: ${nations.length} nations`);

  // 2. Party QIDs: search, then the country checked on P17.
  const candidates: { nation: string; index: number; qids: string[] }[] = [];
  for (const n of nations) {
    const entry = parties.nations[n];
    for (let i = 0; i < entry.parties.length; i++) {
      const party = entry.parties[i];
      if (party.qid !== undefined) continue;
      const qids: string[] = [];
      for (const language of party.lang === "en"
        ? ["en"]
        : [party.lang, "en"]) {
        const json = await api<{
          search?: { id: string; description?: string }[];
        }>({
          action: "wbsearchentities",
          type: "item",
          limit: "10",
          language,
          uselang: language,
          search: party.label,
        });
        for (const hit of json.search ?? []) {
          if (
            PARTY_WORDS.test(hit.description ?? "") &&
            !qids.includes(hit.id)
          ) {
            qids.push(hit.id);
          }
        }
        if (qids.length > 0) break;
      }
      candidates.push({ nation: n, index: i, qids: qids.slice(0, 3) });
    }
  }
  const candidateInfo = await entities([
    ...new Set(candidates.flatMap((c) => c.qids)),
  ]);
  for (const c of candidates) {
    const entry = parties.nations[c.nation];
    const hit = c.qids.find((q) =>
      dated(candidateInfo.get(q)?.claims?.P17).some(
        (s) => s.qid === entry.wikidataCountry,
      ),
    );
    if (hit !== undefined) entry.parties[c.index].qid = hit;
  }
  console.log(
    `party search: ${candidates.filter((c) => parties.nations[c.nation].parties[c.index].qid).length}/${candidates.length} resolved`,
  );

  // 3. Parties: labels, ideologies (P1142), chairs (P488).
  const partyQids = [
    ...new Set(
      nations.flatMap((n) =>
        parties.nations[n].parties
          .map((p) => p.qid)
          .filter((q): q is string => q !== undefined),
      ),
    ),
  ];
  const partyEntities = await entities(partyQids);
  const ideologyQids = new Set<string>();
  for (const e of partyEntities.values()) {
    for (const s of dated(e.claims?.P1142)) ideologyQids.add(s.qid);
  }
  const ideologyEntities = await entities([...ideologyQids]);

  // 4. People: every head and chair valid on the date.
  const people = new Set<string>();
  for (const record of heads.values()) {
    for (const s of [...record.P35, ...record.P6]) {
      if (validAt(s, referenceDate)) people.add(s.qid);
    }
  }
  for (const e of partyEntities.values()) {
    for (const s of dated(e.claims?.P488)) {
      if (validAt(s, referenceDate)) people.add(s.qid);
    }
  }
  const personEntities = await entities([...people]);
  const person = (qid: string): WikidataPerson | null => {
    const e = personEntities.get(qid);
    if (e === undefined) return null;
    return {
      qid,
      label: labelOf(e, qid),
      born: dateOfTime(e.claims?.P569?.[0]?.mainsnak.datavalue?.value.time),
      died: dateOfTime(e.claims?.P570?.[0]?.mainsnak.datavalue?.value.time),
      parties: dated(e.claims?.P102)
        .filter((s) => validAt(s, referenceDate))
        .map((s) => s.qid)
        .sort(),
    };
  };
  const alive = (qid: string) => {
    const died = person(qid)?.died;
    return died === null || died === undefined || died > referenceDate;
  };
  console.log(
    `parties ${partyEntities.size}, ideologies ${ideologyEntities.size}, people ${personEntities.size}`,
  );

  // 5. One snapshot per nation.
  for (const n of nations) {
    const entry = parties.nations[n];
    const record = heads.get(n)!;
    const snapshotHeads: WikidataSnapshot["heads"] = [];
    for (const [role, list] of [
      ["head-of-government", record.P6],
      ["head-of-state", record.P35],
    ] as const) {
      const chosen = current(
        list.filter((s) => alive(s.qid)),
        referenceDate,
      );
      const p = chosen === undefined ? null : person(chosen.qid);
      if (p !== null) snapshotHeads.push({ role, person: p });
    }
    const snapshotParties: WikidataParty[] = [];
    for (const party of entry.parties) {
      if (party.qid === undefined) continue;
      const e = partyEntities.get(party.qid);
      if (e === undefined) continue;
      const chair = current(
        dated(e.claims?.P488).filter((s) => alive(s.qid)),
        referenceDate,
      );
      snapshotParties.push({
        qid: party.qid,
        label: labelOf(e, party.qid),
        ideologies: [...new Set(dated(e.claims?.P1142).map((s) => s.qid))]
          .sort()
          .map((qid) => ({
            qid,
            label: labelOf(ideologyEntities.get(qid), qid),
          })),
        leader: chair === undefined ? null : person(chair.qid),
      });
    }
    const snapshot: WikidataSnapshot = {
      nation: n,
      country: entry.wikidataCountry,
      referenceDate,
      fetchedAt,
      license: "CC0 1.0, Wikidata",
      heads: snapshotHeads,
      parties: snapshotParties,
    };
    const text = JSON.stringify(snapshot, null, 1) + "\n";
    fs.writeFileSync(wikidataSnapshot(n), text);
    lock[`snapshots/wikidata/${n.toLowerCase()}.json`] = jsonSha256(text);
  }
  fs.writeFileSync(PARTIES_FILE, JSON.stringify(parties, null, 2) + "\n");
  fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2) + "\n");
  console.log(`wrote ${nations.length} snapshots`);
}
