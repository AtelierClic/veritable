import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";
import { dataSource, loadNation } from "../data/catalog";
import { vt } from "../data/i18n";
import { NationId } from "../data/schemas/common";
import { relation } from "../sim/diplomacy/diplomacy";
import {
  INTEL_CATEGORIES,
  IntelCategory,
  IntelMetric,
  Perceived,
} from "../sim/intel/intel";
import { ReadonlyWorldView } from "../sim/VeritableSim";
import { campaignController } from "./CampaignController";
import { longDate } from "./format";
import {
  dataAge,
  intelSetting,
  intentionsOf,
  levelsOn,
  nuclearPowers,
  onIntelSetting,
  publicPolitics,
  relationTrend,
  seen,
  shown,
  unrestSeen,
} from "./intel";
import { regionName, viewNames } from "./journalText";

// The card of a nation (J7b): opened by a right click on the map near the
// cursor, and from the journal, the diplomacy and the event cards; it does
// not pause the game; Escape or a click elsewhere closes it. Public facts
// (flag, name, regime, leader, capital, blocs, wars, public sanctions, the
// population to within 5 %), the relation with the player and the terms of
// its affinity, what stands between the two, then every figure by what the
// player's intelligence sees (sim/intel), with the age of the figure.

const MONEY = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const INTEGER = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
// A share in per cent; what rounds to zero shows without a sign.
const pct = (v: number, digits = 1) => {
  const shown = Math.abs(v * 100) < 0.5 * 10 ** -digits ? 0 : v * 100;
  return `${shown.toLocaleString("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} %`;
};
const usd = (v: number) =>
  v >= 1e12
    ? `${MONEY.format(v / 1e12)} T$`
    : v >= 1e9
      ? `${MONEY.format(v / 1e9)} Md$`
      : `${MONEY.format(v / 1e6)} M$`;
const people = (v: number) =>
  v >= 1e6
    ? `${MONEY.format(v / 1e6)} M`
    : v >= 1e3
      ? `${INTEGER.format(v / 1e3)} k`
      : INTEGER.format(v);

// The figures of each category, and how each reads.
const SECTIONS: Record<
  Exclude<IntelCategory, "general" | "intentions">,
  { metric: IntelMetric; format: (v: number) => string }[]
> = {
  economy: [
    { metric: "gdp", format: usd },
    { metric: "gdpPerCapita", format: (v) => `${INTEGER.format(v)} $` },
    { metric: "growth", format: (v) => pct(v) },
    { metric: "debtToGdp", format: (v) => pct(v, 0) },
    { metric: "deficitToGdp", format: (v) => pct(v) },
    { metric: "shortage", format: (v) => pct(v, 0) },
  ],
  politics: [
    { metric: "stability", format: (v) => pct(v, 0) },
    { metric: "legitimacy", format: (v) => pct(v, 0) },
  ],
  army: [
    { metric: "divisions", format: (v) => INTEGER.format(v) },
    { metric: "men", format: people },
    { metric: "equipment", format: (v) => pct(v, 0) },
    { metric: "airPower", format: (v) => MONEY.format(v) },
    { metric: "navalPower", format: (v) => MONEY.format(v) },
    { metric: "power", format: (v) => INTEGER.format(v) },
    { metric: "defenseShare", format: (v) => pct(v) },
    { metric: "exhaustion", format: (v) => pct(v, 0) },
  ],
  nuclear: [
    { metric: "warheads", format: (v) => INTEGER.format(v) },
    {
      metric: "threat",
      format: (v) => vt(`screen.nuclear.threat-${Math.round(v)}`),
    },
    { metric: "nuclearRisk", format: (v) => pct(365 * v, 2) },
    { metric: "deadHand", format: (v) => pct(v, 0) },
  ],
};

const TERMS = [
  "blocs",
  "ideology",
  "sanctions",
  "allyAtWar",
  "mistrust",
  "claims",
  "guarantee",
] as const;

@customElement("veritable-nation-card")
export class NationCard extends LitElement {
  @state() private nation: NationId | null = null;
  @state() private view: ReadonlyWorldView | null = null;
  private x = 0;
  private y = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopSetting: (() => void) | null = null;
  // The diplomacy screen on a nation; the action menu at a point.
  onDiplomacy: ((nation: NationId) => void) | null = null;
  onActions: ((nation: NationId, x: number, y: number) => void) | null = null;

  createRenderRoot() {
    return this;
  }

  isOpen(): boolean {
    return this.nation !== null;
  }

