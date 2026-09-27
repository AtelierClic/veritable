import { PlayerBuildableUnitType, UnitType } from "../../core/game/Game";
import type { MapOverlay } from "../adapters/CoreBridge";
import type { TileInfo } from "../adapters/protocol";
import { RemoteVeritableSim } from "../adapters/RemoteVeritableSim";
import { dataSource } from "../data/catalog";
import { vt } from "../data/i18n";
import { NationId } from "../data/schemas/common";
import { Division } from "../data/schemas/save";
import {
  FrontView,
  PlayerCommand,
  ReadonlyWorldView,
} from "../sim/VeritableSim";
import { MenuEntry } from "./ActionMenu";
import {
  casusBelliName,
  declareWarConfirmed,
  nuclearLaunchConfirmed,
} from "./confirmations";
import { own, ownSide, seen } from "./intel";
import { measureName, Names, viewNames } from "./journalText";
import { airStrikeBlock, nuclearBlock, playerEnemies } from "./orders";

// What the action menu of the map offers at a point (J7b): the entries by
// what lies there — a foreign land at peace, an enemy at war, the player's
// land, the sea — each running a command of the screens (a PlayerCommand, or
// the build intent of the core), its cost or consequences on hover, greyed
// with its reason when it cannot be taken. No rule of its own: what may be
// ordered is what the screens may order (ui/orders.ts, ui/confirmations.ts).

export interface Buildable {
  type: PlayerBuildableUnitType;
  // Where the core would build it (false: not here), the structure it
  // would upgrade instead (false: none).
  canBuild: number | false;
  canUpgrade: number | false;
}

export interface MenuContext {
  view: ReadonlyWorldView;
  info: TileInfo;
  // The point in tiles; null when the menu opens for a nation without a
  // point of the map (from its card).
  x: number | null;
  y: number | null;
  overlay: MapOverlay | null;
  sim: RemoteVeritableSim;
  apply: (command: PlayerCommand) => Promise<void>;
  // Structures the player can build on the tile (the core decides), and
  // the orders of the core that build or upgrade one.
  buildables: () => Promise<Buildable[]>;
  build: (b: Buildable) => void;
  // Ticks a structure takes to build (the configuration of the core).
  durations: ReadonlyMap<UnitType, number>;
  openCard: (nation: NationId) => void;
  openDiplomacy: (nation: NationId) => void;
}

export interface MenuContent {
  title: string;
  subtitle?: string;
  entries: MenuEntry[];
}

// The structures of the menu, in the order shown; their names in fr.json
// (structure.<slug>).
export const MENU_STRUCTURES: readonly PlayerBuildableUnitType[] = [
  UnitType.City,
  UnitType.Port,
  UnitType.DefensePost,
  UnitType.SAMLauncher,
  UnitType.MissileSilo,
  UnitType.Warship,
];

export function structureName(type: UnitType): string {
  return vt(`structure.${type.toLowerCase().replace(/ /g, "-")}`);
}

// Ticks of the core in a game day (a construction lasts ticks).
const TICKS_PER_DAY = 20;

const percent = (v: number) =>
  `${(v * 100).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} %`;
const usd = (v: number) =>
  v >= 1e9
    ? `${(v / 1e9).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Md$`
    : `${(v / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} M$`;

export async function menuContent(ctx: MenuContext): Promise<MenuContent> {
  const { view, info } = ctx;
  const me = view.playerNation;
  if (me === null) return { title: "", entries: [] };
  const names = viewNames(view);
  if (!info.land) return seaMenu(ctx, me, names);
  if (info.owner === null) return { title: vt("menu.neutral"), entries: [] };
  if (info.owner === me) return ownMenu(ctx, me, names);
  const enemy = playerEnemies(view).includes(info.owner);
  return {
    title: names.nation(info.owner),
    subtitle: enemy ? vt("menu.at-war") : undefined,
    entries: enemy
      ? warMenu(ctx, me, info.owner, names)
      : peaceMenu(ctx, me, info.owner, names),
  };
}

// --- a foreign land at peace ------------------------------------------------------

