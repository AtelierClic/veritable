import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { jsonSha256, Lock, LOCK_FILE, readLock, SNAPSHOT_DIR } from "./sources";

// Wikidata (CC0): heads of state and of government, the main parties and
// their leaders, birth dates, ideologies. Pinned like the other sources: the
// SPARQL answers are committed as snapshots (one per nation) with their
// sha256 in sources.lock.json; the build never touches the network.
//
//   npm run veritable:ingest -- fetch-wikidata --scenario europe-10
//
// The parties come from parties.json (labels, vote shares); their QIDs are
// resolved once through the search API and written back into parties.json.
// Every mandate (P35, P6, P488) and party membership (P102) is read as it
// stood on the start date of the scenario, through the qualifiers P580 and
// P582: no data of the scenario dates from after its first day.

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PARTIES_FILE = path.join(HERE, "parties.json");
const SPARQL_URL = "https://query.wikidata.org/sparql";
export const SEARCH_URL = "https://www.wikidata.org/w/api.php";
export const USER_AGENT =
  "veritable-ingest/0.1 (https://github.com/AtelierClic/veritable; open-source game data)";

export interface PartyEntry {
  label: string;
  lang: string;
  qid?: string;
  support: number;
}
export interface PartiesFile {
  _comment: string;
  asOf: string;
  nations: Record<
    string,
    { wikidataCountry: string; election: string; parties: PartyEntry[] }
  >;
}

export interface WikidataPerson {
  qid: string;
  label: string; // fr, else en
  born: string | null; // ISO date
  // Date of death (P570), when Wikidata has one: nobody who died before the
  // reference date holds an office at it.
  died?: string | null;
  // Party memberships (P102) valid at the reference date, QIDs sorted;
  // the build keeps the first that is one of the listed parties.
  parties: string[];
}
export interface WikidataParty {
  qid: string;
  label: string;
  ideologies: { qid: string; label: string }[];
  leader: WikidataPerson | null;
}
export interface WikidataSnapshot {
  nation: string;
  country: string; // QID
  // Every mandate and membership is read as it stood on this date (the
  // start of the scenario): P580 (start) <= date < P582 (end).
  referenceDate: string;
  fetchedAt: string;
  license: "CC0 1.0, Wikidata";
  heads: {
    role: "head-of-state" | "head-of-government";
    person: WikidataPerson;
  }[];
  parties: WikidataParty[];
}

export function wikidataSnapshot(nation: string): string {
  return path.join(SNAPSHOT_DIR, "wikidata", `${nation.toLowerCase()}.json`);
}

export type Binding = Record<string, { type: string; value: string }>;

const PAUSE_MS = 1500; // between requests: Wikidata rate-limits eagerly
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One request, retried with backoff on 429 / 5xx.
export async function request(
  url: string,
  init: RequestInit,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    await sleep(PAUSE_MS);
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      // A connection the server closed (it happens on a long run): again,
      // after a pause, like a 5xx.
      if (attempt >= 4) throw error;
      await sleep(PAUSE_MS * 4 * (attempt + 1));
      continue;
    }
    if (response.ok) return response;
    if (attempt >= 4 || (response.status < 500 && response.status !== 429)) {
      throw new Error(
        `Wikidata: HTTP ${response.status} for ${url.slice(0, 60)}`,
      );
    }
    await sleep(PAUSE_MS * 4 * (attempt + 1));
  }
}

export async function sparql(query: string): Promise<Binding[]> {
  const response = await request(SPARQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/sparql-results+json",
      "User-Agent": USER_AGENT,
    },
    body: `query=${encodeURIComponent(query)}`,
  });
  const json = (await response.json()) as { results: { bindings: Binding[] } };
  return json.results.bindings;
}

export const qidOf = (uri: string) => uri.slice(uri.lastIndexOf("/") + 1);
export const dateOf = (v: string | undefined) =>
  v === undefined ? null : v.slice(0, 10);

// Labels: French first, English otherwise (the label service is unreliable
// with a language list, so both are asked explicitly).
const LABELS = (v: string) => `
  OPTIONAL { ${v} rdfs:label ${v}Fr . FILTER(LANG(${v}Fr) = "fr") }
  OPTIONAL { ${v} rdfs:label ${v}En . FILTER(LANG(${v}En) = "en") }`;
