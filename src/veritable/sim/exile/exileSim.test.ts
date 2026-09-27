import { loadVeritableConfig } from "../../data/loadConfig";
import { VeritableConfig } from "../../data/schemas/config";
import { NationData } from "../../data/schemas/nation";
import {
  DiplomacyState,
  ExileSection,
  PeaceOffer,
  PoliticsState,
  War,
} from "../../data/schemas/save";
import { decodeSave, encodeSave } from "../../save/serialize";
import { setRelation } from "../diplomacy/diplomacy";
import { MemoryWorld } from "../testing/MemoryWorld";
import { testNation, testScenario } from "../testing/nations";
import { testSimData } from "../testing/simData";
import { VeritableSimImpl } from "../VeritableSimImpl";
import { proposePeace } from "../war/peace";

// Collapse, exile, return and last stand in the simulation (J7c).

const DAY = 1440;

function quietConfig(): VeritableConfig {
  const config = structuredClone(loadVeritableConfig());
  config.economy.growth.noiseMonthlySd = 0;
  config.economy.rowSupplyNoise.monthlySd = 0;
  config.politics.aiShock.sd = 0;
  config.politics.coups.militaryScale = 0;
  config.politics.leaders.deathBase = 0;
  // The fronts do not move: these tests are about the exile.
  config.war.v0 = 0;
  return config;
}

// Four nations side by side, 10 columns each, the first of `ids` played.
function campaign(ids: string[], config: VeritableConfig = quietConfig()) {
  const sheets = new Map<string, NationData>(
    ids.map((id) => {
      const sheet = testNation(id);
      // DDD is small: a nation a last stand may take.
      if (id === "DDD") sheet.population = { ...sheet.population, value: 5e6 };
      return [id, sheet];
    }),
  );
  const world = new MemoryWorld(40, 10);
  const columns: Record<string, number> = { CCC: 0, AAA: 1, BBB: 2, DDD: 3 };
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 40; x++) {
      const id = Object.keys(columns).find(
        (k) => columns[k] === Math.floor(x / 10),
      )!;
      world.setOwner(y * 40 + x, id);
    }
  }
  // These owners are the first day (the homelands).
  world.setClaims(new Map());
  const scenario = testScenario(ids);
  const sim = new VeritableSimImpl({
    config,
    world,
    data: testSimData(ids),
    nationData: (id) => sheets.get(id),
    scenario,
  });
  sim.init(scenario, 3);
  const internals = sim as unknown as {
    diplomacy: DiplomacyState;
    exile: ExileSection;
    sign(war: War, offer: PeaceOffer, date: string): void;
  };
  const days = (n: number) => {
    for (let d = 0; d < n; d++) sim.advance(DAY);
  };
  const status = (id: string) =>
    sim.read().nations.find((n) => n.id === id)!.status;
  return { sim, world, internals, days, status };
}