function peaceMenu(
  ctx: MenuContext,
  me: NationId,
  target: NationId,
  names: Names,
): MenuEntry[] {
  const { view } = ctx;
  const casus = view.casusBelli[target] ?? [];
  // J7c: a nation in exile or dissolved has no land to fight from.
  const status = view.nations.find((n) => n.id === me)?.status;
  const landless = status === "exiled" || status === "dissolved";
  const sanctioning = view.diplomacy.sanctions.some(
    (s) => s.by === me && s.against === target,
  );
  const held = view.blocHeldSanctions.includes(target);
  return [
    {
      label: vt("menu.declare-war"),
      hint: vt("menu.declare-war-hint"),
      disabled:
        casus.length === 0
          ? vt(landless ? "menu.no-land" : "menu.no-casus-belli")
          : null,
      children: () =>
        casus.map((cb) => ({
          label: casusBelliName(cb),
          hint: vt("menu.preview-hint"),
          run: () => declareWarConfirmed(ctx.sim, names, target, cb, ctx.apply),
        })),
    },
    {
      label: vt("menu.sanction"),
      hint: vt("menu.sanction-hint"),
      children: () => [
        sanctioning
          ? {
              label: vt("menu.lift"),
              hint: vt("menu.lift-hint"),
              disabled: held ? vt("menu.bloc-held") : null,
              run: () =>
                ctx.apply({
                  type: "set-sanctions",
                  against: target,
                  active: false,
                }),
            }
          : {
              label: vt("menu.sanction-all"),
              hint: vt("menu.sanction-all-hint"),
              run: () =>
                ctx.apply({
                  type: "set-sanctions",
                  against: target,
                  active: true,
                }),
            },
        {
          label: vt("menu.embargo-goods"),
          hint: vt("menu.embargo-goods-hint"),
          run: () => ctx.openDiplomacy(target),
        },
      ],
    },
    {
      label: vt("menu.propose"),
      hint: vt("menu.propose-hint"),
      children: () => proposals(ctx, target, names),
    },
    { label: vt("menu.card"), run: () => ctx.openCard(target) },
  ];
}

// What the player may put to the vote of a bloc it leads about this nation.
function proposals(
  ctx: MenuContext,
  target: NationId,
  names: Names,
): MenuEntry[] {
  const capital = own(ctx.view)?.politics?.capital ?? 0;
  const out: MenuEntry[] = [];
  for (const bloc of ctx.view.blocs) {
    for (const option of bloc.options) {
      if (option.target !== target) continue;
      out.push({
        label: vt("menu.proposal", {
          measure: measureName(
            names,
            option.kind,
            option.target,
            option.direction,
          ),
          bloc: vt(`bloc.${bloc.id}.name`),
        }),
        hint: vt("menu.proposal-hint", {
          cost: option.cost,
          yes: option.projection.yes,
          no: option.projection.no,
        }),
        disabled: capital < option.cost ? vt("menu.no-capital") : null,
        run: () =>
          ctx.apply({
            type: "bloc-propose",
            bloc: bloc.id,
            kind: option.kind,
            target,
            direction: option.direction,
          }),
      });
    }
  }
  if (out.length === 0) {
    out.push({
      label: vt("menu.no-proposal"),
      disabled: vt("menu.no-proposal-why"),
    });
  }
  return out;
}

// --- fronts near the point ----------------------------------------------------------

interface NearSegment {
  front: FrontView;
  index: number;
  distance: number; // tiles
}

// The segment of the player's fronts nearest the point (tiles), among the
// fronts against `enemy` (all of the player's fronts when null).
export function nearestSegment(
  view: ReadonlyWorldView,
  overlay: MapOverlay | null,
  x: number | null,
  y: number | null,
  enemy: NationId | null,
): NearSegment | null {
  const me = view.playerNation;
  if (overlay === null || me === null || x === null || y === null) return null;
  let best: NearSegment | null = null;
  for (const front of view.fronts) {
    if (front.a !== me && front.b !== me) continue;
    const other = front.a === me ? front.b : front.a;
    if (enemy !== null && other !== enemy) continue;
    const lines = overlay.fronts.find((f) => f.id === front.id);
    if (lines === undefined) continue;
    for (const line of lines.segments) {
      const pts = line.points;
      for (let i = 0; i + 1 < pts.length; i += 2) {
        const d = Math.hypot(pts[i] - x, pts[i + 1] - y);
        if (best === null || d < best.distance) {
          best = { front, index: line.index, distance: d };
        }
      }
    }
  }
  return best;
}

