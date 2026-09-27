import { loadVeritableConfig } from "../../data/loadConfig";
import { Bloc } from "../../data/schemas/bloc";
import { NationId } from "../../data/schemas/common";
import { VeritableConfig } from "../../data/schemas/config";
import { EventSchema, VeritableEvent } from "../../data/schemas/event";
import { NationData } from "../../data/schemas/nation";
import {
  BlocsState,
  DiplomacyState,
  ExileSection,
  PeaceOffer,
  PoliticsState,
  War,
} from "../../data/schemas/save";
import { decodeSave, encodeSave } from "../../save/serialize";
import { claimsAgainst } from "../diplomacy/claims";
import { setRelation } from "../diplomacy/diplomacy";
import { EconomyContext } from "../economy/context";
import { MemoryWorld } from "../testing/MemoryWorld";
import {
  TestNationOptions,
  testNation,
  testScenario,
} from "../testing/nations";
import { testBloc, testSimData } from "../testing/simData";
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
function campaign(
  ids: string[],
  config: VeritableConfig = quietConfig(),
  extra: {
    events?: VeritableEvent[];
    landNeighbours?: [NationId, NationId][];
    blocs?: Bloc[];
    options?: Record<string, TestNationOptions>;
  } = {},
) {
  const sheets = new Map<string, NationData>(
    ids.map((id) => {
      const sheet = testNation(id, extra.options?.[id] ?? {});
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
    data: testSimData(ids, {
      events: extra.events,
      landNeighbours: extra.landNeighbours,
      blocs: extra.blocs,
    }),
    nationData: (id) => sheets.get(id),
    scenario,
  });
  sim.init(scenario, 3);
  const internals = sim as unknown as {
    ctx: EconomyContext;
    diplomacy: DiplomacyState;
    blocs: BlocsState;
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

  it("is beyond the reach of a war: no declaration on a government in exile under an annexer (J7c)", () => {
    const { sim, world, days, status } = campaign(["CCC", "AAA", "BBB", "DDD"]);
    world.transferAll("BBB", "AAA");
    days(1);
    expect(status("BBB")).toBe("exiled");
    expect(() =>
      sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" }),
    ).toThrow(/no land/);
    // Its annexer is in reach.
    sim.apply({ type: "declare-war", target: "AAA", casusBelli: "none" });
    expect(sim.read().diplomacy.wars).toHaveLength(1);
  });

  it("is beyond reach, on either side: no war, casus belli, claim, call to a war or border incident names it (J7c)", () => {
    // A border incident every month with a hostile land neighbour.
    const incident = EventSchema.parse({
      id: "incident",
      kind: "template",
      title: "event.incident.title",
      text: "event.incident.text",
      scope: "nation",
      trigger: { monthlyProbability: 1, cooldownMonths: 1, conditions: [] },
      params: { other: "tense-neighbor" },
      choices: [
        { id: "calm", label: "event.incident.calm", effects: [] },
        { id: "wait", label: "event.incident.wait", effects: [] },
      ],
      pause: false,
      journal: false,
    });
    // BBB and DDD are allies: an attack on DDD calls BBB.
    const pact = testBloc({
      id: "pact",
      type: "military-alliance",
      members: [
        { nation: "BBB", status: "full" },
        { nation: "DDD", status: "full" },
      ],
      collectiveDefense: {
        joinProbability: 1,
        sovereignJoinProbability: 1,
        sovereigntyAbove: 2,
      },
    });
    const ids = ["CCC", "AAA", "BBB", "DDD"];
    const { sim, world, internals, days, status } = campaign(
      ids,
      quietConfig(),
      {
        events: [incident],
        landNeighbours: [
          ["CCC", "AAA"],
          ["AAA", "BBB"],
          ["BBB", "DDD"],
        ],
        blocs: [pact],
        // The player outweighs DDD: its war without casus belli calls a
        // coalition, and BBB is DDD's ally.
        options: { CCC: { activePersonnel: 2_000_000 } },
      },
    );
    const d = internals.diplomacy;
    for (const a of ids) {
      for (const b of ids) if (a < b) setRelation(d, a, b, -80);
    }
    world.transferAll("BBB", "AAA");
    days(1);
    expect(status("BBB")).toBe("exiled");
    expect(internals.exile.nations.BBB.annexer).toBe("AAA");

    sim.apply({ type: "declare-war", target: "DDD", casusBelli: "none" });
    for (let k = 0; k < 3; k++) {
      days(30);
      // No call to the war goes to it: neither its alliance's article 5
      // nor the coalition against the player.
      expect(internals.blocs.calls.some((c) => c.nation === "BBB")).toBe(false);
      expect(d.coalitionCalls.some((c) => c.nation === "BBB")).toBe(false);
    }
    // In no war, on either side.
    for (const war of d.wars) {
      expect([...war.aggressors, ...war.defenders]).not.toContain("BBB");
    }
    // No casus belli against it, no claim on land it holds: it holds none.
    const view = sim.read();
    expect(view.casusBelli.BBB).toEqual([]);
    for (const x of ["CCC", "AAA", "DDD"]) {
      expect(claimsAgainst(internals.ctx, d, x, "BBB")).toEqual([]);
    }
    // Border incidents between the others, never with it.
    const incidents = view.events.history.filter((h) => h.event === "incident");
    expect(incidents.length).toBeGreaterThan(0);
    expect(incidents.some((h) => h.nation === "BBB" || h.other === "BBB")).toBe(
      false,
    );
  });

  it("the player in exile declares no war: no casus belli, the command refused (J7c)", () => {
    const { sim, world, days, status } = campaign(["BBB", "AAA", "CCC", "DDD"]);
    world.transferAll("BBB", "AAA");
    days(1);
    expect(status("BBB")).toBe("exiled");
    for (const id of ["AAA", "CCC", "DDD"]) {
      expect(sim.read().casusBelli[id]).toEqual([]);
    }
    expect(() =>
      sim.apply({ type: "declare-war", target: "AAA", casusBelli: "none" }),
    ).toThrow(/no land/);
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
