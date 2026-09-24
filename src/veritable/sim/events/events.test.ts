import { loadVeritableConfig } from "../../data/loadConfig";
import { VeritableConfig } from "../../data/schemas/config";
import { EventSchema, VeritableEvent } from "../../data/schemas/event";
import { NationData } from "../../data/schemas/nation";
import { decodeSave, encodeSave } from "../../save/serialize";
import { availableCasusBelli } from "../diplomacy/diplomacy";
import { MemoryWorld } from "../testing/MemoryWorld";
import { testNation, testScenario } from "../testing/nations";
import { testSimData } from "../testing/simData";
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

function campaign(options: {
  events: VeritableEvent[];
  autopilot?: boolean;
  landNeighbours?: [string, string][];
  config?: VeritableConfig;
}) {
  const ids = ["AAA", "BBB", "CCC"];
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
    expect(history.every((h) => h.date === "2026-03-01")).toBe(true);
    expect(sim.read().economies.BBB.debt).toBeGreaterThan(debt0);
    expect(
      sim.read().journal.filter((j) => j.kind === "event-occurred").length,
    ).toBe(2);
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
    const pending = sim.read().events.pending;
    expect(pending.map((p) => p.event)).toEqual(["one", "two"]);
    const opinion = sim.read().politics.AAA.opinion;
    sim.apply({ type: "event-choose", id: pending[0].id, choice: "ignore" });
    expect(sim.read().politics.AAA.opinion).toBeLessThan(opinion - 0.2);
    // The third one comes next month; the unanswered second is decided.
    months(1);
    const history = sim
      .read()
      .events.history.map((h) => `${h.event}:${h.choice}`);
    expect(history).toEqual(["one:ignore", "two:pay"]);
    expect(sim.read().events.pending.map((p) => p.event)).toEqual(["three"]);
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
    expect(read().diplomacy.grievances).toEqual([
      { by: "AAA", against: "BBB", until: "2026-08-01" },
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