  async open(nation: NationId, x: number, y: number): Promise<void> {
    const reopen = this.nation !== null;
    this.nation = nation;
    this.x = x;
    this.y = y;
    await this.refresh(true);
    if (reopen) return;
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("pointerdown", this.onPointer, true);
    this.timer = setInterval(() => void this.refresh(false), 1000);
    this.stopSetting = onIntelSetting(() => this.requestUpdate());
  }

  close(): void {
    this.nation = null;
    this.view = null;
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("pointerdown", this.onPointer, true);
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.stopSetting?.();
    this.stopSetting = null;
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape" || this.nation === null) return;
    e.stopPropagation();
    this.close();
  };

  private onPointer = (e: PointerEvent): void => {
    if (this.nation === null) return;
    if (this.contains(e.target as Node)) return;
    this.close();
  };

  private async refresh(force: boolean): Promise<void> {
    const sim = campaignController().remote();
    const nation = this.nation;
    if (sim === null || nation === null) return;
    const player = this.view?.playerNation ?? null;
    const embargoes = [nation, player].filter(
      (id): id is string => id !== null,
    );
    try {
      const view = await sim.readIfChanged(
        force ? undefined : this.view?.version,
        embargoes,
      );
      if (view !== null && this.nation === nation) this.view = view;
    } catch {
      this.close();
    }
  }

  render() {
    const view = this.view;
    const id = this.nation;
    if (view === null || id === null) return nothing;
    const names = viewNames(view);
    const top = Math.max(
      (document.querySelector("veritable-topbar > div")?.getBoundingClientRect()
        .bottom ?? 40) + 4,
      Math.min(this.y + 12, window.innerHeight * 0.3),
    );
    const left = Math.max(8, Math.min(this.x + 12, window.innerWidth - 376));
    return html`<div
      class="fixed z-[1100] max-h-[70vh] w-[22rem] max-w-[calc(100vw-16px)] overflow-y-auto rounded border border-gray-500 bg-gray-900/95 p-2 text-xs text-white shadow-lg"
      style="left:${left}px;top:${top}px"
    >
      ${this.header(view, id, names.nation(id))}
      ${id === view.playerNation ? nothing : this.relationSection(view, id)}
      ${id === view.playerNation ? nothing : this.between(view, id)}
      ${this.figures(view, id)}
      <div class="mt-2 flex gap-1">
        <button
          class="rounded bg-gray-700 px-2 hover:bg-gray-600"
          @click=${() => {
            this.onDiplomacy?.(id);
            this.close();
          }}
        >
          ${vt("card.diplomacy")}
        </button>
        ${this.onActions === null
          ? nothing
          : html`<button
              class="rounded bg-gray-700 px-2 hover:bg-gray-600"
              @click=${() => {
                this.onActions?.(id, this.x, this.y);
                this.close();
              }}
            >
              ${vt("card.actions")}
            </button>`}
      </div>
    </div>`;
  }

  private header(
    view: ReadonlyWorldView,
    id: NationId,
    name: string,
  ): TemplateResult {
    const flag = dataSource.flags()[id];
    const politics = publicPolitics(view, id);
    const sheet = safeSheet(id);
    const blocs = view.blocs
      .filter((b) =>
        b.members.some((m) => m.nation === id && m.status === "full"),
      )
      .map((b) => vt(`bloc.${b.id}.name`));
    const wars = view.diplomacy.wars.filter(
      (w) => w.aggressors.includes(id) || w.defenders.includes(id),
    );
    const enemies = wars.flatMap((w) =>
      w.aggressors.includes(id) ? w.defenders : w.aggressors,
    );
    const sanctionedBy = view.diplomacy.sanctions.filter(
      (s) => s.against === id,
    ).length;
    const population = seen(view, id, "population");
    const unrest = unrestSeen(view, id);
    return html`
      <div class="flex items-start gap-2">
        ${flag === undefined
          ? html`<span
              class="mt-0.5 inline-block h-5 w-8 shrink-0 rounded bg-gray-600"
            ></span>`
          : html`<img
              class="mt-0.5 h-5 w-8 shrink-0 rounded object-cover"
              src=${assetUrl(`flags/${flag}.svg`)}
              alt=""
            />`}
        <div class="min-w-0 flex-1">
          <div class="text-sm font-bold">
            ${name}${unrest === true
              ? html` <span class="text-red-300">⚠</span>`
              : nothing}
          </div>
          <div class="text-gray-300">
            ${politics === null ? "" : vt(`regime.${politics.regime}`)}
            ${politics === null
              ? ""
              : html` ·
                ${politics.leader.name.kind === "key"
                  ? vt(politics.leader.name.key)
                  : politics.leader.name.text}`}
          </div>
        </div>
        <button
          class="rounded bg-gray-700 px-1 hover:bg-gray-600"
          title=${vt("card.close")}
          @click=${() => this.close()}
        >
          ✕
        </button>
      </div>
      <div class="mt-1 text-gray-300">
        ${sheet === null
          ? nothing
          : html`<div>
              ${vt("card.capital", { city: vt(sheet.capital.name) })}
            </div>`}
        <div>
          ${vt("card.blocs", {
            list: blocs.length === 0 ? vt("card.none") : blocs.join(", "),
          })}
        </div>
        <div>
          ${vt("card.population", {
            value: shown(population, people),
          })}
        </div>
        ${enemies.length === 0
          ? nothing
          : html`<div class="text-red-300">
              ${vt("card.wars", {
                list: [...new Set(enemies)]
                  .map((e) => viewNames(view).nation(e))
                  .join(", "),
              })}
            </div>`}
        ${sanctionedBy === 0
          ? nothing
          : html`<div class="text-yellow-300">
              ${vt("card.sanctioned-by", { count: sanctionedBy })}
            </div>`}
      </div>
    `;
  }

