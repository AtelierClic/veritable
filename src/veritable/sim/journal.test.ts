import { loadVeritableConfig } from "../data/loadConfig";
import { JournalEntry } from "../data/schemas/save";
import { compactJournal, entryCategory, journalCategory } from "./journal";
import { MemoryWorld } from "./testing/MemoryWorld";
import { testNation, testScenario } from "./testing/nations";
import { testSimData } from "./testing/simData";
import { VeritableSimImpl } from "./VeritableSimImpl";

// The compaction of the journal (J6c): entries older than
// save.journalFullYears game years fold into yearly summaries by nation and
// category; the turning points of a campaign stay one by one.

const entry = (
  date: string,
  kind: JournalEntry["kind"],
  nation?: string,
): JournalEntry => ({
  date,
  kind,
  ...(nation === undefined ? {} : { nation }),
  params: {},
});

describe("compactJournal", () => {
  it("folds the old entries of a year by nation and category, keeps the turning points and the recent ones", () => {
    const journal: JournalEntry[] = [
      entry("2026-01-01", "campaign-started"),
      entry("2026-03-01", "election-held", "AAA"),
      entry("2026-05-01", "government-formed", "AAA"),
      entry("2026-06-01", "sanctions-imposed", "AAA"),
      entry("2026-07-01", "election-held", "BBB"),
      entry("2026-08-01", "war-declared", "BBB"),
      entry("2027-02-01", "election-held", "AAA"),
      entry("2030-02-01", "election-held", "AAA"),
    ];
    const out = compactJournal(journal, "2028-01-01");
    expect(out.map((e) => [e.date, e.kind, e.nation, e.params])).toEqual([
      ["2026-01-01", "campaign-started", undefined, {}],
      ["2026-08-01", "war-declared", "BBB", {}],
      [
        "2026-12-31",
        "yearly-summary",
        "AAA",
        { year: "2026", category: "politics", count: "2" },
      ],
      [
        "2026-12-31",
        "yearly-summary",
        "AAA",
        { year: "2026", category: "diplomacy", count: "1" },
      ],
      [
        "2026-12-31",
        "yearly-summary",
        "BBB",
        { year: "2026", category: "politics", count: "1" },
      ],
      [
        "2027-12-31",
        "yearly-summary",
        "AAA",
        { year: "2027", category: "politics", count: "1" },
      ],
      ["2030-02-01", "election-held", "AAA", {}],
    ]);
    // A second pass changes nothing: summaries are kept as they are.
    expect(compactJournal(out, "2028-01-01")).toEqual(out);
  });

  it("files the summaries under the category of what they fold", () => {
    const [summary] = compactJournal(
      [entry("2026-06-01", "austerity-started", "AAA")],
      "2027-01-01",
    );
    expect(entryCategory(summary)).toBe("economy");
    expect(journalCategory("peace-signed")).toBe("war");
    expect(journalCategory("bloc-decision")).toBe("diplomacy");
  });
});