const label = (b: Binding, v: string) =>
  b[`${v}Fr`]?.value ?? b[`${v}En`]?.value ?? qidOf(b[v].value);

// A party of the country with exactly this label (or alias) in this
// language, and a political organisation; the search API as a fallback.
async function resolveParty(
  entry: PartyEntry,
  country: string,
): Promise<string> {
  if (entry.qid !== undefined) return entry.qid;
  const literal = JSON.stringify(entry.label);
  const rows = await sparql(`
SELECT DISTINCT ?party ?partyEn WHERE {
  { ?party rdfs:label ${literal}@${entry.lang} } UNION { ?party skos:altLabel ${literal}@${entry.lang} }
  ?party wdt:P17 wd:${country} .
  ?party wdt:P31/wdt:P279* wd:Q7278 .
  OPTIONAL { ?party rdfs:label ?partyEn . FILTER(LANG(?partyEn) = "en") }
}`);
  if (rows.length > 0) {
    const qid = qidOf(rows[0].party.value);
    console.log(
      `  ${entry.label} -> ${qid} (${rows[0].partyEn?.value ?? qid})${rows.length > 1 ? ` [${rows.length} candidates]` : ""}`,
    );
    return qid;
  }
  const url = `${SEARCH_URL}?action=wbsearchentities&format=json&type=item&limit=10&language=${entry.lang}&uselang=${entry.lang}&search=${encodeURIComponent(entry.label)}`;
  const response = await request(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  const json = (await response.json()) as {
    search: { id: string; label: string; description?: string }[];
  };
  const hit = json.search.find((s) =>
    /parti|party|partido|partito|partei|партия|партія|coalition|alliance|plataforma/i.test(
      s.description ?? "",
    ),
  );
  if (hit === undefined) throw new Error(`no Wikidata item for ${entry.label}`);
  console.log(
    `  ${entry.label} -> ${hit.id} (${hit.label}: ${hit.description ?? ""}) [search]`,
  );
  return hit.id;
}

// Statements are fetched with their rank and qualifiers, and filtered here:
// the same filters written in SPARQL time out on the public endpoint.
export interface Dated {
  start: string | null;
  end: string | null;
  rank: string;
}

// Valid on `date`: not deprecated, started on or before it (or undated),
// not ended by it.
export function validAt(s: Dated, date: string): boolean {
  if (s.rank.endsWith("DeprecatedRank")) return false;
  if (s.start !== null && s.start > date) return false;
  if (s.end !== null && s.end <= date) return false;
  return true;
}

// Among the valid statements: the preferred-rank one first (Wikidata marks
// the current holder so; former chairs often keep a statement without an end
// date), then the one that started last; ties by QID for determinism.
export function latest<T extends Dated & { qid: string }>(
  items: T[],
  date: string,
): T | undefined {
  const preferred = (i: T) => (i.rank.endsWith("PreferredRank") ? 1 : 0);
  return items
    .filter((i) => validAt(i, date))
    .sort(
      (a, b) =>
        preferred(b) - preferred(a) ||
        (b.start ?? "").localeCompare(a.start ?? "") ||
        a.qid.localeCompare(b.qid),
    )[0];
}

export const datedOf = (b: Binding) => ({
  start: dateOf(b.start?.value),
  end: dateOf(b.end?.value),
  rank: b.rank?.value ?? "",
});

// Holders of a property of an item, with their qualifiers.
async function holders(
  item: string,
  property: string,
): Promise<(Dated & { qid: string })[]> {
  const rows = await sparql(`
SELECT ?holder ?start ?end ?rank WHERE {
  wd:${item} p:${property} ?st . ?st ps:${property} ?holder .
  ?st wikibase:rank ?rank .
  OPTIONAL { ?st pq:P580 ?start }
  OPTIONAL { ?st pq:P582 ?end }
}`);
  return rows.map((b) => ({ qid: qidOf(b.holder.value), ...datedOf(b) }));
}

// Label, birth date and party memberships valid at the date of a person.
async function person(qid: string, date: string): Promise<WikidataPerson> {
  const rows = await sparql(`
SELECT ?personFr ?personEn ?born ?died ?party ?start ?end ?rank WHERE {
  BIND(wd:${qid} AS ?person)
  ${LABELS("?person")}
  OPTIONAL { ?person wdt:P569 ?born }
  OPTIONAL { ?person wdt:P570 ?died }
  OPTIONAL {
    ?person p:P102 ?m . ?m ps:P102 ?party . ?m wikibase:rank ?rank .
    OPTIONAL { ?m pq:P580 ?start }
    OPTIONAL { ?m pq:P582 ?end }
  }
}`);
  const parties = new Set<string>();
  for (const b of rows) {
    if (b.party !== undefined && validAt(datedOf(b), date)) {
      parties.add(qidOf(b.party.value));
    }
  }
  const first = rows[0];
  return {
    qid,
    label: first?.personFr?.value ?? first?.personEn?.value ?? qid,
    born: dateOf(first?.born?.value),
    died: dateOf(first?.died?.value),
    parties: [...parties].sort(),
  };
}

async function fetchHeads(
  country: string,
  date: string,
): Promise<WikidataSnapshot["heads"]> {
  const heads: WikidataSnapshot["heads"] = [];
  for (const [role, property] of [
    ["head-of-government", "P6"],
    ["head-of-state", "P35"],
  ] as const) {
    const all = await holders(country, property);
    const valid = all.filter((h) => validAt(h, date));
    const chosen = latest(all, date);
    if (chosen === undefined) continue;
    if (new Set(valid.map((v) => v.qid)).size > 1) {
      console.log(
        `  ${role}: ${valid.length} statements valid on ${date}, kept ${chosen.qid} (start ${chosen.start ?? "undated"})`,
      );
    }
    heads.push({ role, person: await person(chosen.qid, date) });
  }
  return heads;
}

async function fetchParty(qid: string, date: string): Promise<WikidataParty> {
  const rows = await sparql(`
SELECT ?partyFr ?partyEn ?ideology ?ideologyFr ?ideologyEn WHERE {
  BIND(wd:${qid} AS ?party)
  ${LABELS("?party")}
  OPTIONAL { ?party wdt:P1142 ?ideology ${LABELS("?ideology")} }
}`);
  const party: WikidataParty = {
    qid,
    label: qid,
    ideologies: [],
    leader: null,
  };
  for (const b of rows) {
    party.label = b.partyFr?.value ?? b.partyEn?.value ?? qid;
    if (b.ideology !== undefined) {
      const id = qidOf(b.ideology.value);
      if (!party.ideologies.some((i) => i.qid === id)) {
        party.ideologies.push({ qid: id, label: label(b, "ideology") });
      }
    }
  }
  party.ideologies.sort((a, b) => a.qid.localeCompare(b.qid));
  // Chair (P488) at the date; co-chairs: the preferred one, then the one
  // who started last.
  // A chair who died before the date is skipped (a statement never closed
  // after the death), and the next valid one taken.
  const chairs = await holders(qid, "P488");
  const valid = chairs.filter((c) => validAt(c, date));
  party.leader = null;
  const tried: string[] = [];
  while (party.leader === null) {
    const chair = latest(
      chairs.filter((c) => !tried.includes(c.qid)),
      date,
    );
    if (chair === undefined) break;
    tried.push(chair.qid);
    const p = await person(chair.qid, date);
    if (p.died !== null && p.died !== undefined && p.died <= date) {
      console.log(`  ${qid} chair ${p.label} died ${p.died}: skipped`);
      continue;
    }
    party.leader = p;
  }
  if (valid.length > 1) {
    console.log(
      `  ${qid} chairs valid on ${date}: ${valid.map((c) => `${c.qid}${c.rank.endsWith("PreferredRank") ? "*" : ""}@${c.start ?? "?"}`).join(", ")} -> ${party.leader?.qid ?? "none"}`,
    );
  }
  return party;
}

// Labels of items the SPARQL label lookup left empty (it happens for some
// heavily edited items): the entity API, French then English.
async function fillLabels(snapshot: WikidataSnapshot): Promise<void> {
  const people: WikidataPerson[] = [
    ...snapshot.heads.map((h) => h.person),
    ...snapshot.parties.flatMap((p) => (p.leader === null ? [] : [p.leader])),
  ];
  const missing = people.filter((p) => p.label === p.qid);
  if (missing.length === 0) return;
  const ids = [...new Set(missing.map((p) => p.qid))].join("|");
  // Some items carry no label at all (only sitelinks): the Wikipedia title.
  const url = `${SEARCH_URL}?action=wbgetentities&format=json&props=labels|sitelinks&languages=fr|en&sitefilter=frwiki|enwiki&ids=${ids}`;
  const response = await request(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  const json = (await response.json()) as {
    entities: Record<
      string,
      {
        labels?: Record<string, { value: string }>;
        sitelinks?: Record<string, { title: string }>;
      }
    >;
  };
  for (const person of missing) {
    const entity = json.entities[person.qid] ?? {};
    const labels = entity.labels ?? {};
    const links = entity.sitelinks ?? {};
    person.label =
      labels.fr?.value ??
      labels.en?.value ??
      links.frwiki?.title ??
      links.enwiki?.title ??
      person.qid;
  }
}

export async function fetchWikidata(
  countries: readonly string[],
  // Start of the scenario: the date every mandate is read at.
  referenceDate: string,
): Promise<void> {
  const parties = JSON.parse(
    fs.readFileSync(PARTIES_FILE, "utf8"),
  ) as PartiesFile;
  fs.mkdirSync(path.join(SNAPSHOT_DIR, "wikidata"), { recursive: true });
  const lock = readLock();
  const fetchedAt = new Date().toISOString().slice(0, 10);
  for (const nation of countries) {
    const entry = parties.nations[nation];
    if (entry === undefined) throw new Error(`parties.json: no ${nation}`);
    console.log(`${nation} (${entry.wikidataCountry})`);
    for (const party of entry.parties) {
      // J6: a party Wikidata does not know is left out (logged), not fatal.
      try {
        party.qid = await resolveParty(party, entry.wikidataCountry);
      } catch (error) {
        console.log(`  ${party.label}: ${(error as Error).message}, skipped`);
      }
    }
    const snapshot: WikidataSnapshot = {
      nation,
      country: entry.wikidataCountry,
      referenceDate,
      fetchedAt,
      license: "CC0 1.0, Wikidata",
      heads: await fetchHeads(entry.wikidataCountry, referenceDate),
      parties: [],
    };
    for (const party of entry.parties) {
      if (party.qid === undefined) continue;
      snapshot.parties.push(await fetchParty(party.qid, referenceDate));
    }
    // The resolved QIDs after every nation too (J6: a long run).
    fs.writeFileSync(PARTIES_FILE, JSON.stringify(parties, null, 2) + "\n");
    await fillLabels(snapshot);
    const text = JSON.stringify(snapshot, null, 1) + "\n";
    fs.writeFileSync(wikidataSnapshot(nation), text);
    lock[`snapshots/wikidata/${nation.toLowerCase()}.json`] = jsonSha256(text);
    // The lock after every nation: an interrupted run keeps what it fetched.
    fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2) + "\n");
    console.log(
      `  heads: ${snapshot.heads.map((h) => `${h.role}=${h.person.label}`).join(", ")}; parties: ${snapshot.parties.map((p) => `${p.label} [${p.ideologies.length} ideologies, leader ${p.leader?.label ?? "?"}]`).join("; ")}`,
    );
  }
  fs.writeFileSync(PARTIES_FILE, JSON.stringify(parties, null, 2) + "\n");
  fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2) + "\n");
}

// The sha256 of snapshots already on disk, into the lock: for a run that
// wrote them and was cut off before its lock (before the lock was written
// after every nation).
export function relockWikidata(countries: readonly string[]): void {
  const lock = readLock();
  for (const nation of countries) {
    const text = fs.readFileSync(wikidataSnapshot(nation), "utf8");
    lock[`snapshots/wikidata/${nation.toLowerCase()}.json`] = jsonSha256(text);
  }
  fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2) + "\n");
}

// Offline: the snapshots, sha256 checked against the lock.
export function loadWikidata(
  lock: Lock,
  countries: readonly string[],
): Record<string, WikidataSnapshot> {
  const out: Record<string, WikidataSnapshot> = {};
  for (const nation of countries) {
    const file = wikidataSnapshot(nation);
    const key = `snapshots/wikidata/${nation.toLowerCase()}.json`;
    const text = fs.readFileSync(file, "utf8");
    if (jsonSha256(text) !== lock[key]) {
      throw new Error(`${key}: sha256 does not match sources.lock.json`);
    }
    out[nation] = JSON.parse(text) as WikidataSnapshot;
  }
  return out;
}