  private relationSection(
    view: ReadonlyWorldView,
    id: NationId,
  ): TemplateResult {
    const me = view.playerNation!;
    const r = relation(view.diplomacy, me, id);
    const history = relationTrend(view, id);
    const trend = history?.delta ?? null;
    const since = history?.since;
    const terms = view.intel.relationTerms[id];
    const atWar = view.diplomacy.wars.some(
      (w) =>
        (w.aggressors.includes(me) && w.defenders.includes(id)) ||
        (w.defenders.includes(me) && w.aggressors.includes(id)),
    );
    const signed = (v: number) =>
      Math.round(Math.abs(v)) === 0
        ? "0"
        : `${v > 0 ? "+" : "−"}${INTEGER.format(Math.abs(v))}`;
    return html`
      <div class="mt-2 font-bold">
        ${vt("card.relation", { value: signed(r) })}
        ${trend === null
          ? nothing
          : html`<span
              class=${trend > 0.5
                ? "text-green-300"
                : trend < -0.5
                  ? "text-red-300"
                  : "text-gray-300"}
            >
              ${trend > 0.5 ? "▲" : trend < -0.5 ? "▼" : "■"}
              ${vt("card.trend", {
                delta: signed(trend),
                since: since === undefined ? "" : longDate(since),
              })}</span
            >`}
      </div>
      ${atWar
        ? html`<div class="text-red-300">${vt("card.relation-war")}</div>`
        : terms === undefined
          ? nothing
          : html`<div class="text-gray-300">
                ${vt("card.affinity", { total: signed(terms.total) })}
              </div>
              <table class="w-full">
                ${TERMS.filter((t) => Math.round(terms[t]) !== 0).map(
                  (t) =>
                    html`<tr>
                      <td class="opacity-80">${vt(`card.term.${t}`)}</td>
                      <td
                        class="text-right tabular-nums ${terms[t] > 0
                          ? "text-green-300"
                          : "text-red-300"}"
                      >
                        ${signed(terms[t])}
                      </td>
                    </tr>`,
                )}
              </table>`}
    `;
  }

  private between(view: ReadonlyWorldView, id: NationId): TemplateResult {
    const me = view.playerNation!;
    const names = viewNames(view);
    const lines: string[] = [];
    for (const w of view.diplomacy.wars) {
      const mine = w.aggressors.includes(me) || w.defenders.includes(me);
      const theirs = w.aggressors.includes(id) || w.defenders.includes(id);
      if (!mine || !theirs) continue;
      const sameSide =
        (w.aggressors.includes(me) && w.aggressors.includes(id)) ||
        (w.defenders.includes(me) && w.defenders.includes(id));
      lines.push(
        vt(sameSide ? "card.allied-war" : "card.at-war", {
          date: longDate(w.since),
        }),
      );
    }
    if (view.diplomacy.sanctions.some((s) => s.by === me && s.against === id))
      lines.push(vt("card.sanctions-by-you"));
    if (view.diplomacy.sanctions.some((s) => s.by === id && s.against === me))
      lines.push(vt("card.sanctions-by-them"));
    const goods = (from: NationId, to: NationId) =>
      [
        ...new Set(
          view.market.embargoes
            .filter((e) => e.from === from && e.to === to)
            .map((e) => vt(`good.${e.good}`)),
        ),
      ].join(", ");
    const out = goods(me, id);
    const into = goods(id, me);
    if (out !== "") lines.push(vt("card.embargo-out", { goods: out }));
    if (into !== "") lines.push(vt("card.embargo-in", { goods: into }));
    for (const g of view.intel.guarantees) {
      if (g.guarantor === me && g.protected === id)
        lines.push(vt("card.guarantee-by-you"));
      if (g.guarantor === id && g.protected === me)
        lines.push(vt("card.guarantee-by-them"));
    }
    const claims = view.intel.claims[id];
    if (claims !== undefined) {
      if (claims.byPlayer.length > 0)
        lines.push(
          vt("card.claims-yours", {
            regions: claims.byPlayer
              .map((r) => regionName(names, r))
              .join(", "),
          }),
        );
      if (claims.byThem.length > 0)
        lines.push(
          vt("card.claims-theirs", {
            regions: claims.byThem.map((r) => regionName(names, r)).join(", "),
          }),
        );
    }
    return html`
      <div class="mt-2 font-bold">${vt("card.between")}</div>
      ${lines.length === 0
        ? html`<div class="text-gray-300">${vt("card.nothing-between")}</div>`
        : lines.map((l) => html`<div>${l}</div>`)}
    `;
  }