describe("what stays in full, what the journal screen finds (J7)", () => {
  it("the entries of the player's nation, or that name it, and the major events of the world stay one by one", () => {
    const named = (
      date: string,
      kind: JournalEntry["kind"],
      nation: string,
      params: Record<string, string>,
    ): JournalEntry => ({ date, kind, nation, params });
    const journal: JournalEntry[] = [
      entry("2026-03-01", "election-held", "AAA"),
      entry("2026-03-02", "election-held", "BBB"),
      named("2026-04-01", "sanctions-imposed", "BBB", { by: "AAA" }),
      entry("2026-05-01", "coup-attempted", "CCC"),
      entry("2026-06-01", "bloc-decision", "CCC"),
      entry("2026-07-01", "war-joined", "CCC"),
      entry("2026-08-01", "tech-completed", "CCC"),
    ];
    const out = compactJournal(journal, "2028-01-01", "AAA");
    expect(out.filter((e) => e.kind !== "yearly-summary").length).toBe(5);
    expect(
      out.filter((e) => e.kind === "yearly-summary").map((e) => e.nation),
    ).toEqual(["BBB", "CCC"]);
  });

  it("filters by scope, category, period, thread and nation, most recent first", () => {
    const ids = ["AAA", "BBB", "CCC", "DDD"];
    const sheets = new Map(ids.map((id) => [id, testNation(id)]));
    const scenario = testScenario(ids);
    const world = new MemoryWorld(4, 4);
    // AAA holds the left half, BBB the right half; CCC and DDD a tile.
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 4; x++)
        world.setOwner(y * 4 + x, x < 2 ? "AAA" : "BBB");
    }
    world.setOwner(12, "CCC");
    world.setOwner(13, "DDD");
    const sim = new VeritableSimImpl({
      config: structuredClone(loadVeritableConfig()),
      world,
      data: testSimData(ids, { landNeighbours: [["AAA", "BBB"]] }),
      nationData: (id) => sheets.get(id),
      scenario,
    });
    sim.init(scenario, 3);
    sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
    sim.apply({ type: "add-note", text: "une note" });
    const all = sim.queryJournal({ scope: { kind: "all" }, limit: 100 });
    expect(all.entries[0].kind).toBe("note");
    const war = all.entries.find((e) => e.kind === "war-declared")!;
    // A declaration of war: its place is on the border, its thread its war.
    expect(war.link).toMatch(/^war:/);
    expect(war.tile).toBe(2); // the first tile of BBB from AAA's capital (0)
    const byThread = sim.queryJournal({
      scope: { kind: "all" },
      link: war.link,
      limit: 100,
    });
    expect(byThread.entries.every((e) => e.link === war.link)).toBe(true);
    const neighbours = sim.queryJournal({
      scope: { kind: "neighbours" },
      limit: 100,
    });
    expect(neighbours.entries.map((e) => e.kind)).toContain("war-declared");
    expect(
      sim.queryJournal({
        scope: { kind: "all" },
        category: "notes",
        limit: 100,
      }).total,
    ).toBe(1);
    expect(
      sim.queryJournal({
        scope: { kind: "all" },
        nations: ["DDD"],
        limit: 100,
      }).total,
    ).toBe(0);
    expect(
      sim.queryJournal({
        scope: { kind: "all" },
        from: "2027-01-01",
        limit: 100,
      }).total,
    ).toBe(0);
    const page = sim.queryJournal({
      scope: { kind: "all" },
      offset: 1,
      limit: 1,
    });
    expect(page.entries).toEqual([all.entries[1]]);
    expect(page.total).toBe(all.total);
  });
});

describe("the journal of a long campaign (J6c)", () => {
  it("keeps journalFullYears years in full: older entries are yearly summaries or turning points", () => {
    const config = structuredClone(loadVeritableConfig());
    config.save.journalFullYears = 2;
    const ids = ["AAA", "BBB", "CCC"];
    const sheets = new Map(
      ids.map((id) => [id, testNation(id, { electionIntervalMonths: 12 })]),
    );
    const scenario = testScenario(ids);
    const sim = new VeritableSimImpl({
      config,
      world: new MemoryWorld(4, 4),
      data: testSimData(ids),
      nationData: (id) => sheets.get(id),
      scenario,
    });
    sim.init(scenario, 3);
    for (let day = 0; day < 365 * 5 + 2; day++) sim.advance(1440);
    const journal = sim.read().journal;
    expect(sim.read().date >= "2031-01-01").toBe(true);
    const old = journal.filter((e) => e.date < "2029-01-01");
    expect(old.some((e) => e.kind === "yearly-summary")).toBe(true);
    // J7: what concerns the player's nation (AAA) stays in full; the others
    // fold.
    expect(
      old.some((e) => e.kind === "election-held" && e.nation !== "AAA"),
    ).toBe(false);
    expect(
      old.some((e) => e.kind === "election-held" && e.nation === "AAA"),
    ).toBe(true);
    // The recent years are whole: elections every year.
    expect(
      journal.some((e) => e.kind === "election-held" && e.date >= "2029"),
    ).toBe(true);
  });
});