// Divisions sent to a segment by "Attaquer ici" and "Percer vers ce point",
// at most `room` — what the segment still supplies in full: beyond, a
// division adds nothing to the force of the segment (sim/war/fronts.ts) —
// from the reserve, else from the divisions held for the whole front, else
// half of the most staffed other segment of the front.
export function divisionsFor(
  divisions: readonly Division[],
  front: string,
  segment: number,
  room: number,
): { ids: number[]; from: "reserve" | "front" | "full" | number | null } {
  if (room < 1) return { ids: [], from: "full" };
  const take = (list: readonly Division[]) =>
    list.slice(0, room).map((d) => d.id);
  const reserve = divisions.filter((d) => d.front === null);
  if (reserve.length > 0) return { ids: take(reserve), from: "reserve" };
  const pool = divisions.filter((d) => d.front === front && d.segment === null);
  if (pool.length > 0) return { ids: take(pool), from: "front" };
  const bySegment = new Map<number, number[]>();
  for (const d of divisions) {
    if (d.front !== front || d.segment === null || d.segment === segment) {
      continue;
    }
    bySegment.set(d.segment, [...(bySegment.get(d.segment) ?? []), d.id]);
  }
  let richest: [number, number[]] | null = null;
  for (const entry of bySegment) {
    if (richest === null || entry[1].length > richest[1].length) {
      richest = entry;
    }
  }
  if (richest === null || richest[1].length < 2) return { ids: [], from: null };
  return {
    ids: richest[1].slice(0, Math.min(room, Math.floor(richest[1].length / 2))),
    from: richest[0],
  };
}

function divisionCount(count: number): string {
  if (count === 0) return vt("menu.divisions-none");
  return count === 1
    ? vt("menu.divisions-one")
    : vt("menu.divisions-many", { count });
}

function movedText(
  moved: ReturnType<typeof divisionsFor>,
  segment: number,
): string {
  const params = {
    divisions: divisionCount(moved.ids.length),
    segment: segment + 1,
  };
  if (moved.from === "full") return vt("menu.moved-full", params);
  if (moved.from === "reserve") return vt("menu.moved-reserve", params);
  if (moved.from === "front") return vt("menu.moved-front", params);
  if (typeof moved.from === "number") {
    return vt("menu.moved-segment", { ...params, from: moved.from + 1 });
  }
  return vt("menu.moved-none", params);
}

// --- an enemy at war ---------------------------------------------------------------