  private figures(view: ReadonlyWorldView, id: NationId): TemplateResult {
    const levels = levelsOn(view, id);
    const nuclear = nuclearPowers(view).find((p) => p.id === id);
    const row = (label: string, p: Perceived, format: (v: number) => string) =>
      html`<tr title=${dataAge(p, view.date)}>
        <td class="opacity-80">${label}</td>
        <td class="text-right tabular-nums">${shown(p, format)}</td>
      </tr>`;
    const section = (category: IntelCategory, body: unknown) => html`
      <div class="mt-2 flex items-baseline justify-between">
        <span class="font-bold">${vt(`intel.category.${category}`)}</span>
        <span class="text-gray-400"
          >${vt(`intel.level.${levels[category]}`)}</span
        >
      </div>
      ${body}
    `;
    const intentions = intentionsOf(view, id);
    return html`
      ${intelSetting() === "omniscient"
        ? html`<div class="mt-2 text-yellow-300">${vt("card.omniscient")}</div>`
        : nothing}
      ${INTEL_CATEGORIES.filter(
        (c) =>
          c !== "general" &&
          c !== "intentions" &&
          (c !== "nuclear" || nuclear !== undefined),
      ).map((category) => {
        const specs = SECTIONS[category as keyof typeof SECTIONS];
        const first = seen(view, id, specs[0].metric);
        const age = dataAge(first, view.date);
        return section(
          category,
          html`<table class="w-full">
              ${specs.map((s) =>
                row(
                  vt(`intel.metric.${s.metric}`),
                  seen(view, id, s.metric),
                  s.format,
                ),
              )}
              ${category === "nuclear" && nuclear !== undefined
                ? html`<tr>
                    <td class="opacity-80">${vt("screen.nuclear.doctrine")}</td>
                    <td class="text-right">
                      ${vt(`doctrine.${nuclear.doctrine}`)}
                    </td>
                  </tr>`
                : nothing}
            </table>
            ${age === ""
              ? nothing
              : html`<div class="text-right text-gray-400">${age}</div>`}`,
        );
      })}
      ${id === view.playerNation
        ? nothing
        : section(
            "intentions",
            intentions === null
              ? html`<div class="text-gray-400">
                  ${vt("card.intentions-hidden")}
                </div>`
              : html`<div>
                    ${intentions.intent === null
                      ? vt("card.intent-none")
                      : vt("card.intent-war", {
                          nation: viewNames(view).nation(
                            intentions.intent.target,
                          ),
                          casusBelli: vt(
                            `casus.${intentions.intent.casusBelli}`,
                          ),
                          ratio: MONEY.format(intentions.intent.ratio),
                        })}
                  </div>
                  <div>
                    ${vt("card.rearmament", {
                      current: pct(intentions.defense),
                      goal: pct(intentions.defenseGoal),
                    })}
                  </div>
                  <table class="w-full">
                    ${row(
                      vt("intel.metric.coupRisk"),
                      seen(view, id, "coupRisk"),
                      (v) => pct(v, 2),
                    )}
                  </table>`,
          )}
    `;
  }
}

function safeSheet(id: NationId) {
  try {
    return loadNation(id);
  } catch {
    return null;
  }
}

let card: NationCard | null = null;
export function nationCard(): NationCard {
  if (card === null) {
    card = document.createElement("veritable-nation-card") as NationCard;
    document.body.appendChild(card);
  }
  return card;
}
