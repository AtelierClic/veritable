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
// Party memberships (P102) are read without an end date (P582): a former
// party is not the current one.

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PARTIES_FILE = path.join(HERE, "parties.json");
const SPARQL_URL = "https://query.wikidata.org/sparql";
const SEARCH_URL = "https://www.wikidata.org/w/api.php";
const USER_AGENT =
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
  party: string | null; // QID
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

type Binding = Record<string, { type: string; value: string }>;

const PAUSE_MS = 1500; // between requests: Wikidata rate-limits eagerly
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One request, retried with backoff on 429 / 5xx.
async function request(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    await sleep(PAUSE_MS);
    const response = await fetch(url, init);
    if (response.ok) return response;
    if (attempt >= 4 || (response.status < 500 && response.status !== 429)) {
      throw new Error(
        `Wikidata: HTTP ${response.status} for ${url.slice(0, 60)}`,
      );
    }
    await sleep(PAUSE_MS * 4 * (attempt + 1));
  }
}

async function sparql(query: string): Promise<Binding[]> {
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

const qidOf = (uri: string) => uri.slice(uri.lastIndexOf("/") + 1);
const dateOf = (v: string | undefined) =>
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

async function fetchHeads(country: string): Promise<WikidataSnapshot["heads"]> {
  const rows = await sparql(`
SELECT ?role ?person ?personFr ?personEn ?born ?party WHERE {
  { BIND("head-of-state" AS ?role) wd:${country} wdt:P35 ?person }
  UNION
  { BIND("head-of-government" AS ?role) wd:${country} wdt:P6 ?person }
  OPTIONAL { ?person wdt:P569 ?born }
  OPTIONAL {
    ?person p:P102 ?membership . ?membership ps:P102 ?party .
    FILTER NOT EXISTS { ?membership pq:P582 ?ended }
  }
  ${LABELS("?person")}
}`);
  const heads: WikidataSnapshot["heads"] = [];
  for (const b of rows) {
    const role = b.role.value as "head-of-state" | "head-of-government";
    const qid = qidOf(b.person.value);
    if (heads.some((h) => h.role === role && h.person.qid === qid)) continue;
    heads.push({
      role,
      person: {
        qid,
        label: label(b, "person"),
        born: dateOf(b.born?.value),
        party: b.party === undefined ? null : qidOf(b.party.value),
      },
    });
  }
  return heads.sort((a, b) => a.role.localeCompare(b.role));
}

async function fetchParty(qid: string): Promise<WikidataParty> {
  const rows = await sparql(`
SELECT ?partyFr ?partyEn ?ideology ?ideologyFr ?ideologyEn ?leader ?leaderFr ?leaderEn ?leaderBorn ?leaderParty WHERE {
  BIND(wd:${qid} AS ?party)
  ${LABELS("?party")}
  OPTIONAL { ?party wdt:P1142 ?ideology ${LABELS("?ideology")} }
  OPTIONAL {
    ?party wdt:P488 ?leader
    OPTIONAL { ?leader wdt:P569 ?leaderBorn }
    OPTIONAL {
      ?leader p:P102 ?leaderMembership . ?leaderMembership ps:P102 ?leaderParty .
      FILTER NOT EXISTS { ?leaderMembership pq:P582 ?leaderEnded }
    }
    ${LABELS("?leader")}
  }
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
    if (b.leader !== undefined && party.leader === null) {
      party.leader = {
        qid: qidOf(b.leader.value),
        label: label(b, "leader"),
        born: dateOf(b.leaderBorn?.value),
        party: b.leaderParty === undefined ? null : qidOf(b.leaderParty.value),
      };
    }
  }
  party.ideologies.sort((a, b) => a.qid.localeCompare(b.qid));
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
      party.qid = await resolveParty(party, entry.wikidataCountry);
    }
    const snapshot: WikidataSnapshot = {
      nation,
      country: entry.wikidataCountry,
      fetchedAt,
      license: "CC0 1.0, Wikidata",
      heads: await fetchHeads(entry.wikidataCountry),
      parties: [],
    };
    for (const party of entry.parties) {
      snapshot.parties.push(await fetchParty(party.qid!));
    }
    await fillLabels(snapshot);
    const text = JSON.stringify(snapshot, null, 1) + "\n";
    fs.writeFileSync(wikidataSnapshot(nation), text);
    lock[`snapshots/wikidata/${nation.toLowerCase()}.json`] = jsonSha256(text);
    console.log(
      `  heads: ${snapshot.heads.map((h) => `${h.role}=${h.person.label}`).join(", ")}; parties: ${snapshot.parties.map((p) => `${p.label} [${p.ideologies.length} ideologies, leader ${p.leader?.label ?? "?"}]`).join("; ")}`,
    );
  }
  fs.writeFileSync(PARTIES_FILE, JSON.stringify(parties, null, 2) + "\n");
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
