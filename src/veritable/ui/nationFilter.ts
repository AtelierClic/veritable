import { html, TemplateResult } from "lit";
import { loadNation } from "../data/catalog";
import { vt } from "../data/i18n";
import { relation } from "../sim/diplomacy/diplomacy";
import { ReadonlyWorldView } from "../sim/VeritableSim";
import { seenMiddle } from "./intel";

// Lists of nations at the scale of the world (J6c): search by name, filters
// by region of the world and by bloc, sort. Shared by the screens that list
// every nation (diplomacy, opinion, leaders).

export const NATION_SORTS = ["name", "relations", "stability", "gdp"] as const;
export type NationSort = (typeof NATION_SORTS)[number];

export interface NationFilter {
  search: string;
  // "" (all), "r:<region>" or "s:<subregion>" (world-region.<slug>).
  region: string;
  bloc: string; // "" (all) or a bloc id: its full members
  sort: NationSort;
}

export const NO_FILTER: NationFilter = {
  search: "",
  region: "",
  bloc: "",
  sort: "name",
};

// Case and accents ignored.
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const geographyCache = new Map<
  string,
  { region: string; subregion: string } | null
>();

export function geographyOf(
  id: string,
): { region: string; subregion: string } | null {
  if (!geographyCache.has(id)) {
    let found: { region: string; subregion: string } | null;
    try {
      found = loadNation(id).geography ?? null;
    } catch {
      found = null; // an id without a sheet
    }
    geographyCache.set(id, found);
  }
  return geographyCache.get(id)!;
}

export function filterNations(
  view: ReadonlyWorldView,
  ids: readonly string[],
  filter: NationFilter,
  label: (id: string) => string,
): string[] {
  const search = fold(filter.search.trim());
  const members =
    filter.bloc === ""
      ? null
      : new Set(
          view.blocs
            .find((b) => b.id === filter.bloc)
            ?.members.filter((m) => m.status === "full")
            .map((m) => m.nation) ?? [],
        );
  const kept = ids.filter((id) => {
    if (search !== "" && !fold(label(id)).includes(search)) return false;
    if (members !== null && !members.has(id)) return false;
    if (filter.region !== "") {
      const where = geographyOf(id);
      const [kind, slug] = filter.region.split(":");
      if (where === null) return false;
      if (kind === "r" && where.region !== slug) return false;
      if (kind === "s" && where.subregion !== slug) return false;
    }
    return true;
  });
  const me = view.playerNation;
  const key = (id: string): number => {
    switch (filter.sort) {
      case "relations":
        return me === null ? 0 : -relation(view.diplomacy, me, id);
      // J7b: by what the player knows (the middle of a range).
      case "stability":
        return seenMiddle(view, id, "stability");
      case "gdp":
        return -seenMiddle(view, id, "gdp");
      case "name":
        return 0;
    }
  };
  return kept
    .map((id) => ({ id, key: key(id), name: label(id) }))
    .sort((a, b) =>
      a.key !== b.key ? a.key - b.key : a.name.localeCompare(b.name, "fr"),
    )
    .map((x) => x.id);
}

// The regions and subregions present in a list, for the filter.
export function regionOptions(
  ids: readonly string[],
): { value: string; label: string }[] {
  const regions = new Map<string, Set<string>>();
  for (const id of ids) {
    const where = geographyOf(id);
    if (where === null) continue;
    if (!regions.has(where.region)) regions.set(where.region, new Set());
    regions.get(where.region)!.add(where.subregion);
  }
  const out: { value: string; label: string }[] = [];
  const byName = (a: string, b: string) =>
    vt(`world-region.${a}`).localeCompare(vt(`world-region.${b}`), "fr");
  for (const region of [...regions.keys()].sort(byName)) {
    out.push({ value: `r:${region}`, label: vt(`world-region.${region}`) });
    for (const sub of [...regions.get(region)!].sort(byName)) {
      out.push({
        value: `s:${sub}`,
        label: `  · ${vt(`world-region.${sub}`)}`,
      });
    }
  }
  return out;
}

export function renderNationFilter(
  view: ReadonlyWorldView,
  ids: readonly string[],
  shown: number,
  filter: NationFilter,
  sorts: readonly NationSort[],
  onChange: (next: NationFilter) => void,
): TemplateResult {
  const set = (patch: Partial<NationFilter>) =>
    onChange({ ...filter, ...patch });
  return html`<div class="mb-1 flex flex-wrap items-center gap-2">
    <input
      class="w-40 bg-gray-800 px-1"
      .value=${filter.search}
      placeholder=${vt("filter.search")}
      @input=${(e: Event) =>
        set({ search: (e.target as HTMLInputElement).value })}
    />
    <select
      class="bg-gray-800"
      @change=${(e: Event) =>
        set({ region: (e.target as HTMLSelectElement).value })}
    >
      <option value="" ?selected=${filter.region === ""}>
        ${vt("filter.all-regions")}
      </option>
      ${regionOptions(ids).map(
        (o) =>
          html`<option value=${o.value} ?selected=${filter.region === o.value}>
            ${o.label}
          </option>`,
      )}
    </select>
    <select
      class="bg-gray-800"
      @change=${(e: Event) =>
        set({ bloc: (e.target as HTMLSelectElement).value })}
    >
      <option value="" ?selected=${filter.bloc === ""}>
        ${vt("filter.all-blocs")}
      </option>
      ${view.blocs.map(
        (b) =>
          html`<option value=${b.id} ?selected=${filter.bloc === b.id}>
            ${vt(`bloc.${b.id}.name`)}
          </option>`,
      )}
    </select>
    <select
      class="bg-gray-800"
      @change=${(e: Event) =>
        set({ sort: (e.target as HTMLSelectElement).value as NationSort })}
    >
      ${sorts.map(
        (s) =>
          html`<option value=${s} ?selected=${filter.sort === s}>
            ${vt(`filter.sort.${s}`)}
          </option>`,
      )}
    </select>
    <span class="text-gray-400"
      >${vt("filter.count", {
        shown: String(shown),
        total: String(ids.length),
      })}</span
    >
  </div>`;
}
