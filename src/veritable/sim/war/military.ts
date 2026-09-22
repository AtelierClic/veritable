import { NationId } from "../../data/schemas/common";
import { NationData } from "../../data/schemas/nation";
import {
  Division,
  MilitaryState,
  NationEconomy,
  NationMilitary,
  NationPolitics,
} from "../../data/schemas/save";
import {
  ConscriptionLevel,
  DIVISION_TEMPLATE_IDS,
  Posture,
} from "../../data/schemas/war";
import { EconomyContext } from "../economy/context";

// Divisions, manpower, arms, training, exhaustion (J3a). The fronts that use
// them are in fronts.ts; nothing here touches a tile.
//
// Manpower ceiling = population x conscription level; the pool is what is
// left once the divisions are manned, refilled every month by a share of the
// ceiling. Arms: every month a share of the arms available in the nation
// (production + imports - exports, index points) re-equips the divisions,
// pro rata of their deficit. Training of the nation follows its defence
// spending above the first day's; a division's training converges to it.

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

export function manpowerCeiling(
  ctx: EconomyContext,
  population: number,
  level: ConscriptionLevel,
): number {
  return population * ctx.config.war.conscription[level];
}

function menInDivisions(nation: NationMilitary): number {
  return nation.divisions.reduce((s, d) => s + d.men, 0);
}

// Lowest level whose ceiling holds the standing army of the sheet.
function startingConscription(
  ctx: EconomyContext,
  data: NationData,
): ConscriptionLevel {
  for (const level of ["peace", "partial", "total"] as const) {
    if (
      manpowerCeiling(ctx, data.population.value, level) >=
      data.military.activePersonnel
    ) {
      return level;
    }
  }
  return "total";
}

function initNation(ctx: EconomyContext, data: NationData): NationMilitary {
  const cfg = ctx.config.war;
  const divisions: Division[] = [];
  let nextId = 1;
  let manned = 0;
  for (const id of DIVISION_TEMPLATE_IDS) {
    const template = ctx.template(id);
    const men = data.military.activePersonnel * cfg.startingMix[id];
    const count = Math.floor(men / template.men);
    for (let i = 0; i < count; i++) {
      divisions.push({
        id: nextId++,
        template: id,
        men: template.men,
        equipment: 1,
        training: cfg.training.base,
        front: null,
        segment: null,
        posture: "defend",
      });
      manned += template.men;
    }
  }
  const conscription = startingConscription(ctx, data);
  const ceiling = manpowerCeiling(ctx, data.population.value, conscription);
  return {
    conscription,
    manpower: Math.max(0, ceiling - manned),
    divisions,
    nextDivisionId: nextId,
    exhaustion: 0,
    training: cfg.training.base,
    losses: 0,
    lossesLastMonth: 0,
    airPower: data.military.airPower,
    navalPower: data.military.navalPower,
  };
}

export function initMilitary(
  ctx: EconomyContext,
  nations: readonly NationData[],
): MilitaryState {
  return {
    nations: Object.fromEntries(nations.map((n) => [n.id, initNation(ctx, n)])),
  };
}

// Force of one division, as a multiplier of its template's attack or defence
// value: strength x equipment x training.
export function divisionStrength(
  ctx: EconomyContext,
  division: Division,
  side: "attack" | "defense",
): number {
  const template = ctx.template(division.template);
  return (
    template[side] *
    (division.men / template.men) *
    division.equipment *
    division.training
  );
}

// Military power of a nation, used by diplomacy (declaration cost, sanctions,
// coalitions): land force at rest plus the sheet's air and naval power.
export function militaryPower(
  ctx: EconomyContext,
  state: MilitaryState,
  id: NationId,
): number {
  const nation = state.nations[id];
  if (nation === undefined) return 0;
  let land = 0;
  for (const division of nation.divisions) {
    land +=
      (divisionStrength(ctx, division, "attack") +
        divisionStrength(ctx, division, "defense")) /
      2;
  }
  const w = ctx.config.war.power;
  return land + w.air * nation.airPower + w.naval * nation.navalPower;
}

// --- player and AI orders --------------------------------------------------------

export function raiseDivision(
  ctx: EconomyContext,
  nation: NationMilitary,
  templateId: string,
  maxDivisions: number | null,
): Division {
  const template = ctx.template(templateId);
  if (maxDivisions !== null && nation.divisions.length >= maxDivisions) {
    throw new Error("demilitarised: no more divisions allowed");
  }
  if (nation.manpower < template.men) {
    throw new Error(`not enough manpower for a ${templateId} division`);
  }
  nation.manpower -= template.men;
  const division: Division = {
    id: nation.nextDivisionId,
    template: templateId,
    men: template.men,
    equipment: ctx.config.war.raisedDivisionEquipment,
    training: nation.training,
    front: null,
    segment: null,
    posture: "defend",
  };
  nation.nextDivisionId += 1;
  nation.divisions.push(division);
  return division;
}

