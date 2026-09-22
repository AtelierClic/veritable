import { Bloc } from "../../data/schemas/bloc";
import { NationId } from "../../data/schemas/common";
import { NationEconomy, NationPolitics } from "../../data/schemas/save";
import { deficitToGdp } from "../economy/budget";

// Blocs, layer 1, fiscal rule (the EU's 3 % / 60 %), once per game month.
// A full member is reprimanded when
//   - its trailing twelve-month deficit has been above the limit for
//     `deficitYears` consecutive years, or
//   - its debt is above the limit and has been rising for `debtRisingMonths`.
// While it lasts: the full opinion malus and, when it starts, a journal
// entry. Once lifted, the malus fades out linearly over `malusFadeMonths`.
// Nothing else at J3.

export type BlocEvent = {
  type: "bloc-reprimand";
  nation: NationId;
  bloc: string;
  deficitToGdp: number;
  debtToGdp: number;
};

export function stepFiscalRules(
  blocs: readonly Bloc[],
  id: NationId,
  economy: NationEconomy,
  politics: NationPolitics,
): BlocEvent[] {
  const events: BlocEvent[] = [];
  const deficit = deficitToGdp(economy);
  const debt = economy.debt / economy.gdp;
  let malus = 0;
  let fadeMonths = 1;
  let breach = false;
  let reprimanded = false;
  for (const bloc of blocs) {
    const rule = bloc.fiscalRule;
    if (rule === undefined) continue;
    const member = bloc.members.some(
      (m) => m.nation === id && m.status === "full",
    );
    if (!member) continue;
    malus = Math.max(malus, rule.opinionMalus);
    fadeMonths = Math.max(fadeMonths, rule.malusFadeMonths);
    if (deficit > rule.maxDeficitToGdp) breach = true;
    const deficitOffence =
      politics.deficitBreachMonths + 1 >= rule.deficitYears * 12 &&
      deficit > rule.maxDeficitToGdp;
    const debtOffence =
      debt > rule.maxDebtToGdp &&
      economy.debtRisingMonths >= rule.debtRisingMonths;
    if (deficitOffence || debtOffence) {
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
  politics.deficitBreachMonths = breach ? politics.deficitBreachMonths + 1 : 0;
  politics.reprimanded = reprimanded;
  politics.reprimandMalus = reprimanded
    ? malus
    : Math.max(0, politics.reprimandMalus - malus / fadeMonths);
  return events;
}
