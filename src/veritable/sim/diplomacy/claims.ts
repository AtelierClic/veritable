import { NationId } from "../../data/schemas/common";
import { Claim, DiplomacyState, War } from "../../data/schemas/save";
import { Scenario } from "../../data/schemas/scenario";
import { EconomyContext } from "../economy/context";
import { homelandRegion } from "../war/claimTiles";

// Claims (J6). A nation claims the regions of the scenario it is listed as
// a claimant of, and its homeland (its land of the first day) wherever
// another nation holds it. The holder of a claimed tile is read on the map
// (the world's claimHolders), never on a frozen controller; the tiles a
// treaty ceded are settled and no longer claimed by anyone.
//
// A claim carries a weight (1 at first) that scales the motive of a war on
// it; every config.diplomacy.claims.failuresPerHalving white or lost wars on
// the claim halve it, and after abandonAfterFailures of them it is given up
// (J6c).

export function initClaims(scenario: Scenario): Claim[] {
  return scenario.contested.flatMap((r) =>
    r.claimants.map((claimant) => ({
      region: r.region,
      claimant,
      weight: 1,
      failures: 0,
    })),
  );
}

// Every claim of a nation: the listed ones (scenario, homeland once
// weakened) and its homeland.
export function claimsOf(state: DiplomacyState, nation: NationId): Claim[] {
  const listed = state.claims.filter((c) => c.claimant === nation);
  const home = homelandRegion(nation);
  if (!listed.some((c) => c.region === home)) {
    listed.push({ region: home, claimant: nation, weight: 1, failures: 0 });
  }
  return listed;
}

// Claims of `claimant` on land `target` holds now.
export function claimsAgainst(
  ctx: EconomyContext,
  state: DiplomacyState,
  claimant: NationId,
  target: NationId,
): Claim[] {
  const { minTiles, abandonAfterFailures } = ctx.config.diplomacy.claims;
  return claimsOf(state, claimant).filter(
    (c) =>
      c.failures < abandonAfterFailures &&
      (ctx.claimHolders(c.region).get(target) ?? 0) >= minTiles,
  );
}

// Regions of the scenario a nation claims (what a treaty it loses settles).
export function claimedRegions(
  state: DiplomacyState,
  nation: NationId,
): string[] {
  return state.claims
    .filter((c) => c.claimant === nation && !c.region.startsWith("homeland:"))
    .map((c) => c.region);
}

// The claims a war is fought on: those of its aggressors on land its
// defenders hold at the declaration. A war of the scenario starts before
// the map exists: its claims come from the controllers of the scenario data.
export function warClaims(
  ctx: EconomyContext,
  state: DiplomacyState,
  aggressors: readonly NationId[],
  defenders: readonly NationId[],
): string[] {
  const out = new Set<string>();
  for (const a of aggressors) {
    for (const d of defenders) {
      for (const c of claimsAgainst(ctx, state, a, d)) out.add(c.region);
    }
  }
  return [...out].sort();
}

export function scenarioWarClaims(
  scenario: Scenario,
  aggressors: readonly NationId[],
  defenders: readonly NationId[],
): string[] {
  return scenario.contested
    .filter(
      (r) =>
        defenders.includes(r.controller) &&
        r.claimants.some((c) => aggressors.includes(c)),
    )
    .map((r) => r.region)
    .sort();
}

function claimRecord(
  state: DiplomacyState,
  region: string,
  claimant: NationId,
): Claim {
  let claim = state.claims.find(
    (c) => c.region === region && c.claimant === claimant,
  );
  if (claim === undefined) {
    claim = { region, claimant, weight: 1, failures: 0 };
    state.claims.push(claim);
  }
  return claim;
}

export interface ClaimOutcome {
  claimant: NationId;
  region: string;
  weight: number;
}

// The end of a war: the aggressors count a failure on each claim the war was
// fought on when they lost it (a treaty imposed by the defenders) or when it
// was white (a ceasefire without net gain of land). Returns the claims whose
// weight was halved.
export function recordWarOutcome(
  ctx: EconomyContext,
  state: DiplomacyState,
  war: War,
  winner: NationId | null,
): ClaimOutcome[] {
  const { failuresPerHalving: every, abandonAfterFailures } =
    ctx.config.diplomacy.claims;
  const out: ClaimOutcome[] = [];
  const taken = (side: readonly NationId[]) =>
    side.reduce((s, n) => s + (war.tilesTaken[n] ?? 0), 0);
  const aggressorsWon =
    winner !== null
      ? war.aggressors.includes(winner)
      : taken(war.aggressors) > taken(war.defenders);
  if (aggressorsWon) return out;
  for (const aggressor of war.aggressors) {
    for (const region of war.claims) {
      const claim = claimRecord(state, region, aggressor);
      claim.failures += 1;
      // J6c: a claim pressed in vain abandonAfterFailures times is given up
      // (Syria on the north-east across a nine-tile gap of the Euphrates,
      // every six years for fifty years).
      if (claim.failures >= abandonAfterFailures) {
        if (claim.weight > 0) {
          claim.weight = 0;
          out.push({ claimant: aggressor, region, weight: 0 });
        }
      } else if (claim.failures % every === 0) {
        claim.weight /= 2;
        out.push({ claimant: aggressor, region, weight: claim.weight });
      }
    }
  }
  return out;
}

// Weight of the strongest claim of `claimant` on land `target` holds: what
// scales the motive of a war justified by territory (0 without any).
export function claimWeight(
  ctx: EconomyContext,
  state: DiplomacyState,
  claimant: NationId,
  target: NationId,
): number {
  return claimsAgainst(ctx, state, claimant, target).reduce(
    (max, c) => Math.max(max, c.weight),
    0,
  );
}