function warMenu(
  ctx: MenuContext,
  me: NationId,
  enemy: NationId,
  names: Names,
): MenuEntry[] {
  const { view } = ctx;
  const cfg = dataSource.config();
  const near = nearestSegment(view, ctx.overlay, ctx.x, ctx.y, enemy);
  const reach = ctx.overlay?.segmentTiles ?? 0;
  const inReach = near !== null && near.distance <= reach;
  const divisions = own(view)?.military?.divisions ?? [];
  const onSegment = (d: Division) =>
    near !== null && d.front === near.front.id && d.segment === near.index;
  // No more than the segment supplies in full.
  const segmentView = near?.front.segments.find((s) => s.index === near.index);
  const side = segmentView === undefined ? null : ownSide(view, segmentView);
  const room = Math.floor(
    (side?.capacity ?? Infinity) - divisions.filter(onSegment).length,
  );
  const moved =
    near === null
      ? null
      : divisionsFor(divisions, near.front.id, near.index, room);
  const noForce =
    moved !== null && moved.ids.length === 0 && !divisions.some(onSegment)
      ? vt("menu.no-division-anywhere")
      : null;
  const order = (posture: "attack" | "breakthrough") => async () => {
    if (near === null || moved === null) return;
    for (const id of moved.ids) {
      await ctx.apply({
        type: "assign-division",
        division: id,
        front: near.front.id,
        segment: near.index,
      });
    }
    const on = new Set(moved.ids);
    for (const d of divisions) if (onSegment(d)) on.add(d.id);
    for (const id of on) {
      await ctx.apply({ type: "set-posture", division: id, posture });
    }
    if (posture === "breakthrough" && ctx.info.tile >= 0) {
      await ctx.apply({
        type: "set-objective",
        front: near.front.id,
        segment: near.index,
        tile: ctx.info.tile,
      });
    }
  };
  const segmentHint = (posture: "attack" | "breakthrough") =>
    near === null || moved === null
      ? undefined
      : vt("menu.posture-all", {
          moved: movedText(moved, near.index),
          posture: vt(`posture.${posture}`),
        }) + (posture === "breakthrough" ? vt("menu.breakthrough-note") : "");
  const frontBlock =
    ctx.x === null
      ? vt("menu.pick-point")
      : !inReach
        ? vt("menu.no-front")
        : noForce;
  const air = airStrikeBlock(view, cfg.air.cooldownDays, enemy);
  const nuclear = nuclearBlock(view, enemy);
  const warheads = own(view)?.nuclear?.warheads ?? 0;
  return [
    {
      label: vt("menu.attack-here"),
      hint: segmentHint("attack"),
      disabled: frontBlock,
      run: order("attack"),
    },
    {
      label: vt("menu.breakthrough"),
      hint: segmentHint("breakthrough"),
      disabled: frontBlock,
      run: order("breakthrough"),
    },
    {
      label: vt("menu.landing"),
      hint: vt("menu.landing-hint", {
        control: percent(cfg.naval.landingControl),
      }),
      disabled: inReach ? vt("menu.landing-front") : null,
      run: () => ctx.apply({ type: "landing", target: enemy }),
    },
    {
      label: vt("menu.air-strike"),
      hint: vt("menu.air-strike-hint", {
        superiority: airSeen(view, enemy),
        share: percent(cfg.air.targetedShare),
        days: cfg.air.cooldownDays,
      }),
      disabled: air,
      run: () => ctx.apply({ type: "air-strike", target: enemy }),
    },
    {
      label: vt("menu.nuclear"),
      hint: vt("menu.nuclear-hint", { warheads }),
      disabled: nuclear,
      children: () =>
        (["front", "capital"] as const).map((aim) => ({
          label: vt(`screen.nuclear.fire-${aim}`, {
            nation: names.nation(enemy),
          }),
          run: () => nuclearLaunchConfirmed(names, enemy, aim, ctx.apply),
        })),
    },
    { label: vt("menu.card"), run: () => ctx.openCard(enemy) },
  ];
}

// The air superiority of the player over the enemy (sim/air/air.ts) as it
// knows the enemy's air power.
function airSeen(view: ReadonlyWorldView, enemy: NationId): string {
  const mine = own(view)?.military?.airPower ?? 0;
  const of = (theirs: number) =>
    mine + theirs > 0 ? mine / (mine + theirs) : 0.5;
  const p = seen(view, enemy, "airPower");
  if (p.kind === "exact") return percent(of(p.value));
  if (p.kind === "range") {
    return `${percent(of(p.high))} – ${percent(of(p.low))}`;
  }
  return vt("intel.unknown");
}

// --- the player's land -------------------------------------------------------------

