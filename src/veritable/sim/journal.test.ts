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
    expect(old.some((e) => e.kind === "election-held")).toBe(false);
    // The recent years are whole: elections every year.
    expect(
      journal.some((e) => e.kind === "election-held" && e.date >= "2029"),
    ).toBe(true);
  });
});