describe("an annexed nation (J7c)", () => {
  it("goes into exile, lives on with a friend at war with its annexer, and gets its land back at the peace", () => {
    const config = quietConfig();
    // The recognition of the annexation is exile.test.ts's: here only
    // R + S counts.
    config.exile.annexationRecognized = 1;
    const { sim, world, internals, days, status } = campaign(
      ["CCC", "AAA", "BBB", "DDD"],
      config,
    );
    world.transferAll("BBB", "AAA");
    days(1);
    expect(status("BBB")).toBe("exiled");
    const exile = internals.exile.nations.BBB;
    expect(exile.annexer).toBe("AAA");
    expect(exile.recognizers).toContain("CCC");
    // The resistance weighs on the occupant (half its land is BBB's).
    expect(sim.read().resistance.AAA).toBe(config.exile.resistance.cap);

    sim.apply({ type: "declare-war", target: "AAA", casusBelli: "none" });
    // CCC stays BBB's friend two years (a war without casus belli costs it
    // relations with everyone every month: the test keeps the friendship).
    for (let m = 0; m < 24; m++) {
      setRelation(internals.diplomacy, "CCC", "BBB", 70);
      days(30);
    }
    expect(status("BBB")).toBe("exiled");
    expect(internals.exile.nations.BBB.support).toBeGreaterThan(0);

    // CCC takes back half of BBB's land from AAA, then peace.
    const taken: number[] = [];
    for (let y = 0; y < 10; y++) {
      for (let x = 20; x < 25; x++) taken.push(y * 40 + x);
    }
    for (const t of taken) world.setOwner(t, "CCC");
    const war = internals.diplomacy.wars.find((w) =>
      w.aggressors.includes("CCC"),
    )!;
    const offer = proposePeace(
      internals.diplomacy,
      war,
      "CCC",
      "AAA",
      {
        kind: "ceasefire",
        reparationsPctGdp: 0,
        reparationYears: 0,
        maxDivisions: null,
      },
      sim.read().date,
    );
    internals.sign(war, offer, sim.read().date);
    expect(taken.every((t) => world.ownerOf(t) === "BBB")).toBe(true);
    days(1);
    expect(status("BBB")).toBe("active");
    const back = sim.read().journal.filter((j) => j.kind === "exile-returned");
    expect(back).toHaveLength(1);
    expect(back[0].params).toMatchObject({ way: "liberation", by: "CCC" });
    expect(internals.exile.nations.BBB).toBeUndefined();
  });

  it("holds no national election while in exile", () => {
    const { sim, world, days, status } = campaign(["CCC", "AAA", "BBB", "DDD"]);
    world.transferAll("BBB", "AAA");
    days(1);
    expect(status("BBB")).toBe("exiled");
    const politics = (sim as unknown as { politics: PoliticsState }).politics
      .nations.BBB;
    politics.nextElection = sim.read().date;
    days(40);
    const mine = sim.read().journal.filter((j) => j.nation === "BBB");
    expect(mine.some((j) => j.kind === "election-held")).toBe(false);
    expect(
      mine.find((j) => j.kind === "elections-suspended")?.params.until,
    ).toBe("exile");
  });

  it("without support, is dissolved within one to three years; the player goes on with a small nation, and a save keeps it", () => {
    const { sim, world, internals, status } = campaign([
      "BBB",
      "AAA",
      "CCC",
      "DDD",
    ]);
    world.transferAll("BBB", "AAA");
    sim.advance(DAY);
    expect(status("BBB")).toBe("exiled");
    let months = 0;
    while (status("BBB") === "exiled" && months < 48) {
      for (let d = 0; d < 30; d++) sim.advance(DAY);
      months++;
    }
    expect(status("BBB")).toBe("dissolved");
    expect(months).toBeGreaterThanOrEqual(12);
    expect(months).toBeLessThanOrEqual(36);
    expect(internals.exile.nations.BBB.dissolvedAt).not.toBeNull();
    // Alive, fewer than ten million people, not the annexer.
    expect(sim.read().lastStandChoices).toEqual(["DDD"]);
    expect(() => sim.apply({ type: "last-stand", nation: "AAA" })).toThrow();

    sim.apply({ type: "last-stand", nation: "DDD" });
    const view = sim.read();
    expect(view.playerNation).toBe("DDD");
    expect(view.politics.DDD.groups).not.toBeNull();
    expect(view.journal[view.journal.length - 1]).toMatchObject({
      kind: "last-stand",
      nation: "DDD",
      params: { from: "BBB" },
    });
    // Saved and reloaded: the same world, the journal intact.
    const save = decodeSave(encodeSave(sim.snapshot()));
    const again = new VeritableSimImpl({
      config: quietConfig(),
      world: new MemoryWorld(40, 10),
      data: testSimData(["BBB", "AAA", "CCC", "DDD"]),
      nationData: (id) => testNation(id),
    });
    again.restore(save);
    expect(again.read().playerNation).toBe("DDD");
    expect(again.read().journal).toEqual(view.journal);
    expect(again.read().exile.lastStands).toEqual([
      { date: view.date, from: "BBB", to: "DDD" },
    ]);
  });
});