function ownMenu(ctx: MenuContext, me: NationId, names: Names): MenuContent {
  const { view } = ctx;
  const cfg = dataSource.config();
  const near = nearestSegment(view, ctx.overlay, ctx.x, ctx.y, null);
  // Deep in its own land, a front a few segments away is still the one the
  // divisions go to.
  const reach = 3 * (ctx.overlay?.segmentTiles ?? 0);
  const best = near !== null && near.distance <= reach ? near : null;
  const divisions = own(view)?.military?.divisions ?? [];
  const reserve = divisions.filter((d) => d.front === null);
  const onBest =
    best === null
      ? []
      : divisions.filter(
          (d) => d.front === best.front.id && d.segment === best.index,
        );
  const noFront =
    ctx.x === null
      ? vt("menu.pick-point")
      : best === null
        ? vt("menu.no-front")
        : null;
  const segment = best === null ? 0 : best.index + 1;
  const against =
    best === null
      ? ""
      : names.nation(best.front.a === me ? best.front.b : best.front.a);
  const prices = cfg.budget.structureCostUsd;
  return {
    title: names.nation(me),
    entries: [
      {
        label: vt("menu.build"),
        hint: vt("menu.build-hint"),
        disabled: ctx.info.tile < 0 ? vt("menu.pick-point") : null,
        children: async () =>
          (await ctx.buildables()).map((b) => {
            const days = Math.ceil(
              (ctx.durations.get(b.type) ?? 0) / TICKS_PER_DAY,
            );
            return {
              label:
                b.canUpgrade !== false
                  ? vt("menu.upgrade", { structure: structureName(b.type) })
                  : structureName(b.type),
              hint: vt("menu.build-cost", {
                cost: usd(prices[b.type] ?? 0),
                days:
                  days <= 1
                    ? vt("menu.days-one")
                    : vt("menu.days-many", { count: days }),
              }),
              disabled:
                b.canBuild === false && b.canUpgrade === false
                  ? vt("menu.cannot-build")
                  : null,
              run: () => ctx.build(b),
            };
          }),
      },
      {
        label: vt("menu.move-troops"),
        hint:
          best === null
            ? undefined
            : vt("menu.move-troops-hint", { segment, nation: against }),
        disabled: noFront,
        children: () => [
          {
            label: vt("menu.send-reserve", {
              divisions: divisionCount(reserve.length),
              segment,
            }),
            disabled: reserve.length === 0 ? vt("menu.no-reserve") : null,
            run: async () => {
              for (const d of reserve) {
                await ctx.apply({
                  type: "assign-division",
                  division: d.id,
                  front: best!.front.id,
                  segment: best!.index,
                });
              }
            },
          },
          {
            label: vt("menu.recall", {
              divisions: divisionCount(onBest.length),
              segment,
            }),
            disabled: onBest.length === 0 ? vt("menu.no-division") : null,
            run: async () => {
              for (const d of onBest) {
                await ctx.apply({
                  type: "assign-division",
                  division: d.id,
                  front: null,
                  segment: null,
                });
              }
            },
          },
        ],
      },
      {
        label: vt("menu.fortify"),
        hint:
          best === null
            ? undefined
            : vt("menu.fortify-hint", {
                divisions: divisionCount(onBest.length),
                segment,
              }),
        disabled:
          noFront ?? (onBest.length === 0 ? vt("menu.no-division") : null),
        run: async () => {
          for (const d of onBest) {
            await ctx.apply({
              type: "set-posture",
              division: d.id,
              posture: "defend",
            });
          }
        },
      },
      { label: vt("menu.card"), run: () => ctx.openCard(me) },
    ],
  };
}

// --- the sea -----------------------------------------------------------------------

function seaMenu(ctx: MenuContext, me: NationId, names: Names): MenuContent {
  const { view, info } = ctx;
  const zone = info.zone;
  if (zone === null) return { title: vt("menu.sea"), entries: [] };
  // The fleets at sea are seen: the control of a zone is public.
  const control = view.naval.control[zone] ?? {};
  const shares = Object.entries(control)
    .filter(([, v]) => v >= 0.05)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([n, v]) => `${names.nation(n)} ${percent(v)}`)
    .join(", ");
  const enemies = playerEnemies(view);
  const deployment = view.naval.deployments[me];
  const here =
    deployment !== undefined &&
    Object.keys(deployment).length === 1 &&
    deployment[zone] !== undefined;
  const fleet = own(view)?.military?.navalPower ?? 0;
  return {
    title: vt(`sea.${zone}`),
    subtitle: vt("menu.zone-control", {
      shares: shares === "" ? vt("menu.zone-empty") : shares,
    }),
    entries: [
      {
        label: vt("menu.fleet-here"),
        hint: vt("menu.fleet-here-hint"),
        disabled:
          fleet <= 0
            ? vt("menu.no-fleet")
            : here
              ? vt("menu.fleet-already")
              : null,
        run: () => ctx.apply({ type: "set-fleet", zone }),
      },
      {
        label: vt("menu.fleet-home"),
        hint: vt("menu.fleet-home-hint"),
        disabled: deployment === undefined ? vt("menu.fleet-at-home") : null,
        run: () => ctx.apply({ type: "set-fleet", zone: null }),
      },
      {
        label: vt("menu.blockade"),
        hint: vt("menu.blockade-hint"),
        disabled:
          fleet <= 0
            ? vt("menu.no-fleet")
            : enemies.length === 0
              ? vt("menu.no-enemy")
              : null,
        children: () =>
          enemies.map((e) => ({
            label: names.nation(e),
            run: () =>
              ctx.apply({ type: "set-blockade", target: e, active: true }),
          })),
      },
    ],
  };
}
