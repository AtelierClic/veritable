import { loadVeritableConfig } from "../../data/loadConfig";
import { testNation } from "../testing/nations";
import { testGoods, testSimData } from "../testing/simData";
import { buildContext } from "./context";
import { demandAt, nextPrice, supplyAt, totals } from "./market";
import { allocateFlows, greatCircleKm, Trader } from "./trade";

const config = loadVeritableConfig();
const good = testGoods()[0]; // basePrice 100, epsilon 0.3, eta 0.3

describe("world price", () => {
  it("demand falls and supply rises with the price, by their elasticities", () => {
    expect(demandAt(1000, good, 100)).toBe(1000);
    expect(supplyAt(1000, good, 100)).toBe(1000);
    expect(demandAt(1000, good, 200)).toBeCloseTo(1000 * 2 ** -0.3, 9);
    expect(supplyAt(1000, good, 200)).toBeCloseTo(1000 * 2 ** 0.3, 9);
    // The rest of the world reacts twice as much.
    expect(demandAt(1000, good, 200, 2)).toBeCloseTo(1000 * 2 ** -0.6, 9);
  });

  it("p(t+1) = p(t) x (1 + k x (D - S) / S)", () => {
    const k = config.economy.priceAdjustment;
    expect(nextPrice(100, 1050, 1000, 0, good, config.economy)).toBeCloseTo(
      100 * (1 + k * 0.05),
      9,
    );
    expect(nextPrice(100, 950, 1000, 0, good, config.economy)).toBeLessThan(
      100,
    );
    expect(nextPrice(100, 1000, 1000, 0, good, config.economy)).toBe(100);
  });

  it("moves at most 2 % a day and stays within [0.25, 4] x base", () => {
    const max = config.economy.maxDailyPriceChange;
    expect(nextPrice(100, 9000, 1000, 0, good, config.economy)).toBeCloseTo(
      100 * (1 + max),
      9,
    );
    // Downwards the formula itself cannot exceed k = 2 % a day.
    const crash = nextPrice(100, 1, 1000, 0, good, config.economy);
    expect(crash).toBeGreaterThanOrEqual(100 * (1 - max));
    expect(crash).toBeLessThan(98.01);
    expect(nextPrice(399, 9000, 1000, 0, good, config.economy)).toBe(400);
    expect(nextPrice(25.1, 1, 1000, 0, good, config.economy)).toBe(25);
  });

  it("volume stranded by an embargo leaves the supply that forms the price", () => {
    const free = nextPrice(100, 1000, 1000, 0, good, config.economy);
    const stranded = nextPrice(100, 1000, 1000, 100, good, config.economy);
    expect(free).toBe(100);
    expect(stranded).toBeGreaterThan(100);
  });

  it("converges to the clearing price without oscillating", () => {
    const sides = [
      { production: 900, consumption: 1000, elasticityFactor: 1 },
      { production: 5000, consumption: 5000, elasticityFactor: 2 },
    ];
    let price = 100;
    const path: number[] = [];
    for (let day = 0; day < 3000; day++) {
      const { demand, supply } = totals(sides, good, price);
      price = nextPrice(price, demand, supply, 0, good, config.economy);
      path.push(price);
    }
    const { demand, supply } = totals(sides, good, price);
    expect(Math.abs(demand - supply) / supply).toBeLessThan(1e-6);
    expect(price).toBeGreaterThan(100);
    // Monotonic approach: never overshoots.
    for (let i = 1; i < path.length; i++) {
      expect(path[i]).toBeGreaterThanOrEqual(path[i - 1] - 1e-9);
    }
  });
});

