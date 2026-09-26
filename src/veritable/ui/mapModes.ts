import { NationId } from "../data/schemas/common";
import type { MapColors } from "../sim/VeritableSim";

// The modes of the map (J7b): the colour of each nation by what the player
// wants to read — the political map (the colours of the nations), the
// relations with the player (a diverging scale readable by the colour
// blind: orange for hostile, blue for friendly), a bloc (its members, its
// candidates), the wars (the player's enemies and allies, the other
// belligerents), the population (the nations fade, the density of the
// people shows), the intelligence (the player's level on each nation).

export const MAP_MODES = [
  "political",
  "relations",
  "blocs",
  "wars",
  "population",
  "intel",
] as const;
export type MapMode = (typeof MAP_MODES)[number];

// One key a mode (the free letters of the keyboard of OpenFront: its keys
// build, zoom, move, pause and attack).
export const MODE_KEYS: Readonly<Record<MapMode, string>> = {
  political: "KeyV",
  relations: "KeyN",
  blocs: "KeyO",
  wars: "KeyX",
  population: "KeyH",
  intel: "KeyI",
};

// What the worker says of the nations for the modes (VeritableSim
// mapColors).
export type { MapColors };

export type Rgb = readonly [number, number, number];

const GREY: Rgb = [128, 132, 140];
const PLAYER: Rgb = [250, 250, 245];

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

// Orange (hostile) - light grey - blue (friendly): the PuOr / BrBG family
// of ColorBrewer, readable with the three common colour blindnesses.
const HOSTILE: Rgb = [230, 97, 1];
const NEUTRAL: Rgb = [224, 224, 214];
const FRIENDLY: Rgb = [33, 102, 172];

export function relationColor(relation: number): Rgb {
  return relation < 0
    ? mix(NEUTRAL, HOSTILE, -relation / 100)
    : mix(NEUTRAL, FRIENDLY, relation / 100);
}

// Level 0 to 3: from grey to a deep blue (one hue: the order reads without
// colour).
const INTEL_COLORS: readonly Rgb[] = [
  [200, 200, 196],
  [158, 202, 225],
  [66, 146, 198],
  [8, 69, 148],
];

export function intelColor(level: number): Rgb {
  return INTEL_COLORS[Math.max(0, Math.min(3, Math.round(level)))];
}

const ENEMY: Rgb = [215, 48, 39];
const ALLY_AT_WAR: Rgb = [69, 117, 180];
const OTHER_WAR: Rgb = [253, 174, 97];
const MEMBER: Rgb = [26, 152, 80];
const CANDIDATE: Rgb = [166, 217, 106];

// The colour of each nation in a mode; null: its own (the political map).
export function nationColors(
  mode: MapMode,
  colors: MapColors,
  nations: readonly NationId[],
  bloc: string | null,
): Map<NationId, Rgb> | null {
  if (mode === "political") return null;
  const out = new Map<NationId, Rgb>();
  const me = colors.player;
  const set = (id: NationId, rgb: Rgb) => out.set(id, rgb);
  switch (mode) {
    case "relations":
      for (const id of nations) {
        set(id, id === me ? PLAYER : relationColor(colors.relations[id] ?? 0));
      }
      break;
    case "intel":
      for (const id of nations) {
        set(id, id === me ? PLAYER : intelColor(colors.intel[id] ?? 0));
      }
      break;
    case "blocs": {
      const b = colors.blocs.find((x) => x.id === bloc);
      for (const id of nations) {
        set(
          id,
          b?.members.includes(id)
            ? MEMBER
            : b?.candidates.includes(id)
              ? CANDIDATE
              : GREY,
        );
      }
      break;
    }
    case "wars": {
      const enemies = new Set<NationId>();
      const allies = new Set<NationId>();
      const fighting = new Set<NationId>();
      for (const w of colors.wars) {
        for (const id of [...w.aggressors, ...w.defenders]) fighting.add(id);
        if (me === null) continue;
        const mine = w.aggressors.includes(me)
          ? w.aggressors
          : w.defenders.includes(me)
            ? w.defenders
            : null;
        if (mine === null) continue;
        const theirs = mine === w.aggressors ? w.defenders : w.aggressors;
        mine.forEach((id) => allies.add(id));
        theirs.forEach((id) => enemies.add(id));
      }
      for (const id of nations) {
        set(
          id,
          id === me
            ? PLAYER
            : enemies.has(id)
              ? ENEMY
              : allies.has(id)
                ? ALLY_AT_WAR
                : fighting.has(id)
                  ? OTHER_WAR
                  : GREY,
        );
      }
      break;
    }
    case "population":
      for (const id of nations) set(id, GREY);
      break;
  }
  return out;
}

// The bloc a blocs mode opens on: the player's own, an alliance before a
// union before a forum (France and the United States: NATO; Brazil:
// Mercosur); without one, the first bloc.
export function defaultBloc(
  colors: MapColors,
  typeOf: (bloc: string) => string | undefined,
): string | null {
  const rank = (id: string): number => {
    const t = typeOf(id);
    return t === "military-alliance" ? 0 : t === "economic-union" ? 1 : 2;
  };
  const me = colors.player;
  const mine = colors.blocs
    .filter((b) => me !== null && b.members.includes(me))
    .sort((a, b) => rank(a.id) - rank(b.id));
  return mine[0]?.id ?? colors.blocs[0]?.id ?? null;
}

// The density of the people of a tile (the levels of the population grid:
// round(steps x log2(1 + people)), a logarithmic scale), a ramp from a pale
// yellow to a deep purple (magma, readable by the colour blind); null for
// water and empty land.
export function densityColor(level: number, maxLevel: number): Rgb | null {
  if (level <= 0) return null;
  const t = Math.min(1, level / Math.max(1, maxLevel));
  const stops: readonly Rgb[] = [
    [252, 253, 191],
    [254, 176, 120],
    [241, 96, 93],
    [183, 55, 121],
    [114, 31, 129],
    [44, 17, 95],
  ];
  const at = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(at));
  return mix(stops[i], stops[i + 1], at - i);
}
