import { NationId } from "../../data/schemas/common";
import {
  Claim,
  NationEconomy,
  NationMilitary,
  SaveFile,
  War,
} from "../../data/schemas/save";
import { SaveFileV6 } from "../../data/schemas/saveV6";
import { populationFactor } from "../../sim/economy/population";
import { addMonths } from "../../sim/politics/state";
import { initSchedule } from "../../sim/schedule";
import { calendarMonth, DAYS_PER_MONTH } from "../../sim/time";
import { MigrationContext, MigrationError } from "./index";

// v6 (J6) -> v7 (J7). The v7 drops the monthly march: every nation is
// updated on its own cadence (the rolling queue), the goods of the market
// take turns, and a war keeps its own months. What the v6 carries is kept;
// the v7 adds, from the save:
//   - the rolling queue: every nation due within a week of the save date
//     (the player's half a day later), spread over the week; each takes its
//     own cadence from its first update on;
//   - the population in play: the sheet's, grown on its trend (converging
//     to the long-run rate) from the start date to the save date (the v6
//     kept the sheet's);
//   - the calendar month of the last update: the save's;
//   - the trade of each good: the volumes of the save at its prices (the
//     turn of each good computes it again within a week);
//   - the balances by calendar month: the twelve monthly balances of the
//     v6, month by month up to the save's; the debt of the save as the
//     mark of the months of rising debt;
//   - the men lost since the last update: those of the month; no arms
//     received pending;
//   - the ledger of each war: the 1st of the next month (where the monthly
//     step of the v6 would have closed its month);
//   - the claims given up at the J6c (three failures) sleep;
//   - a coalition call answers until the date its months left give;
//   - the base of each party: 1 (the voters' attachment is fitted on the
//     first day of a campaign; a migrated one keeps the ideological vote of
//     the J4 to the J6);
//   - the AI keeps its goals, not its review dates (the queue replaces
//     them).

export function v6ToV7(
  save: SaveFileV6,
  context: MigrationContext | undefined,
): SaveFile {
  if (context === undefined) {
    throw new MigrationError(
      "migration v6 -> v7 needs the campaign data (MigrationContext)",
    );
  }
  const date = save.calendar.date;
  const start = save.calendar.startDate;
  const month = calendarMonth(start, date);
  const years = save.calendar.elapsedGameMinutes / (24 * 60 * 365.25);
  const prices = save.economy.market.prices;
  const importPrices = save.economy.market.importPrices;
  const rent = new Set<string>(
    context.data.goods.filter((g) => g.rent).map((g) => g.id),
  );

  const economy: Record<NationId, NationEconomy> = {};
  for (const [id, e] of Object.entries(save.economy.nations)) {
    const sheet = context.nationData(id);
    if (sheet === undefined) {
      throw new MigrationError(`migration v6 -> v7: no nation sheet for ${id}`);
    }
    const trend = sheet.populationGrowth?.value;
    const perGood = (value: (good: string) => number) =>
      Object.fromEntries(Object.keys(e.production).map((g) => [g, value(g)]));
    const balances = (e.balances as unknown[]).map((b, i, all) =>
      typeof b === "number"
        ? {
            month: Math.max(0, month - (all.length - 1 - i)),
            value: b,
            days: DAYS_PER_MONTH,
          }
        : (b as { month: number; value: number; days: number }),
    );
    // Months that fell before the start of the campaign merge (a save of
    // its first months).
    const merged: { month: number; value: number; days: number }[] = [];
    for (const b of balances) {
      const last = merged[merged.length - 1];
      if (last !== undefined && last.month === b.month) {
        last.value += b.value;
        last.days += b.days;
      } else merged.push({ ...b });
    }
    const old = e as unknown as Partial<NationEconomy>;
    economy[id] = {
      ...e,
      population:
        old.population ??
        sheet.population.value *
          populationFactor(context.config, trend, 0, years),
      monthMark: month,
      exportValue:
        old.exportValue ?? perGood((g) => e.exports[g] * prices[g] * 1e6),
      importValue:
        old.importValue ??
        perGood((g) => e.imports[g] * (importPrices[g] ?? prices[g]) * 1e6),
      rentValue:
        old.rentValue ??
        perGood((g) => (rent.has(g) ? e.production[g] * prices[g] * 1e6 : 0)),
      maritimeValue: old.maritimeValue ?? perGood(() => 0),
      paidPrice: old.paidPrice ?? perGood((g) => prices[g]),
      balances: merged,
      debtMark: e.debt,
    };
  }

  const military: Record<NationId, NationMilitary> = {};
  for (const [id, m] of Object.entries(save.military.nations)) {
    const old = m as unknown as Partial<NationMilitary> & {
      lossesLastMonth?: number;
    };
    const { lossesLastMonth, ...rest } = m as typeof m & {
      lossesLastMonth?: number;
    };
    void lossesLastMonth;
    military[id] = {
      ...rest,
      lossesPending: old.lossesPending ?? old.lossesLastMonth ?? 0,
      armsReceived: old.armsReceived ?? 0,
    } as NationMilitary;
  }

  const nextFirst = addMonths(`${date.slice(0, 7)}-01`, 1);
  const wars: War[] = save.diplomacy.wars.map((w) => ({
    ...w,
    ledgerOn: (w as Partial<War>).ledgerOn ?? nextFirst,
  }));
  const abandon = context.config.diplomacy.claims.abandonAfterFailures;
  const claims: Claim[] = save.diplomacy.claims.map((c) => ({
    ...c,
    dormant: (c as Partial<Claim>).dormant ?? c.failures >= abandon,
  }));
  const coalitionCalls = save.diplomacy.coalitionCalls.map((c) => {
    const old = c as typeof c & { monthsLeft?: number; until?: string };
    return {
      war: c.war,
      nation: c.nation,
      until: old.until ?? addMonths(date, old.monthsLeft ?? 1),
      side: c.side,
    };
  });

  const politics = {
    ...save.politics,
    nations: Object.fromEntries(
      Object.entries(save.politics.nations).map(([id, p]) => [
        id,
        {
          ...p,
          parties: p.parties.map((party) => ({
            ...party,
            base: (party as { base?: number }).base ?? 1,
          })),
        },
      ]),
    ),
  };

  const ai = {
    nations: Object.fromEntries(
      Object.entries(save.ai.nations).map(([id, a]) => [
        id,
        {
          defenseGoal: a.defenseGoal,
          lastWar: a.lastWar,
          lastLanding: a.lastLanding,
          blockading: a.blockading,
        },
      ]),
    ),
    armsAid: save.ai.armsAid,
  };

  const ids = save.nations.map((n) => n.id);
  const player = save.politics.autopilot
    ? null
    : (save.nations.find((n) => n.isPlayer)?.id ?? null);
  const schedule = initSchedule(
    ids,
    save.calendar.elapsedGameMinutes,
    () => context.config.schedule.stakesDays,
    context.config.time.gameMinutesPerTick,
    player,
  );

  return {
    ...save,
    schemaVersion: 7,
    economy: { market: save.economy.market, nations: economy },
    military: { nations: military },
    diplomacy: { ...save.diplomacy, wars, claims, coalitionCalls },
    politics,
    ai,
    schedule,
  } as SaveFile;
}
