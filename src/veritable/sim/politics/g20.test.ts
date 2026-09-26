import { loadScenarioPack } from "../../adapters/scenarioPack";
import { dataSource } from "../../data/catalog";
import { buildContext } from "../economy/context";
import { Rng } from "../rng";
import { projectShares, voteCoverage } from "./elections";
import { initNationPolitics } from "./state";

// J7 (the political regression of the J4 guide): for the democracies of the
// G20, the vote of the first day gives the party in power and the first
// party of the opposition within 8 points of their last national election,
// and the party in power is the one that governs on 1 January 2026.

const G20_DEMOCRACIES: Record<string, string> = {
  USA: "usa-parti-republicain",
  GBR: "gbr-parti-travailliste",
  FRA: "fra-renaissance",
  DEU: "deu-union-chretienne-democrate-d-allemagne",
  ITA: "ita-freres-d-italie",
  JPN: "jpn-parti-liberal-democrate",
  CAN: "can-parti-liberal-du-canada",
  AUS: "aus-parti-travailliste-australien",
  KOR: "kor-parti-minju",
  BRA: "bra-federacao-brasil-da-esperanca-pt-pcdob-pv",
  ARG: "arg-la-libertad-avanza",
  ZAF: "zaf-congres-national-africain",
};

describe("the vote of the first day in the democracies of the G20 (J7)", () => {
  it("gives back the party in power and the first opposition party within 8 points of their last election", async () => {
    const pack = await loadScenarioPack("world-2026");
    const config = dataSource.config();
    const ctx = buildContext(config, pack.data, pack.nations);
    const rng = new Rng(1);
    for (const [id, ruling] of Object.entries(G20_DEMOCRACIES)) {
      const sheet = dataSource.nation(id);
      const politics = initNationPolitics(ctx, rng, sheet, false, "2026-01-01");
      expect(politics.government.parties[0], id).toBe(ruling);
      const shares = projectShares(ctx, politics, sheet);
      const coverage = voteCoverage(ctx, sheet);
      const data = ctx.leaders(id)!.parties;
      const opposition = [...data]
        .filter((p) => !politics.government.parties.includes(p.id))
        .sort((a, b) => b.support - a.support)[0];
      for (const party of [ruling, opposition.id]) {
        const last = data.find((p) => p.id === party)!.support;
        expect(
          Math.abs(shares[party] * coverage - last),
          `${id} ${party}`,
        ).toBeLessThanOrEqual(0.08);
      }
    }
  }, 120_000);
});
