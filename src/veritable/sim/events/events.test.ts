import { loadVeritableConfig } from "../../data/loadConfig";
import { VeritableConfig } from "../../data/schemas/config";
import { EventSchema, VeritableEvent } from "../../data/schemas/event";
import { NationData } from "../../data/schemas/nation";
import { EventsState, PoliticsState } from "../../data/schemas/save";
import { decodeSave, encodeSave } from "../../save/serialize";
import { availableCasusBelli } from "../diplomacy/diplomacy";
import { addMonths } from "../politics/state";
import { MemoryWorld } from "../testing/MemoryWorld";
import { testNation, testScenario } from "../testing/nations";
import { testSimData } from "../testing/simData";
import { addDays } from "../time";
import { SimEvent } from "../VeritableSim";
import { VeritableSimImpl } from "../VeritableSimImpl";

const DAY = 1440;

function quietConfig(): VeritableConfig {
  const config = structuredClone(loadVeritableConfig());
  config.economy.growth.noiseMonthlySd = 0;
  config.economy.rowSupplyNoise.monthlySd = 0;
  return config;
}

const event = (
  e: Partial<VeritableEvent> & Pick<VeritableEvent, "id">,
): VeritableEvent =>
  EventSchema.parse({
    kind: "scripted",
    title: `event.${e.id}.title`,
    text: `event.${e.id}.text`,
    scope: "nation",
    trigger: { monthlyProbability: 1, conditions: [] },
    choices: [
      {
        id: "pay",
        label: `event.${e.id}.pay`,
        effects: [{ target: "budget.pctGdp", op: "add", value: -0.01 }],
      },
      {
        id: "ignore",
        label: `event.${e.id}.ignore`,
        effects: [{ target: "unrest", op: "set", value: 1 }],
      },
    ],
    pause: true,
    journal: true,
    ...e,
  });

// A template that never fires by itself: only the floor draws it.
const rare = (
  id: string,
  conditions: VeritableEvent["trigger"]["conditions"],
): VeritableEvent =>
  event({
    id,
    kind: "template",
    trigger: { monthlyProbability: 1e-12, cooldownMonths: 1, conditions },
  });

// The first of `ids` plays (AAA by default).
function campaign(options: {
  events: VeritableEvent[];
  autopilot?: boolean;
  landNeighbours?: [string, string][];
  config?: VeritableConfig;
  ids?: string[];
}) {
  const ids = options.ids ?? ["AAA", "BBB", "CCC"];
  const sheets = new Map<string, NationData>(
    ids.map((id) => [id, testNation(id)]),
  );
  const scenario = testScenario(ids);
  const deps = {
    config: options.config ?? quietConfig(),
    world: new MemoryWorld(4, 4),
    data: testSimData(ids, {
      events: options.events,
      landNeighbours: options.landNeighbours,
    }),
    nationData: (id: string) => sheets.get(id),
    scenario,
    autopilot: options.autopilot,
  };
  const sim = new VeritableSimImpl(deps);
  sim.init(scenario, 5);
  const events: SimEvent[] = [];
  const months = (n: number) => {
    for (let i = 0; i < n; i++) {
      const month = sim.read().date.slice(0, 7);
      while (sim.read().date.slice(0, 7) === month) {
        events.push(
          ...sim.advance(DAY).filter((e) => e.type !== "day-started"),
        );
      }
    }
  };
  return { sim, months, events, deps };
}

