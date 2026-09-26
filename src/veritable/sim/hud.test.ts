import { loadVeritableConfig } from "../data/loadConfig";
import { NationData } from "../data/schemas/nation";
import { BlocProposal, BlocsState } from "../data/schemas/save";
import { MemoryWorld } from "./testing/MemoryWorld";
import { testNation, testScenario } from "./testing/nations";
import { testBloc, testSimData } from "./testing/simData";
import { VeritableSimImpl } from "./VeritableSimImpl";

// J7: the view of the always-visible interface (top bar, event cards), read
// four times a second: the version, the player's decisions and votes, its
// neighbours and allies, and the journal entries it has not seen yet.

function campaign() {
  const ids = ["AAA", "BBB", "CCC", "DDD"];
  const blocs = [
    testBloc({
      id: "union",
      type: "military-alliance",
      members: [
        { nation: "AAA", status: "full" },
        { nation: "BBB", status: "full" },
        { nation: "CCC", status: "full" },
      ],
    }),
  ];
  const sheets = new Map<string, NationData>(
    ids.map((id) => [
      id,
      testNation(id, { blocs: id === "DDD" ? [] : ["union"] }),
    ]),
  );
  const config = structuredClone(loadVeritableConfig());
  config.economy.growth.noiseMonthlySd = 0;
  const sim = new VeritableSimImpl({
    config,
    world: new MemoryWorld(4, 4),
    data: testSimData(ids, {
      blocs,
      landNeighbours: [
        ["AAA", "DDD"],
        ["BBB", "CCC"],
      ],
    }),
    nationData: (id) => sheets.get(id),
  });
  sim.init(testScenario(ids), 3);
  return sim;
}

describe("the view of the always-visible interface (J7)", () => {
  it("names the player's land neighbours, allies and enemies, and its blocs", () => {
    const sim = campaign();
    const hud = sim.hud();
    expect(hud.playerNation).toBe("AAA");
    expect(hud.neighbours).toEqual(["DDD"]);
    expect(hud.allies).toEqual(["BBB", "CCC"]);
    expect(hud.enemies).toEqual([]);
    expect(hud.blocs).toEqual(["union"]);
    expect(hud.version).toBe(sim.read().version);
    expect(hud.date).toBe("2026-01-01");
  });

  it("gives the journal entries added since a mark, and only those", () => {
    const sim = campaign();
    const first = sim.hud();
    expect(first.journal).toEqual([]);
    sim.apply({ type: "declare-war", target: "DDD", casusBelli: "none" });
    const second = sim.hud(first.journalMark);
    expect(second.journal.map((j) => j.kind)).toContain("war-declared");
    expect(second.journalMark).toBeGreaterThan(first.journalMark);
    expect(sim.hud(second.journalMark).journal).toEqual([]);
    expect(sim.hud(second.journalMark).enemies).toEqual(["DDD"]);
  });

  it("lists the bloc votes that await the player's voice", () => {
    const sim = campaign();
    const blocs = (sim as unknown as { blocs: BlocsState }).blocs;
    const proposal: BlocProposal = {
      id: blocs.nextProposal++,
      bloc: "union",
      by: "BBB",
      kind: "sanctions",
      target: "DDD",
      direction: null,
      date: "2026-01-01",
      resolveOn: "2026-01-31",
      cast: {},
      result: "pending",
      votes: {},
    };
    blocs.proposals.push(proposal);
    expect(sim.hud().votes.map((v) => v.id)).toEqual([proposal.id]);
    sim.apply({ type: "bloc-vote", proposal: proposal.id, vote: "yes" });
    expect(sim.hud().votes).toEqual([]);
  });
});