describe("bilateral flows", () => {
  const traders = (list: [string, number, number][]): Trader[] =>
    list.map(([id, surplus, deficit]) => ({ id, surplus, deficit }));

  it("fills a deficit in proportion to the weights", () => {
    const flows = allocateFlows(
      traders([
        ["near", 100, 0],
        ["far", 100, 0],
        ["buyer", 0, 60],
      ]),
      (exporter) => (exporter === "near" ? 3 : 1),
      3,
    );
    expect(flows.received.get("buyer")).toBeCloseTo(60, 9);
    expect(flows.delivered.get("near")!.get("buyer")).toBeCloseTo(45, 9);
    expect(flows.delivered.get("far")!.get("buyer")).toBeCloseTo(15, 9);
    expect(flows.unsold.get("near")).toBeCloseTo(55, 9);
  });

  it("rations an oversubscribed exporter pro rata, then asks the others again", () => {
    const flows = allocateFlows(
      traders([
        ["small", 30, 0],
        ["big", 1000, 0],
        ["a", 0, 100],
        ["b", 0, 50],
      ]),
      // Everybody prefers `small`, which cannot serve them all.
      (exporter) => (exporter === "small" ? 100 : 1),
      3,
    );
    expect(flows.shipped.get("small")).toBeCloseTo(30, 9);
    expect(flows.unsold.get("small")).toBeCloseTo(0, 9);
    // Pass 1 rations `small`; passes 2 and 3 complete from `big`.
    expect(flows.received.get("a")).toBeCloseTo(100, 6);
    expect(flows.received.get("b")).toBeCloseTo(50, 6);
  });

  it("leaves a shortage when the world does not have enough, shared pro rata", () => {
    const flows = allocateFlows(
      traders([
        ["seller", 90, 0],
        ["a", 0, 100],
        ["b", 0, 50],
      ]),
      () => 1,
      3,
    );
    expect(flows.received.get("a")).toBeCloseTo(60, 9);
    expect(flows.received.get("b")).toBeCloseTo(30, 9);
  });

  it("an embargoed pair does not trade; the blocked surplus stays unsold", () => {
    const flows = allocateFlows(
      traders([
        ["embargoed", 100, 0],
        ["other", 40, 0],
        ["buyer", 0, 100],
      ]),
      (exporter) => (exporter === "embargoed" ? 0 : 1),
      3,
    );
    expect(flows.received.get("buyer")).toBeCloseTo(40, 9);
    expect(flows.unsold.get("embargoed")).toBe(100);
  });

  it("conserves volume", () => {
    const flows = allocateFlows(
      traders([
        ["x", 70, 0],
        ["y", 20, 0],
        ["a", 0, 50],
        ["b", 0, 80],
      ]),
      (e, i) => (e === "x" && i === "a" ? 5 : 1),
      3,
    );
    const shipped = [...flows.shipped.values()].reduce((a, b) => a + b, 0);
    const received = [...flows.received.values()].reduce((a, b) => a + b, 0);
    expect(shipped).toBeCloseTo(received, 9);
    expect(shipped).toBeCloseTo(90, 9);
  });
});

describe("geography of trade", () => {
  it("great circle: Paris - Berlin is about 880 km", () => {
    expect(greatCircleKm(2.3522, 48.8566, 13.405, 52.52)).toBeGreaterThan(860);
    expect(greatCircleKm(2.3522, 48.8566, 13.405, 52.52)).toBeLessThan(900);
  });

  const nations = [
    testNation("AAA", { lon: 0, lat: 45, blocs: ["club"] }),
    testNation("BBB", { lon: 10, lat: 45, blocs: ["club"] }),
    testNation("CCC", { lon: 40, lat: 45 }),
  ];
  const ctx = buildContext(
    config,
    testSimData(["AAA", "BBB", "CCC"], {
      landNeighbours: [["AAA", "BBB"]],
      bordersNeutralLand: ["CCC"],
      blocs: [
        {
          id: "club",
          name: "bloc.club",
          layer: 1,
          tradeBonus: 1.5,
          members: [
            { nation: "AAA", status: "full" },
            { nation: "BBB", status: "full" },
            { nation: "CCC", status: "candidate" },
          ],
        },
      ],
    }),
    nations,
  );
  const oil = ctx.good("oil");

  it("weights decay with distance; the rest of the world sits at 4 000 km", () => {
    expect(ctx.affinity(oil, "AAA", "CCC")).toBeLessThan(
      ctx.affinity(oil, "BBB", "CCC"),
    );
    expect(ctx.affinity(oil, "CCC", "ROW")).toBeCloseTo(
      Math.exp(-config.economy.rowDistanceKm / config.economy.distanceScaleKm),
      9,
    );
  });

  it("full members of a bloc trade more with each other", () => {
    const bonus = ctx.affinity(oil, "AAA", "BBB");
    const km = greatCircleKm(0, 45, 10, 45);
    expect(bonus).toBeCloseTo(
      1.5 * Math.exp(-km / config.economy.distanceScaleKm),
      9,
    );
  });

  it("electricity only crosses land borders; services ignore distance", () => {
    const electricity = ctx.good("electricity");
    expect(ctx.affinity(electricity, "AAA", "BBB")).toBeGreaterThan(0);
    expect(ctx.affinity(electricity, "AAA", "CCC")).toBe(0);
    expect(ctx.affinity(electricity, "AAA", "ROW")).toBe(0);
    expect(ctx.affinity(electricity, "CCC", "ROW")).toBeGreaterThan(0);
    expect(ctx.affinity(ctx.good("services"), "AAA", "CCC")).toBe(1);
  });
});