describe("events", () => {
  it("a scripted event happens once, in its window, for the nations it lists that meet its conditions; the AI chooses", () => {
    const { sim, months } = campaign({
      events: [
        event({
          id: "loan",
          trigger: {
            dateRange: ["2026-03-01", "2026-12-31"],
            nations: ["BBB", "CCC"],
            monthlyProbability: 1,
            conditions: [{ target: "debtToGdp", op: "lt", value: 0.6 }],
          },
        }),
      ],
    });
    const debt0 = sim.read().economies.BBB.debt;
    months(1); // February: before the window
    expect(sim.read().events.history).toEqual([]);
    months(11);
    const history = sim.read().events.history;
    expect(history.map((h) => h.nation).sort()).toEqual(["BBB", "CCC"]);
    // The AI pays rather than face unrest.
    expect(history.every((h) => h.choice === "pay")).toBe(true);
    // J7: a sure event (probability 1 a month) falls on a day of its first
    // month drawn with the seed, no longer on the 1st.
    expect(history.every((h) => h.date.startsWith("2026-03-"))).toBe(true);
    expect(sim.read().economies.BBB.debt).toBeGreaterThan(debt0);
    expect(
      sim.read().journal.filter((j) => j.kind === "event-occurred").length,
    ).toBe(2);
  });

  it("unrest takes at most 0.2 of a stable democracy's legitimacy, all it needs of a fragile nation's (J7c)", () => {
    const config = quietConfig();
    config.politics.coups.militaryScale = 0;
    const riot = event({
      id: "riot",
      trigger: {
        nations: ["BBB", "CCC"],
        monthlyProbability: 1,
        conditions: [],
      },
      effects: [{ target: "unrest", op: "set", value: 1 }],
      choices: [
        { id: "calm", label: "event.riot.calm", effects: [] },
        { id: "wait", label: "event.riot.wait", effects: [] },
      ],
    });
    const { sim, months } = campaign({
      events: [riot],
      autopilot: true,
      config,
    });
    const nations = (sim as unknown as { politics: PoliticsState }).politics
      .nations;
    // CCC is no democracy: fragile in the sense of the cap.
    nations.CCC.regime = "electoral-authoritarian";
    const before = {
      BBB: nations.BBB.legitimacy,
      CCC: nations.CCC.legitimacy,
    };
    months(1);
    expect(
      sim
        .read()
        .events.history.map((h) => h.nation)
        .sort(),
    ).toEqual(["BBB", "CCC"]);
    expect(nations.BBB.legitimacy).toBeCloseTo(before.BBB - 0.2, 9);
    expect(before.CCC - nations.CCC.legitimacy).toBeGreaterThan(0.2);
  });

  it("the player gets a pop-up that asks to pause; two a month at most; the choice applies; unanswered, the government decides", () => {
    const { sim, months, events } = campaign({
      events: ["one", "two", "three"].map((id) =>
        event({
          id,
          trigger: {
            nations: ["AAA"],
            monthlyProbability: 1,
            conditions: [],
          },
        }),
      ),
    });
    months(1);
    const popups = events.filter((e) => e.type === "event-popup");
    expect(popups.length).toBe(2);
    expect(popups.every((e) => e.type === "event-popup" && e.pause)).toBe(true);
    // J7: each falls on a day of the month drawn with the seed; the first
    // two of the month are shown, the third waits.
    const pending = [...sim.read().events.pending];
    expect(pending).toHaveLength(2);
    const third = ["one", "two", "three"].find(
      (id) => !pending.some((p) => p.event === id),
    )!;
    const opinion = sim.read().politics.AAA.opinion;
    const legitimacy = sim.read().politics.AAA.legitimacy;
    sim.apply({ type: "event-choose", id: pending[0].id, choice: "ignore" });
    expect(sim.read().politics.AAA.opinion).toBeLessThan(opinion - 0.2);
    // J7c: unrest takes at most 0.2 of legitimacy (it took it all).
    expect(sim.read().politics.AAA.legitimacy).toBeCloseTo(legitimacy - 0.2, 9);
    // The third one comes next month; the unanswered second is decided by
    // the government after 30 days (it pays rather than face unrest).
    months(1);
    const history = sim
      .read()
      .events.history.map((h) => `${h.event}:${h.choice}`);
    expect(history).toEqual([
      `${pending[0].event}:ignore`,
      `${pending[1].event}:pay`,
    ]);
    expect(sim.read().events.pending.map((p) => p.event)).toEqual([third]);
    expect(
      sim
        .read()
        .journal.filter((j) => j.kind === "event-occurred")
        .map((j) => j.params.by),
    ).toEqual(["player", "government"]);
  });

  it("the government leans from the first day, never enacts a law outside its window, and decides after 30 days (J7)", () => {
    const reform = event({
      id: "pension-crisis",
      trigger: { nations: ["AAA"], monthlyProbability: 1, conditions: [] },
      choices: [
        {
          id: "reform",
          label: "event.pension-crisis.reform",
          effects: [
            { target: "law.pension-age-raise", op: "add", value: 1 },
            { target: "stability", op: "add", value: 0.05 },
          ],
        },
        {
          id: "wait",
          label: "event.pension-crisis.wait",
          effects: [{ target: "budget.pctGdp", op: "add", value: -0.001 }],
        },
      ],
    });
    const { sim, months } = campaign({ events: [reform] });
    const government = (
      sim as unknown as {
        politics: {
          nations: Record<string, { government: { ideology: object } }>;
        };
      }
    ).politics.nations.AAA.government;
    months(1);
    const [pending] = sim.read().events.pending;
    expect(pending.event).toBe("pension-crisis");
    // A government of the right: the reform is in its window, and worth more.
    government.ideology = { economic: 0.6, authority: 0, sovereignty: 0 };
    expect(sim.read().eventLeanings[pending.id]).toBe("reform");
    // A government of the left: raising the pension age is outside its
    // window, whatever it is worth; it waits.
    government.ideology = { economic: -0.6, authority: 0, sovereignty: 0 };
    expect(sim.read().eventLeanings[pending.id]).toBe("wait");
    // Unanswered for 30 days: the government decides as it leans, and the
    // journal says so.
    for (let d = 0; d < 31; d++) sim.advance(DAY);
    expect(sim.read().events.pending).toEqual([]);
    const done = sim.read().events.history.find((h) => h.id === pending.id)!;
    expect(done.choice).toBe("wait");
    const entry = sim
      .read()
      .journal.find(
        (j) =>
          j.kind === "event-occurred" &&
          j.params.instance === String(pending.id),
      )!;
    expect(entry.params.by).toBe("government");
  });

  it("an AI nation chooses its own events by its leader, not by the ideology of its government (J7a.7)", () => {
    const config = quietConfig();
    config.events.aiMistakeProbability = 0;
    const incident = event({
      id: "frontier-incident",
      kind: "template",
      trigger: {
        nations: ["AAA"],
        monthlyProbability: 1,
        conditions: [],
        cooldownMonths: 100,
      },
      params: { other: "neighbor" },
      choices: [
        {
          id: "escalate",
          label: "event.frontier-incident.escalate",
          effects: [
            { target: "grievance.other", op: "set", value: 1, months: 12 },
          ],
        },
        {
          id: "calm",
          label: "event.frontier-incident.calm",
          effects: [],
        },
      ],
    });
    const { sim, months } = campaign({
      events: [incident],
      autopilot: true,
      landNeighbours: [["AAA", "BBB"]],
      config,
    });
    const politics = (
      sim as unknown as {
        politics: {
          nations: Record<
            string,
            {
              government: { parties: string[] };
              parties: { id: string; ideology: object }[];
              leader: { traits: { aggressiveness: number } };
            }
          >;
        };
      }
    ).politics.nations.AAA;
    // A sovereignist government under a leader of little aggressiveness.
    const lead = politics.parties.find(
      (p) => p.id === politics.government.parties[0],
    )!;
    lead.ideology = { economic: 0, authority: 0.5, sovereignty: 1 };
    politics.leader.traits.aggressiveness = 0.45;
    months(1);
    const done = sim
      .read()
      .events.history.find((h) => h.event === "frontier-incident")!;
    expect(done.choice).toBe("calm");
  });

  it("a template draws a neighbour and gives a grievance: a casus belli until it expires", () => {
    const { sim, months, deps } = campaign({
      autopilot: true,
      landNeighbours: [["AAA", "BBB"]],
      events: [
        event({
          id: "border-incident",
          kind: "template",
          trigger: {
            nations: ["AAA"],
            monthlyProbability: 1,
            conditions: [],
            cooldownMonths: 100,
          },
          params: { other: "neighbor" },
          choices: [
            {
              id: "escalate",
              label: "event.border-incident.escalate",
              effects: [
                { target: "grievance.other", op: "set", value: 1, months: 6 },
                { target: "relations.other", op: "add", value: -15 },
              ],
            },
          ],
        }),
      ],
    });
    months(1);
    const read = () => sim.read();
    // Six months from the day it fell on (a day of January drawn with the
    // seed, J7).
    const fell = read().events.history[0].date;
    expect(fell.startsWith("2026-01-")).toBe(true);
    expect(read().diplomacy.grievances).toEqual([
      { by: "AAA", against: "BBB", until: addMonths(fell, 6) },
    ]);
    const internals = sim as unknown as {
      ctx: Parameters<typeof availableCasusBelli>[0];
      diplomacy: Parameters<typeof availableCasusBelli>[1];
      politics: Parameters<typeof availableCasusBelli>[2];
    };
    const casus = () =>
      availableCasusBelli(
        internals.ctx,
        internals.diplomacy,
        internals.politics,
        deps.scenario,
        "AAA",
        "BBB",
      );
    expect(casus()).toContain("grievance");
    months(7);
    expect(read().diplomacy.grievances).toEqual([]);
    expect(casus()).not.toContain("grievance");
    // The cooldown holds it back.
    expect(read().events.history.length).toBe(1);
  });

  it("a tense-neighbour incident falls on a hostile land neighbour, never on a friendly one, and does not fire without one (J6c)", () => {
    const incident = event({
      id: "border-incident",
      kind: "template",
      trigger: {
        nations: ["AAA"],
        monthlyProbability: 1,
        conditions: [],
        cooldownMonths: 100,
      },
      params: { other: "tense-neighbor" },
      choices: [
        {
          id: "escalate",
          label: "event.border-incident.escalate",
          effects: [
            { target: "grievance.other", op: "set", value: 1, months: 6 },
          ],
        },
      ],
    });
    const neighbours: [string, string][] = [
      ["AAA", "BBB"],
      ["AAA", "CCC"],
    ];
    const hostile = campaign({
      autopilot: true,
      landNeighbours: neighbours,
      events: [incident],
    });
    const internals = hostile.sim as unknown as {
      diplomacy: { relations: Record<string, Record<string, number>> };
    };
    internals.diplomacy.relations.AAA.CCC = -50;
    hostile.months(1);
    const fell = hostile.sim.read().events.history[0].date;
    expect(hostile.sim.read().diplomacy.grievances).toEqual([
      { by: "AAA", against: "CCC", until: addMonths(fell, 6) },
    ]);
    // No tense border: the incident does not happen.
    const calm = campaign({
      autopilot: true,
      landNeighbours: neighbours,
      events: [incident],
    });
    calm.months(3);
    expect(calm.sim.read().events.history).toEqual([]);
  });

  it("the conditions of the new systems (J7c): a threat its intelligence detects, a contaminated land", () => {
    const { sim, months } = campaign({
      autopilot: true,
      events: [
        event({
          id: "intelligence-war-warning",
          kind: "template",
          trigger: {
            monthlyProbability: 1,
            conditions: [{ target: "threatened", op: "eq", value: 1 }],
            cooldownMonths: 100,
          },
          params: { other: "threat" },
        }),
        event({
          id: "contaminated-food-scare",
          kind: "template",
          trigger: {
            monthlyProbability: 1,
            conditions: [{ target: "contamination", op: "gt", value: 0.05 }],
            cooldownMonths: 100,
          },
        }),
      ],
    });
    const internals = sim as unknown as {
      ai: { nations: Record<string, { intent: unknown }> };
      economy: { nations: Record<string, { contamination: number }> };
    };
    // BBB's AI weighs a war against AAA (its reviews would forget it: the
    // test holds it), CCC's land is contaminated.
    for (let day = 0; day < 31; day++) {
      internals.ai.nations.BBB.intent = {
        target: "AAA",
        casusBelli: "none",
        ratio: 2,
        date: "2026-01-01",
      };
      internals.economy.nations.CCC.contamination = 0.2;
      sim.advance(DAY);
    }
    months(1);
    const history = sim.read().events.history;
    const warning = history.filter(
      (h) => h.event === "intelligence-war-warning",
    );
    expect(warning.map((h) => [h.nation, h.other])).toEqual([["AAA", "BBB"]]);
    const scare = history.filter((h) => h.event === "contaminated-food-scare");
    expect(scare.map((h) => h.nation)).toEqual(["CCC"]);
  });

  it("a world event happens once and moves the world's supply", () => {
    const { sim, months } = campaign({
      autopilot: true,
      events: [
        event({
          id: "monsoon",
          scope: "world",
          worldEffects: [
            { target: "worldSupply.food", op: "add", value: -0.1 },
          ],
        }),
      ],
    });
    const shock = sim.read().market.rowSupplyShock.food;
    months(1);
    expect(sim.read().market.rowSupplyShock.food).toBeLessThan(shock - 0.05);
    months(3);
    expect(
      sim.read().journal.filter((j) => j.kind === "event-occurred").length,
    ).toBe(1);
  });

  it("the nation of the player never goes playerFloorDays without a decision, played or in autopilot, whichever it is: one of its templates, never one its conditions forbid (J7c)", () => {
    const floor = loadVeritableConfig().events.playerFloorDays;
    for (const [autopilot, ids] of [
      [false, ["AAA", "BBB", "CCC"]],
      [true, ["AAA", "BBB", "CCC"]],
      [false, ["CCC", "AAA", "BBB"]],
    ] as const) {
      const me = ids[0];
      const { sim } = campaign({
        autopilot,
        ids: [...ids],
        events: [
          rare("quiet", []),
          rare("never", [{ target: "debtToGdp", op: "gt", value: 100 }]),
        ],
      });
      // The floor counts from the first draw of the player's nation.
      sim.advance(DAY);
      const counted = (sim as unknown as { events: EventsState }).events
        .lastDecision;
      expect(counted?.nation).toBe(me);
      const due = addDays(counted!.date, floor);
      const all = () => [
        ...sim.read().events.history,
        ...sim.read().events.pending,
      ];
      // The first on the day the floor is reached, for the player alone:
      // a template of the data, no filler.
      while (sim.read().date <= due) sim.advance(DAY);
      expect(all().map((h) => [h.nation, h.event, h.date])).toEqual([
        [me, "quiet", due],
      ]);
      // Then again `floor` days after that decision.
      const next = addDays(due, floor);
      while (sim.read().date <= next) sim.advance(DAY);
      expect(all().map((h) => [h.nation, h.event, h.date])).toEqual([
        [me, "quiet", due],
        [me, "quiet", next],
      ]);
    }
  });

  it("the floor waits when the two decisions of the player's month are spent (J7c)", () => {
    const { sim } = campaign({ events: [rare("quiet", [])] });
    sim.advance(DAY);
    const state = (sim as unknown as { events: EventsState }).events;
    // A long silence: the floor is due, but the month's two pop-ups are gone.
    state.lastDecision = { nation: "AAA", date: "2025-01-01" };
    const month = sim.read().date.slice(0, 7);
    state.popupMonth = month;
    state.popups = loadVeritableConfig().events.maxPopupsPerMonth;
    const all = () => [
      ...sim.read().events.history,
      ...sim.read().events.pending,
    ];
    // Nothing this month; the next month, at once.
    while (sim.read().date.slice(0, 7) === month) sim.advance(DAY);
    const nextMonth = sim.read().date.slice(0, 7);
    sim.advance(DAY);
    sim.advance(DAY);
    expect(all().map((h) => [h.nation, h.event, h.date.slice(0, 7)])).toEqual([
      ["AAA", "quiet", nextMonth],
    ]);
  });

  it("the event state round-trips byte for byte", () => {
    const { sim, months, deps } = campaign({
      events: [
        event({
          id: "loan",
          trigger: { nations: ["AAA"], monthlyProbability: 1, conditions: [] },
        }),
      ],
    });
    months(1);
    const bytes = encodeSave(sim.snapshot());
    const again = new VeritableSimImpl(deps);
    again.restore(decodeSave(bytes));
    expect(encodeSave(again.snapshot())).toEqual(bytes);
    expect(again.read().events.pending.length).toBe(1);
  });
});
