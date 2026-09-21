import { Bloc } from "../../data/schemas/bloc";
import { NationId } from "../../data/schemas/common";
import { NationEconomy, NationPolitics } from "../../data/schemas/save";
import { deficitToGdp } from "../economy/budget";

// Blocs, layer 1, fiscal rule (the EU's 3 % / 60 %). A full member beyond
// either limit is reprimanded: an opinion malus while it lasts and a journal
// entry when it starts. Nothing else at J2.

export type BlocEvent = {
  type: "bloc-reprimand";
  nation: NationId;
  bloc: string;
  deficitToGdp: number;
  debtToGdp: number;
};

// Largest malus among the blocs that reprimand this nation.
export function reprimandMalus(
  blocs: readonly Bloc[],
  nation: NationId,
): number {
  let malus = 0;
  for (const bloc of blocs) {
    if (bloc.fiscalRule === undefined) continue;
    if (bloc.members.some((m) => m.nation === nation && m.status === "full")) {
      malus = Math.max(malus, bloc.fiscalRule.opinionMalus);
    }
  }
  return malus;
}

export function stepFiscalRules(
  blocs: readonly Bloc[],
  id: NationId,
  economy: NationEconomy,
  politics: NationPolitics,
): BlocEvent[] {
  const events: BlocEvent[] = [];
  let reprimanded = false;
  const deficit = deficitToGdp(economy);
  const debt = economy.debt / economy.gdp;
  for (const bloc of blocs) {
    const rule = bloc.fiscalRule;
    if (rule === undefined) continue;
    const member = bloc.members.some(
      (m) => m.nation === id && m.status === "full",
    );
    if (!member) continue;
    if (deficit > rule.maxDeficitToGdp || debt > rule.maxDebtToGdp) {
      reprimanded = true;
      if (!politics.reprimanded) {
        events.push({
          type: "bloc-reprimand",
          nation: id,
          bloc: bloc.id,
          deficitToGdp: deficit,
          debtToGdp: debt,
        });
      }
    }
  }
  politics.reprimanded = reprimanded;
  return events;
}