export function disbandDivision(nation: NationMilitary, id: number): void {
  const at = nation.divisions.findIndex((d) => d.id === id);
  if (at < 0) throw new Error(`no division ${id}`);
  nation.manpower += nation.divisions[at].men;
  nation.divisions.splice(at, 1);
}

export function assignDivision(
  nation: NationMilitary,
  id: number,
  front: string | null,
  segment: number | null,
): void {
  const division = nation.divisions.find((d) => d.id === id);
  if (division === undefined) throw new Error(`no division ${id}`);
  division.front = front;
  division.segment = front === null ? null : segment;
}

export function setPosture(
  nation: NationMilitary,
  id: number,
  posture: Posture,
): void {
  const division = nation.divisions.find((d) => d.id === id);
  if (division === undefined) throw new Error(`no division ${id}`);
  division.posture = posture;
}

export function setConscription(
  ctx: EconomyContext,
  nation: NationMilitary,
  population: number,
  level: ConscriptionLevel,
): void {
  nation.conscription = level;
  const ceiling = manpowerCeiling(ctx, population, level);
  nation.manpower = clamp(
    nation.manpower,
    0,
    Math.max(0, ceiling - menInDivisions(nation)),
  );
}

// --- monthly upkeep ------------------------------------------------------------------

export function stepMilitaryMonth(
  ctx: EconomyContext,
  nation: NationMilitary,
  data: NationData,
  economy: NationEconomy,
  politics: NationPolitics,
  atWar: boolean,
): void {
  const cfg = ctx.config.war;
  const population = data.population.value;

  // Manpower: the pool refills, then reinforces the divisions.
  const ceiling = manpowerCeiling(ctx, population, nation.conscription);
  nation.manpower = clamp(
    nation.manpower + cfg.manpowerRenewalPerMonth * ceiling,
    0,
    Math.max(0, ceiling - menInDivisions(nation)),
  );
  for (const division of nation.divisions) {
    const missing = ctx.template(division.template).men - division.men;
    if (missing <= 0 || nation.manpower <= 0) continue;
    const men = Math.min(missing, nation.manpower);
    division.men += men;
    nation.manpower -= men;
  }

  // Arms: a share of what the nation has this month re-equips the divisions.
  const available =
    (Math.max(
      0,
      economy.production.arms * economy.coverage.arms +
        economy.imports.arms -
        economy.exports.arms,
    ) /
      12) *
    cfg.armsToDivisionsShare;
  let deficit = 0;
  for (const division of nation.divisions) {
    deficit +=
      (1 - division.equipment) *
      ctx.template(division.template).arms *
      cfg.armsIndexPerEquipmentUnit;
  }
  if (deficit > 0 && available > 0) {
    const ratio = Math.min(1, available / deficit);
    for (const division of nation.divisions) {
      division.equipment = clamp(
        division.equipment + (1 - division.equipment) * ratio,
        0,
        1,
      );
    }
  }

  // Training follows the defence spending above the first day's share.
  const points = (economy.spending.defense - economy.spending0.defense) * 100;
  nation.training = clamp(
    cfg.training.base * (1 + cfg.training.defenseSpendingScale * points),
    cfg.training.min,
    cfg.training.max,
  );
  for (const division of nation.divisions) {
    division.training += (nation.training - division.training) * 0.1;
  }

  // Air and naval power of the sheet, scaled by the arms coverage.
  nation.airPower = data.military.airPower * economy.coverage.arms;
  nation.navalPower = data.military.navalPower * economy.coverage.arms;

  // Exhaustion: up with the losses of the month and every month at war,
  // down in peace. Losses also hit the youth and the workers.
  const e = cfg.exhaustion;
  const lossShare = nation.lossesLastMonth / population;
  nation.exhaustion = clamp(
    atWar
      ? nation.exhaustion +
          e.perMonthAtWar +
          e.perLossShareOfPopulation * lossShare
      : nation.exhaustion - e.recoveryPerMonthAtPeace,
    0,
    1,
  );
  if (politics.groups !== null && lossShare > 0) {
    politics.groups.youth = clamp(
      politics.groups.youth - cfg.lossesGroupHit.youth * lossShare,
      0,
      1,
    );
    politics.groups.workers = clamp(
      politics.groups.workers - cfg.lossesGroupHit.workers * lossShare,
      0,
      1,
    );
  }
  nation.lossesLastMonth = 0;
}
