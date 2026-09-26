import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { RemoteVeritableSim } from "../adapters/RemoteVeritableSim";
import { dataSource } from "../data/catalog";
import { vt } from "../data/i18n";
import { INTEREST_GROUPS } from "../data/schemas/common";
import { EventEffect } from "../data/schemas/event";
import { Law } from "../data/schemas/laws";
import { SPENDING_POSTS, TAX_IDS } from "../data/schemas/nation";
import { Ideology } from "../data/schemas/politics";
import {
  ActorState,
  Division,
  JournalEntry,
  NationEconomy,
  NationPolitics,
  PeaceTerms,
  War,
} from "../data/schemas/save";
import { TECH_DOMAINS, TechEffect } from "../data/schemas/tech";
import { CONSCRIPTION_LEVELS, POSTURES } from "../data/schemas/war";
import type { Tally } from "../sim/blocs/blocs";
import { relation } from "../sim/diplomacy/diplomacy";
import { entryCategory, JOURNAL_CATEGORIES } from "../sim/journal";
import {
  BlocView,
  FrontView,
  JournalPage,
  JournalQuery,
  JournalScope,
  ReadonlyWorldView,
} from "../sim/VeritableSim";
import { campaignController } from "./CampaignController";
import { confirmAction } from "./ConfirmModal";
import { effectLabel } from "./eventText";
import { longDate } from "./format";
import { journalLine, measureName, regionName, viewNames } from "./journalText";
import {
  filterNations,
  fold,
  NationFilter,
  NO_FILTER,
  regionOptions,
  renderNationFilter,
} from "./nationFilter";

export type ScreenId =
  | "economy"
  | "budget"
  | "opinion"
  | "war"
  | "diplomacy"
  | "politics"
  | "election"
  | "leaders"
  | "objectives"
  | "journal"
  | "blocs"
  | "tech"
  | "events";
export const SCREENS: ScreenId[] = [
  "economy",
  "budget",
  "opinion",
  "war",
  "diplomacy",
  "politics",
  "election",
  "leaders",
  "objectives",
  "journal",
  "blocs",
  "tech",
  "events",
];

// J7: the open screen reads the view when it changed (the simulation keeps
// a version of it), at most four times a second, and less often when a read
// costs the worker much (208 nations: tens of milliseconds of copy).
const REFRESH_MS = 250;
// Entries of the journal screen shown at first, and added by "more".
const JOURNAL_PAGE = 60;
const READ_COST_FACTOR = 8;

const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)} %`;
const money = (usd: number) =>
  Math.abs(usd) >= 1e12
    ? `${(usd / 1e12).toFixed(2)} T$`
    : `${(usd / 1e9).toFixed(1)} Md$`;
const quantity = (v: number) =>
  v >= 1000 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
const men = (v: number) => `${Math.round(v / 1000)} k`;

// The screens of a campaign: economy, budget, opinion (J2), fronts and
// divisions, diplomacy and sanctions (J3). Functional, ugly on purpose
// (polish is J7). They only read the world view and send commands.
@customElement("veritable-screens")
export class VeritableScreens extends LitElement {
  @state() private screen: ScreenId | null = null;
  @state() private view: ReadonlyWorldView | null = null;
  @state() private peaceTerms: PeaceTerms = {
    kind: "ceasefire",
    reparationsPctGdp: 0,
    reparationYears: 0,
    maxDivisions: null,
  };
  @state() private error: string | null = null;

  // Lists of every nation (J6c): search, region, bloc, sort; the nation
  // picked in the diplomacy list (its embargoes).
  @state() private filter: NationFilter = NO_FILTER;
  @state() private picked: string | null = null;

  private sim: RemoteVeritableSim | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private reading = false;
  private lastRead = 0;
  private readCost = 0;
  private readonly goods = dataSource.goods();
  private readonly config = dataSource.config();
  private readonly templates = dataSource.divisions();
  private readonly casusBelli = dataSource.casusBelli();
  private readonly laws = dataSource.laws();
  private readonly regimes = dataSource.regimes();
  private readonly objectives = dataSource.objectives();
  private readonly techNodes = dataSource.tech();
  private readonly eventCatalogue = dataSource.events();

  createRenderRoot() {
    return this;
  }

  attach(sim: RemoteVeritableSim): void {
    this.sim = sim;
  }

  detach(): void {
    this.sim = null;
    this.view = null;
    this.screen = null;
  }

  current(): ScreenId | null {
    return this.screen;
  }

  toggle(screen: ScreenId): void {
    this.screen = this.screen === screen ? null : screen;
    if (this.screen !== null) void this.refresh();
    this.dispatchEvent(new CustomEvent("screen-changed"));
  }

  // Opens a screen (a pop-up of an event opens the Events screen).
  show(screen: ScreenId): void {
    if (this.screen !== screen) this.toggle(screen);
    else void this.refresh();
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.timer = setInterval(() => {
      if (this.screen === null || this.reading) return;
      const wait = Math.max(REFRESH_MS, READ_COST_FACTOR * this.readCost);
      if (Date.now() - this.lastRead >= wait) void this.refresh(false);
    }, REFRESH_MS);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.timer !== null) clearInterval(this.timer);
  }

  // The whole view again (force), or only if it changed since the one on
  // screen; the embargoes of the player and of the nation picked only.
  private async refresh(force = true): Promise<void> {
    const sim = this.sim;
    if (sim === null) return;
    this.reading = true;
    const started = performance.now();
    try {
      const player = this.view?.playerNation ?? null;
      const embargoes = [player, this.picked].filter(
        (id): id is string => id !== null,
      );
      const view = await sim.readIfChanged(
        force ? undefined : this.view?.version,
        player === null ? undefined : embargoes,
      );
      if (view !== null && this.sim === sim) this.view = view;
    } catch {
      this.view = null;
    } finally {
      this.readCost = performance.now() - started;
      this.lastRead = Date.now();
      this.reading = false;
    }
  }

  private async command(
    command: Parameters<RemoteVeritableSim["apply"]>[0],
  ): Promise<void> {
    try {
      this.error = null;
      await this.sim?.apply(command);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    await this.refresh();
  }

  private nationLabel(view: ReadonlyWorldView, id: string): string {
    const nation = view.nations.find((n) => n.id === id);
    if (nation === undefined) return id;
    return nation.name.kind === "key" ? vt(nation.name.key) : nation.name.text;
  }

  // --- economy -----------------------------------------------------------------

  private renderEconomy(view: ReadonlyWorldView, e: NationEconomy) {
    return html`
      <div class="mb-1 flex flex-wrap gap-x-4">
        <span>${vt("screen.economy.gdp")} : <b>${money(e.gdp)}</b></span>
        <span
          >${vt("screen.economy.growth")} : <b>${pct(e.growthAnnual)}</b></span
        >
        <span
          >${vt("screen.economy.shortage")} : <b>${pct(e.shortage)}</b></span
        >
        <span
          >${vt("screen.economy.price-index")} :
          <b>${e.priceIndex.toFixed(3)}</b></span
        >
        <span
          >${vt("screen.economy.exports")} :
          <b>${money(e.exportsValue)}</b></span
        >
        ${e.tradeFactor < 0.999
          ? html`<span class="text-red-300"
              >${vt("screen.economy.trade-loss", {
                value: pct(1 - e.tradeFactor),
              })}</span
            >`
          : nothing}
      </div>
      <table class="w-full text-right">
        <thead>
          <tr class="text-gray-300">
            <th class="text-left">${vt("screen.economy.good")}</th>
            <th>${vt("screen.economy.production")}</th>
            <th>${vt("screen.economy.consumption")}</th>
            <th>${vt("screen.economy.imports")}</th>
            <th>${vt("screen.economy.exports")}</th>
            <th>${vt("screen.economy.price")}</th>
            <th>${vt("screen.economy.import-price")}</th>
            <th>${vt("screen.economy.coverage")}</th>
          </tr>
        </thead>
        <tbody>
          ${this.goods.map((good) => {
            const price = view.market.prices[good.id];
            const importPrice = view.market.importPrices[good.id];
            const coverage = e.coverage[good.id];
            return html`
              <tr class=${coverage < 0.98 ? "text-red-300" : ""}>
                <td class="text-left" title=${good.unit}>${vt(good.name)}</td>
                <td>${quantity(e.production[good.id])}</td>
                <td>${quantity(e.consumption[good.id])}</td>
                <td>${quantity(e.imports[good.id])}</td>
                <td>${quantity(e.exports[good.id])}</td>
                <td title=${`${price.toFixed(2)} M$`}>
                  ×${(price / good.basePrice).toFixed(3)}
                </td>
                <td>×${(importPrice / good.basePrice).toFixed(3)}</td>
                <td>${pct(coverage, 0)}</td>
              </tr>
            `;
          })}
        </tbody>
      </table>
      <div class="mt-1 text-gray-400">${vt("screen.economy.note")}</div>
    `;
  }

  // --- budget ------------------------------------------------------------------

  private slider(
    label: string,
    value: number,
    max: number,
    reference: number,
    onChange: (v: number) => void,
  ): TemplateResult {
    return html`
      <div class="flex items-center gap-2">
        <span class="w-40 truncate">${label}</span>
        <input
          type="range"
          class="flex-1"
          min="0"
          max=${max}
          step="0.001"
          .value=${String(value)}
          @change=${(event: Event) =>
            onChange(Number((event.target as HTMLInputElement).value))}
        />
        <span class="w-14 text-right tabular-nums">${pct(value)}</span>
        <span class="w-16 text-right text-gray-400 tabular-nums"
          >(${pct(reference)})</span
        >
      </div>
    `;
  }

  private renderBudget(
    e: NationEconomy,
    p: NationPolitics,
    constructionCost: number,
    blocNet: number,
  ) {
    const yearly = (monthly: number) => (monthly * 12) / e.gdp;
    const balance = e.revenue - e.expenditure;
    const budget = this.config.budget;
    return html`
      <div class="mb-1 grid grid-cols-2 gap-x-4">
        <span
          >${vt("screen.budget.revenue")} :
          <b>${pct(yearly(e.revenue))}</b></span
        >
        <span
          >${vt("screen.budget.expenditure")} :
          <b>${pct(yearly(e.expenditure))}</b></span
        >
        <span class=${balance < 0 ? "text-red-300" : "text-green-300"}
          >${vt("screen.budget.balance")} : <b>${pct(yearly(balance))}</b></span
        >
        <span
          >${vt("screen.budget.interest")} :
          <b>${pct(yearly(e.interest))}</b> (${pct(e.interestRate, 2)})</span
        >
        <span
          >${vt("screen.budget.debt")} :
          <b>${pct(e.debt / e.gdp, 0)}</b> (${money(e.debt)})</span
        >
        <span
          >${vt("screen.budget.constructions")} :
          <b>${money(constructionCost)}</b></span
        >
        <span
          >${vt("screen.budget.blocs")} :
          <b class=${blocNet < 0 ? "text-red-300" : "text-green-300"}
            >${money(blocNet)}</b
          ></span
        >
        <span class="text-yellow-300">
          ${e.austerity ? vt("screen.budget.austerity") : nothing}
          ${e.noDeficitUntil !== null
            ? vt("screen.budget.no-deficit", { date: e.noDeficitUntil })
            : nothing}
          ${p.reprimanded ? vt("screen.budget.reprimanded") : nothing}
        </span>
      </div>
      <div class="mt-1 font-bold">${vt("screen.budget.taxes")}</div>
      ${TAX_IDS.map((tax) =>
        this.slider(
          vt(`tax.${tax}`),
          e.taxes[tax],
          budget.maxTaxRate[tax],
          e.taxes0[tax],
          (rate) => void this.command({ type: "set-tax", tax, rate }),
        ),
      )}
      <div class="mt-1 font-bold">${vt("screen.budget.spending")}</div>
      ${SPENDING_POSTS.map((post) =>
        this.slider(
          vt(`spending.${post}`),
          e.spending[post],
          budget.maxSpendingShare,
          e.spending0[post],
          (share) => void this.command({ type: "set-spending", post, share }),
        ),
      )}
      <div class="mt-1 text-gray-400">${vt("screen.budget.note")}</div>
    `;
  }

  // --- opinion -----------------------------------------------------------------

  private bar(label: string, value: number, strong = false): TemplateResult {
    const color =
      value < 0.35
        ? "bg-red-500"
        : value < 0.5
          ? "bg-yellow-500"
          : "bg-green-500";
    return html`
      <div class="flex items-center gap-2 ${strong ? "font-bold" : ""}">
        <span class="w-40 truncate">${label}</span>
        <div class="h-2 flex-1 rounded bg-gray-700">
          <div
            class="h-2 rounded ${color}"
            style="width:${Math.round(value * 100)}%"
          ></div>
        </div>
        <span class="w-12 text-right tabular-nums">${pct(value, 0)}</span>
      </div>
    `;
  }

  private renderOpinion(view: ReadonlyWorldView, p: NationPolitics) {
    return html`
      ${this.bar(vt("screen.opinion.stability"), p.stability, true)}
      ${this.bar(vt("screen.opinion.opinion"), p.opinion, true)}
      ${p.unrest
        ? html`<div class="text-red-300">${vt("screen.opinion.unrest")}</div>`
        : nothing}
      <div class="mt-1 font-bold">${vt("screen.opinion.groups")}</div>
      ${p.groups === null
        ? nothing
        : INTEREST_GROUPS.map((g) => this.bar(vt(`group.${g}`), p.groups![g]))}
      <div class="mt-1 font-bold">${vt("screen.opinion.world")}</div>
      ${this.worldList(view, ["stability", "name", "gdp", "relations"], (ids) =>
        ids.map((id) =>
          this.bar(
            `${this.nationLabel(view, id)}${view.politics[id].unrest ? " ⚠" : ""}`,
            view.politics[id].stability,
          ),
        ),
      )}
    `;
  }

  // Every nation but the player's, filtered and sorted (J6c).
  private worldList(
    view: ReadonlyWorldView,
    sorts: readonly NationFilter["sort"][],
    render: (ids: string[]) => unknown,
  ): TemplateResult {
    const all = view.nations.filter((n) => !n.isPlayer).map((n) => n.id);
    const filter = sorts.includes(this.filter.sort)
      ? this.filter
      : { ...this.filter, sort: sorts[0] };
    const ids = filterNations(view, all, filter, (id) =>
      this.nationLabel(view, id),
    );
    return html`${renderNationFilter(
      view,
      all,
      ids.length,
      filter,
      sorts,
      (next) => (this.filter = next),
    )}${render(ids)}`;
  }

  // --- war: fronts and divisions --------------------------------------------------

  private renderDivision(
    view: ReadonlyWorldView,
    division: Division,
  ): TemplateResult {
    const me = view.playerNation;
    const fronts = view.fronts.filter((f) => f.a === me || f.b === me);
    const segments =
      fronts.find((f) => f.id === division.front)?.segments.length ?? 0;
    const assign = (front: string | null, segment: number | null) =>
      void this.command({
        type: "assign-division",
        division: division.id,
        front,
        segment,
      });
    return html`
      <tr>
        <td>${division.id}</td>
        <td class="text-left">${vt(`division.${division.template}`)}</td>
        <td>${men(division.men)}</td>
        <td>${pct(division.equipment, 0)}</td>
        <td>${division.training.toFixed(2)}</td>
        <td>
          <select
            class="bg-gray-800"
            .value=${division.front ?? ""}
            @change=${(e: Event) => {
              const v = (e.target as HTMLSelectElement).value;
              assign(v === "" ? null : v, null);
            }}
          >
            <option value="">${vt("screen.war.reserve")}</option>
            ${fronts.map(
              (f) =>
                html`<option value=${f.id} ?selected=${f.id === division.front}>
                  ${this.frontLabel(view, f)}
                </option>`,
            )}
          </select>
          ${division.front !== null && segments > 0
            ? html`<select
                class="ml-1 bg-gray-800"
                @change=${(e: Event) => {
                  const v = (e.target as HTMLSelectElement).value;
                  assign(division.front, v === "" ? null : Number(v));
                }}
              >
                <option value="" ?selected=${division.segment === null}>
                  ${vt("screen.war.whole-front")}
                </option>
                ${Array.from(
                  { length: segments },
                  (_, i) =>
                    html`<option value=${i} ?selected=${division.segment === i}>
                      ${vt("screen.war.segment", { index: i + 1 })}
                    </option>`,
                )}
              </select>`
            : nothing}
        </td>
        <td>
          <select
            class="bg-gray-800"
            @change=${(e: Event) =>
              void this.command({
                type: "set-posture",
                division: division.id,
                posture: (e.target as HTMLSelectElement).value as
                  | "defend"
                  | "attack"
                  | "breakthrough",
              })}
          >
            ${POSTURES.map(
              (p) =>
                html`<option value=${p} ?selected=${p === division.posture}>
                  ${vt(`posture.${p}`)}
                </option>`,
            )}
          </select>
        </td>
        <td>
          <button
            class="rounded bg-gray-700 px-1"
            @click=${() =>
              void this.command({
                type: "disband-division",
                division: division.id,
              })}
          >
            ${vt("screen.war.disband")}
          </button>
        </td>
      </tr>
    `;
  }

  private frontLabel(view: ReadonlyWorldView, front: FrontView): string {
    const me = view.playerNation;
    const other = front.a === me ? front.b : front.a;
    return vt("screen.war.front", { nation: this.nationLabel(view, other) });
  }

  private renderWar(view: ReadonlyWorldView) {
    const me = view.playerNation!;
    const m = view.military.nations[me];
    const sheetPopulation = m.divisions.reduce((s, d) => s + d.men, 0);
    const wars = view.diplomacy.wars.filter(
      (w) => w.aggressors.includes(me) || w.defenders.includes(me),
    );
    // Only the fronts of the player (the world view carries every front).
    const fronts = view.fronts.filter((f) => f.a === me || f.b === me);
    return html`
      <div class="mb-1 grid grid-cols-2 gap-x-4">
        <span
          >${vt("screen.war.manpower")} : <b>${men(m.manpower)}</b> (${vt(
            "screen.war.under-arms",
            { men: men(sheetPopulation) },
          )})</span
        >
        <span
          >${vt("screen.war.conscription")} :
          <select
            class="bg-gray-800"
            @change=${(e: Event) =>
              void this.command({
                type: "set-conscription",
                level: (e.target as HTMLSelectElement).value as
                  | "peace"
                  | "partial"
                  | "total",
              })}
          >
            ${CONSCRIPTION_LEVELS.map(
              (l) =>
                html`<option value=${l} ?selected=${l === m.conscription}>
                  ${vt(`conscription.${l}`)}
                </option>`,
            )}
          </select></span
        >
        <span>${vt("screen.war.losses")} : <b>${men(m.losses)}</b></span>
        <span
          >${vt("screen.war.training")} : <b>${m.training.toFixed(2)}</b> ·
          ${vt("screen.war.air")} : <b>${m.airPower.toFixed(2)}</b> ·
          ${vt("screen.war.naval")} : <b>${m.navalPower.toFixed(2)}</b></span
        >
      </div>
      ${this.bar(vt("screen.war.exhaustion"), m.exhaustion, true)}
      <div class="mt-1 flex flex-wrap gap-1">
        ${this.templates.map(
          (t) =>
            html`<button
              class="rounded bg-gray-700 px-2"
              title=${`${t.attack} / ${t.defense} / ${t.men} / ${t.arms}`}
              @click=${() =>
                void this.command({ type: "raise-division", template: t.id })}
            >
              ${vt("screen.war.raise", { template: vt(t.name) })}
            </button>`,
        )}
      </div>
      <div class="mt-1 font-bold">${vt("screen.war.wars")}</div>
      ${wars.length === 0
        ? html`<div class="text-gray-400">${vt("screen.war.no-war")}</div>`
        : wars.map((w) => this.renderWarEntry(view, w))}
      ${this.renderNuclear(view)}
      <div class="mt-1 font-bold">${vt("screen.war.fronts")}</div>
      ${fronts.length === 0
        ? html`<div class="text-gray-400">${vt("screen.war.no-front")}</div>`
        : fronts.map((f) => this.renderFront(view, f))}
      <div class="mt-1 font-bold">
        ${vt("screen.war.divisions", { count: m.divisions.length })}
      </div>
      <table class="w-full text-right">
        <thead>
          <tr class="text-gray-300">
            <th>#</th>
            <th class="text-left">${vt("screen.war.template")}</th>
            <th>${vt("screen.war.men")}</th>
            <th>${vt("screen.war.equipment")}</th>
            <th>${vt("screen.war.training")}</th>
            <th>${vt("screen.war.assignment")}</th>
            <th>${vt("screen.war.posture")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${m.divisions.map((d) => this.renderDivision(view, d))}
        </tbody>
      </table>
    `;
  }

  // Nuclear weapons (J5): the arsenal of the player, its threat level, the
  // risk that each nuclear power fires today, the dead hand of the enemies,
  // and the shot (two clicks).
  private renderNuclear(view: ReadonlyWorldView): TemplateResult {
    const me = view.playerNation!;
    const mine = view.nuclear.nations[me];
    const enemies = view.diplomacy.wars.flatMap((w) =>
      w.aggressors.includes(me)
        ? w.defenders
        : w.defenders.includes(me)
          ? w.aggressors
          : [],
    );
    const powers = Object.entries(view.nuclear.nations);
    const shot = (target: string, aim: "front" | "capital") => {
      const nation = this.nationLabel(view, target);
      return html`<button
        class="rounded bg-red-900 px-2"
        @click=${async () => {
          const ok = await confirmAction({
            title: vt("confirm.nuclear.title"),
            body: vt(`confirm.nuclear.body-${aim}`, { nation }),
            confirm: vt("confirm.nuclear.fire"),
          });
          if (!ok) return;
          void this.command({
            type: "nuclear-launch",
            target,
            aim,
            confirmed: true,
          });
        }}
      >
        ${vt(`screen.nuclear.fire-${aim}`, { nation })}
      </button>`;
    };
    return html`
      <div class="mt-1 font-bold">${vt("screen.nuclear.title")}</div>
      ${mine === undefined
        ? html`<div class="text-gray-400">${vt("screen.nuclear.none")}</div>`
        : html`<div>
            ${vt("screen.nuclear.arsenal", {
              warheads: mine.warheads,
              doctrine: vt(`doctrine.${mine.doctrine}`),
              threat: vt(`screen.nuclear.threat-${mine.threat}`),
            })}
          </div>`}
      <table class="w-full text-right">
        <thead>
          <tr class="text-gray-300">
            <th class="text-left">${vt("screen.nuclear.power")}</th>
            <th>${vt("screen.nuclear.warheads")}</th>
            <th>${vt("screen.nuclear.doctrine")}</th>
            <th>${vt("screen.nuclear.threat")}</th>
            <th>${vt("screen.nuclear.risk")}</th>
            <th>${vt("screen.nuclear.dead-hand")}</th>
          </tr>
        </thead>
        <tbody>
          ${powers.map(
            ([id, n]) =>
              html`<tr>
                <td class="text-left">${this.nationLabel(view, id)}</td>
                <td>${n.warheads}</td>
                <td>${vt(`doctrine.${n.doctrine}`)}</td>
                <td>${vt(`screen.nuclear.threat-${n.threat}`)}</td>
                <td>${pct(365 * (view.nuclearRisk[id] ?? 0), 2)}</td>
                <td>${pct(view.deadHand[id] ?? 0, 0)}</td>
              </tr>`,
          )}
        </tbody>
      </table>
      <div class="text-gray-400">${vt("screen.nuclear.risk-note")}</div>
      ${mine !== undefined && mine.warheads > 0 && enemies.length > 0
        ? html`<div class="mt-1 flex flex-wrap gap-1">
            ${[...new Set(enemies)].map(
              (enemy) => html`${shot(enemy, "front")}${shot(enemy, "capital")}`,
            )}
          </div>`
        : nothing}
      ${view.nuclear.strikes.length > 0
        ? html`<div class="mt-1">
            ${view.nuclear.strikes.slice(-5).map(
              (s) =>
                html`<div>
                  ${vt("screen.nuclear.strike", {
                    date: s.date,
                    by: this.nationLabel(view, s.by),
                    target: this.nationLabel(view, s.target),
                    status: vt(`screen.nuclear.status-${s.status}`),
                  })}
                </div>`,
            )}
          </div>`
        : nothing}
    `;
  }

  private renderWarEntry(view: ReadonlyWorldView, war: War): TemplateResult {
    const me = view.playerNation!;
    const mine = war.aggressors.includes(me);
    const enemies = mine ? war.defenders : war.aggressors;
    const offers = war.offers.filter((o) => o.to === me);
    return html`
      <div class="mb-1 border-l-2 border-red-500 pl-2">
        <div>
          ${war.aggressors.map((n) => this.nationLabel(view, n)).join(", ")}
          ${vt("screen.war.against")}
          ${war.defenders.map((n) => this.nationLabel(view, n)).join(", ")}
          (${war.since}) · ${vt("screen.war.score")} :
          <b>${(war.score[me] ?? 0).toFixed(1)}</b> ·
          ${vt("screen.war.retreat", { months: war.retreatMonths[me] ?? 0 })} ·
          ${vt("screen.war.tiles-taken", { count: war.tilesTaken[me] ?? 0 })}
        </div>
        ${offers.map(
          (o) =>
            html`<div class="text-yellow-300">
              ${vt("screen.war.offer", {
                nation: this.nationLabel(view, o.from),
                terms: vt(`peace.${o.terms.kind}`),
                reparations: pct(o.terms.reparationsPctGdp),
                years: o.terms.reparationYears,
              })}
              <button
                class="rounded bg-green-700 px-1"
                @click=${() =>
                  void this.command({
                    type: "answer-peace",
                    offer: o.id,
                    accept: true,
                  })}
              >
                ${vt("screen.war.accept")}
              </button>
              <button
                class="rounded bg-gray-700 px-1"
                @click=${() =>
                  void this.command({
                    type: "answer-peace",
                    offer: o.id,
                    accept: false,
                  })}
              >
                ${vt("screen.war.refuse")}
              </button>
            </div>`,
        )}
        <div class="flex flex-wrap items-center gap-1">
          <span>${vt("screen.war.propose")} :</span>
          <select
            class="bg-gray-800"
            @change=${(e: Event) =>
              (this.peaceTerms = {
                ...this.peaceTerms,
                kind: (e.target as HTMLSelectElement)
                  .value as PeaceTerms["kind"],
              })}
          >
            ${(["ceasefire", "cession", "annexation"] as const).map(
              (k) =>
                html`<option value=${k} ?selected=${k === this.peaceTerms.kind}>
                  ${vt(`peace.${k}`)}
                </option>`,
            )}
          </select>
          <label
            >${vt("screen.war.reparations")}
            <input
              class="w-14 bg-gray-800"
              type="number"
              min="0"
              max="20"
              step="0.5"
              .value=${String(this.peaceTerms.reparationsPctGdp * 100)}
              @change=${(e: Event) =>
                (this.peaceTerms = {
                  ...this.peaceTerms,
                  reparationsPctGdp:
                    Number((e.target as HTMLInputElement).value) / 100,
                })}
            />
            %</label
          >
          <label
            >${vt("screen.war.years")}
            <input
              class="w-12 bg-gray-800"
              type="number"
              min="0"
              max="50"
              .value=${String(this.peaceTerms.reparationYears)}
              @change=${(e: Event) =>
                (this.peaceTerms = {
                  ...this.peaceTerms,
                  reparationYears: Number((e.target as HTMLInputElement).value),
                })}
          /></label>
          <label
            >${vt("screen.war.max-divisions")}
            <input
              class="w-12 bg-gray-800"
              type="number"
              min="0"
              .value=${this.peaceTerms.maxDivisions === null
                ? ""
                : String(this.peaceTerms.maxDivisions)}
              @change=${(e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                this.peaceTerms = {
                  ...this.peaceTerms,
                  maxDivisions: v === "" ? null : Number(v),
                };
              }}
          /></label>
          ${enemies.map(
            (enemy) =>
              html`<button
                class="rounded bg-blue-700 px-2"
                @click=${() =>
                  void this.command({
                    type: "propose-peace",
                    war: war.id,
                    to: enemy,
                    terms: this.peaceTerms,
                  })}
              >
                ${vt("screen.war.propose-to", {
                  nation: this.nationLabel(view, enemy),
                })}
              </button>`,
          )}
        </div>
        ${this.peaceTerms.kind === "annexation"
          ? enemies
              .filter((enemy) => (view.deadHand[enemy] ?? 0) > 0)
              .map(
                (enemy) =>
                  html`<div class="text-red-300">
                    ${vt("screen.nuclear.dead-hand-warning", {
                      nation: this.nationLabel(view, enemy),
                      probability: pct(view.deadHand[enemy], 0),
                    })}
                  </div>`,
              )
          : nothing}
      </div>
    `;
  }

  private renderFront(
    view: ReadonlyWorldView,
    front: FrontView,
  ): TemplateResult {
    const me = view.playerNation!;
    const other = front.a === me ? front.b : front.a;
    return html`
      <div class="mb-1">
        <div class="font-bold text-red-300">
          ${this.frontLabel(view, front)}
        </div>
        <table class="w-full text-right">
          <thead>
            <tr class="text-gray-300">
              <th>${vt("screen.war.segment-col")}</th>
              <th>${vt("screen.war.tiles")}</th>
              <th>${vt("screen.war.terrain")}</th>
              <th>${vt("screen.war.mine")}</th>
              <th>${vt("screen.war.theirs")}</th>
              <th>${vt("screen.war.ratio")}</th>
              <th>${vt("screen.war.supply")}</th>
              <th>${vt("screen.war.moved")}</th>
            </tr>
          </thead>
          <tbody>
            ${front.segments.map((s) => {
              const mine = s.sides[me];
              const theirs = s.sides[other];
              const ratio =
                mine === undefined || theirs === undefined
                  ? 1
                  : theirs.force > 0
                    ? mine.force / theirs.force
                    : mine.force > 0
                      ? Infinity
                      : 1;
              return html`<tr
                class=${s.movedTo === me
                  ? "text-green-300"
                  : s.movedTo === other
                    ? "text-red-300"
                    : ""}
              >
                <td>${s.index + 1}</td>
                <td>${s.tiles}</td>
                <td>
                  ${pct(s.terrain.plains, 0)} / ${pct(s.terrain.highland, 0)} /
                  ${pct(s.terrain.mountain, 0)}
                </td>
                <td>
                  ${mine?.divisions.toFixed(1) ?? "0"} ·
                  ${mine?.force.toFixed(1) ?? "0"} ${mine?.attacking ? "⚔" : ""}
                </td>
                <td>
                  ${theirs?.divisions.toFixed(1) ?? "0"} ·
                  ${theirs?.force.toFixed(1) ?? "0"}
                  ${theirs?.attacking ? "⚔" : ""}
                </td>
                <td>${ratio === Infinity ? "∞" : ratio.toFixed(2)}</td>
                <td>${pct(mine?.supply ?? 1, 0)}</td>
                <td>
                  ${s.movedTo === null
                    ? "—"
                    : this.nationLabel(view, s.movedTo)}
                </td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>
    `;
  }

  // --- diplomacy and sanctions ------------------------------------------------------

  private renderDiplomacy(view: ReadonlyWorldView) {
    const me = view.playerNation!;
    const d = view.diplomacy;
    const all = view.nations.filter((n) => n.id !== me).map((n) => n.id);
    const others = filterNations(view, all, this.filter, (id) =>
      this.nationLabel(view, id),
    );
    const picked =
      this.picked !== null && all.includes(this.picked) ? this.picked : null;
    const enemies = new Set(
      d.wars.flatMap((w) =>
        w.aggressors.includes(me)
          ? w.defenders
          : w.defenders.includes(me)
            ? w.aggressors
            : [],
      ),
    );
    const blockading = Object.keys(d.wars.length > 0 ? {} : {});
    void blockading;
    const myDeployment = view.naval.deployments[me];
    return html`
      ${renderNationFilter(
        view,
        all,
        others.length,
        this.filter,
        ["name", "relations", "gdp", "stability"],
        (next) => (this.filter = next),
      )}
      <div class="max-h-96 overflow-y-auto">
        <table class="w-full text-right">
          <thead>
            <tr class="text-gray-300">
              <th class="text-left">${vt("screen.diplomacy.nation")}</th>
              <th>${vt("screen.diplomacy.relations")}</th>
              <th>${vt("screen.diplomacy.state")}</th>
              <th>${vt("screen.diplomacy.sanctions")}</th>
              <th>${vt("screen.diplomacy.war")}</th>
            </tr>
          </thead>
          <tbody>
            ${others.map((id) => {
              const r = relation(d, me, id);
              const atWar = enemies.has(id);
              const sanctioning = d.sanctions.some(
                (s) => s.by === me && s.against === id,
              );
              const sanctionedBy = d.sanctions.some(
                (s) => s.by === id && s.against === me,
              );
              const casus = view.casusBelli[id] ?? [];
              return html`<tr class=${id === picked ? "bg-gray-700" : ""}>
                <td class="text-left">
                  <button
                    class="underline decoration-dotted"
                    title=${vt("screen.diplomacy.pick")}
                    @click=${() => (this.picked = id)}
                  >
                    ${this.nationLabel(view, id)}
                  </button>
                </td>
                <td
                  class=${r < -40
                    ? "text-red-300"
                    : r > 30
                      ? "text-green-300"
                      : ""}
                >
                  ${r.toFixed(0)}
                </td>
                <td>
                  ${atWar
                    ? html`<span class="text-red-300"
                        >${vt("screen.diplomacy.at-war")}</span
                      >`
                    : nothing}
                  ${sanctionedBy
                    ? html`<span class="text-yellow-300"
                        >${vt("screen.diplomacy.sanctions-me")}</span
                      >`
                    : nothing}
                </td>
                <td>
                  <button
                    class="rounded px-1 ${sanctioning
                      ? "bg-yellow-700"
                      : "bg-gray-700"}"
                    @click=${() =>
                      void this.command({
                        type: "set-sanctions",
                        against: id,
                        active: !sanctioning,
                      })}
                  >
                    ${sanctioning
                      ? vt("screen.diplomacy.lift")
                      : vt("screen.diplomacy.sanction")}
                  </button>
                </td>
                <td>
                  ${atWar
                    ? html`<button
                          class="rounded px-1 ${myDeployment !== undefined
                            ? "bg-blue-800"
                            : "bg-gray-700"}"
                          @click=${() =>
                            void this.command({
                              type: "set-blockade",
                              target: id,
                              active: myDeployment === undefined,
                            })}
                        >
                          ${myDeployment !== undefined
                            ? vt("screen.diplomacy.recall")
                            : vt("screen.diplomacy.blockade")}
                        </button>
                        <button
                          class="rounded bg-gray-700 px-1"
                          @click=${() =>
                            void this.command({ type: "landing", target: id })}
                        >
                          ${vt("screen.diplomacy.landing")}
                        </button>`
                    : casus.map(
                        (c) =>
                          html`<button
                            class="rounded bg-red-800 px-1"
                            @click=${async () => {
                              const casus = vt(
                                this.casusBelli.find((cb) => cb.id === c)
                                  ?.name ?? c,
                              );
                              const ok = await confirmAction({
                                title: vt("confirm.war.title", {
                                  nation: this.nationLabel(view, id),
                                }),
                                body: vt("confirm.war.body", { casus }),
                                confirm: vt("confirm.war.declare"),
                              });
                              if (!ok) return;
                              void this.command({
                                type: "declare-war",
                                target: id,
                                casusBelli: c,
                              });
                            }}
                          >
                            ${vt("screen.diplomacy.declare", {
                              casus: vt(
                                this.casusBelli.find((cb) => cb.id === c)
                                  ?.name ?? c,
                              ),
                            })}
                          </button>`,
                      )}
                </td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>
      <div class="mt-1 font-bold">${vt("screen.diplomacy.sea")}</div>
      <div class="flex flex-wrap gap-x-3">
        ${Object.entries(view.naval.control).map(
          ([zone, shares]) =>
            html`<span
              >${vt(`sea.${zone}`)} : <b>${pct(shares[me] ?? 0, 0)}</b></span
            >`,
        )}
        <span
          >${vt("screen.diplomacy.blockaded")} :
          <b>${pct(view.naval.blockade[me] ?? 0, 0)}</b></span
        >
      </div>
      ${this.renderEmbargoes(view, me, picked)}
      <div class="mt-1 text-gray-400">${vt("screen.diplomacy.note")}</div>
    `;
  }

  // The embargoes of one pair, both ways (J6c: a matrix of 207 nations by
  // twelve goods did not fit the world).
  private renderEmbargoes(
    view: ReadonlyWorldView,
    me: string,
    other: string | null,
  ): TemplateResult {
    if (other === null) {
      return html`<div class="mt-1 text-gray-400">
        ${vt("screen.diplomacy.pick-hint")}
      </div>`;
    }
    const has = (from: string, to: string, good: string) =>
      view.market.embargoes.some(
        (e) => e.from === from && e.to === to && e.good === good,
      );
    return html`
      <div class="mt-1 font-bold">
        ${vt("screen.diplomacy.embargoes-with", {
          nation: this.nationLabel(view, other),
        })}
      </div>
      <table class="text-center">
        <thead>
          <tr class="text-gray-300">
            <th class="text-left">${vt("screen.economy.good")}</th>
            <th class="px-2">${vt("screen.diplomacy.embargo-mine")}</th>
            <th class="px-2">${vt("screen.diplomacy.embargo-theirs")}</th>
          </tr>
        </thead>
        <tbody>
          ${this.goods.map((g) => {
            const mine = has(me, other, g.id);
            const theirs = has(other, me, g.id);
            return html`<tr>
              <td class="text-left">${vt(g.name)}</td>
              <td>
                <input
                  type="checkbox"
                  .checked=${mine}
                  @change=${() =>
                    void this.command({
                      type: "set-embargo",
                      from: me,
                      to: other,
                      good: g.id,
                      active: !mine,
                    })}
                />
              </td>
              <td class=${theirs ? "text-red-300" : "text-gray-500"}>
                ${theirs ? "✗" : "—"}
              </td>
            </tr>`;
          })}
        </tbody>
      </table>
    `;
  }

  // --- politics (J4) --------------------------------------------------------------

  private actorName(
    name: { kind: "key"; key: string } | { kind: "literal"; text: string },
  ): string {
    return name.kind === "key" ? vt(name.key) : name.text;
  }

  private ideologyText(i: Ideology): string {
    const f = (v: number) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1));
    return `${vt("trait.economic")} ${f(i.economic)} · ${vt("trait.authority")} ${f(i.authority)} · ${vt("trait.sovereignty")} ${f(i.sovereignty)}`;
  }

  private ageOf(born: string, date: string): number {
    const [by, bm, bd] = born.split("-").map(Number);
    const [y, m, d] = date.split("-").map(Number);
    let age = y - by;
    if (m < bm || (m === bm && d < bd)) age -= 1;
    return age;
  }

  private lawRefusal(p: NationPolitics, law: Law): string | null {
    const regime = this.regimes.find((r) => r.id === p.regime);
    if (p.laws.some((l) => l.id === law.id)) return "in-force";
    if (!law.regimes.includes(p.regime)) return "regime";
    if (regime !== undefined && !regime.lawDomains.includes(law.domain)) {
      return "domain";
    }
    const g = p.government.ideology;
    const inside = (["economic", "authority", "sovereignty"] as const).every(
      (axis) =>
        g[axis] >= law.window[axis][0] && g[axis] <= law.window[axis][1],
    );
    if (!inside) return "window";
    if (
      law.requiresLegitimacy !== undefined &&
      p.legitimacy < law.requiresLegitimacy
    ) {
      return "legitimacy";
    }
    if (p.capital < law.capitalCost) return "capital";
    return null;
  }

  private renderPolitics(
    view: ReadonlyWorldView,
    p: NationPolitics,
    e: NationEconomy,
  ) {
    const projection = view.electionProjection;
    const partyLabel = (id: string) => {
      const party = p.parties.find((x) => x.id === id);
      return party === undefined ? id : this.actorName(party.name);
    };
    return html`
      <div class="mb-1 flex flex-wrap gap-x-4">
        <span
          >${vt("screen.politics.regime")} :
          <b>${vt(`regime.${p.regime}`)}</b></span
        >
        <span
          >${vt("screen.politics.leader")} :
          <b>${this.actorName(p.leader.name)}</b></span
        >
        <span
          >${vt("screen.politics.government")} :
          <b>${p.government.parties.map(partyLabel).join(" + ")}</b>
          <span class="text-gray-400"
            >(${this.ideologyText(p.government.ideology)})</span
          ></span
        >
      </div>
      ${this.bar(vt("screen.politics.legitimacy"), p.legitimacy, true)}
      ${this.bar(
        vt("screen.politics.capital"),
        p.capital / this.config.politics.capital.max,
        true,
      )}
      <div class="flex flex-wrap gap-x-4">
        <span
          >${vt("screen.politics.capital")} : <b>${p.capital.toFixed(0)}</b> /
          ${this.config.politics.capital.max}</span
        >
        <span>${vt("trait.corruption")} : <b>${pct(p.corruption, 0)}</b></span>
        <span
          >${vt("screen.politics.press-freedom")} :
          <b>${pct(p.pressFreedom, 0)}</b></span
        >
        <span
          >${vt("screen.politics.media-control")} :
          <b>${pct(p.mediaControl, 0)}</b></span
        >
        <span
          >${vt("screen.politics.coup-risk")} :
          <b>${pct(p.coupRisk, 2)}</b></span
        >
        ${p.suspendedFrom.length > 0
          ? html`<span class="text-red-300"
              >${vt("screen.politics.suspended", {
                blocs: p.suspendedFrom.join(", "),
              })}</span
            >`
          : nothing}
      </div>
      <div class="mt-1 font-bold">${vt("screen.politics.next-election")}</div>
      <div>
        ${p.nextElection === null
          ? vt("screen.politics.no-election")
          : html`${p.nextElection}${p.electionsSuspended
              ? html` <span class="text-red-300"
                  >${vt("screen.politics.suspended-war")}</span
                >`
              : nothing}`}
        ${projection === null
          ? nothing
          : html` — ${vt("screen.politics.projection")} :
            ${Object.entries(projection)
              .sort((a, b) => b[1] - a[1])
              .map(([id, share]) => `${partyLabel(id)} ${pct(share, 0)}`)
              .join(", ")}`}
      </div>
      <div class="mt-1 font-bold">${vt("screen.politics.groups")}</div>
      ${p.groups === null
        ? nothing
        : INTEREST_GROUPS.map(
            (g) => html`
              <div class="flex items-center gap-2">
                <span class="w-32">${vt(`group.${g}`)}</span>
                ${this.bar("", p.groups![g])}
                <span class="w-72 text-gray-400"
                  >${this.ideologyText(p.groupIdeologies[g])}</span
                >
              </div>
            `,
          )}
      <div class="mt-1 font-bold">${vt("screen.politics.sliders")}</div>
      <div class="flex flex-wrap gap-x-3 text-gray-300">
        ${TAX_IDS.map(
          (t) =>
            html`<span
              >${vt(`tax.${t}`)} ${pct(e.taxes[t])} →
              ${pct(e.taxTargets[t])}</span
            >`,
        )}
        ${SPENDING_POSTS.map(
          (s) =>
            html`<span
              >${vt(`spending.${s}`)} ${pct(e.spending[s])} →
              ${pct(e.spendingTargets[s])}</span
            >`,
        )}
      </div>
      <div class="mt-1 font-bold">${vt("screen.politics.laws")}</div>
      <table class="w-full">
        <thead>
          <tr class="text-gray-300">
            <th class="text-left">${vt("screen.politics.law")}</th>
            <th class="text-left">${vt("screen.politics.domain")}</th>
            <th class="text-right">${vt("screen.politics.cost")}</th>
            <th class="text-left">${vt("screen.politics.window")}</th>
            <th class="text-left">${vt("screen.politics.status")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${this.laws.map((law) => {
            const inForce = p.laws.find((l) => l.id === law.id);
            const repeal = p.repealing.find((r) => r.id === law.id);
            const refusal = this.lawRefusal(p, law);
            const w = law.window;
            const windowText = (
              ["economic", "authority", "sovereignty"] as const
            )
              .filter((axis) => w[axis][0] > -1 || w[axis][1] < 1)
              .map(
                (axis) =>
                  `${vt(`trait.${axis}`)} [${w[axis][0]}, ${w[axis][1]}]`,
              )
              .join(" · ");
            return html`
              <tr
                class=${inForce !== undefined
                  ? "text-green-300"
                  : refusal === "window" ||
                      refusal === "regime" ||
                      refusal === "domain"
                    ? "text-gray-500"
                    : ""}
              >
                <td title=${vt(law.description)}>${vt(law.name)}</td>
                <td>${vt(`law.domain.${law.domain}`)}</td>
                <td class="text-right">
                  ${law.capitalCost}${law.reversible === null
                    ? " ∞"
                    : ` / ${law.reversible.cost}`}
                </td>
                <td class="text-gray-400">
                  ${windowText === "" ? "—" : windowText}
                </td>
                <td>
                  ${inForce !== undefined
                    ? html`${vt("screen.politics.in-force", {
                        since: inForce.since,
                      })}${repeal !== undefined
                        ? html` <span class="text-red-300"
                            >${vt("screen.politics.repeal-at", {
                              at: repeal.at,
                            })}</span
                          >`
                        : nothing}`
                    : refusal === null
                      ? vt("screen.politics.available")
                      : vt(`law.reason.${refusal}`)}
                </td>
                <td>
                  ${inForce !== undefined
                    ? html`<button
                        class="rounded bg-gray-700 px-2"
                        ?disabled=${law.reversible === null}
                        @click=${() =>
                          this.command({ type: "repeal-law", law: law.id })}
                      >
                        ${vt("screen.politics.repeal")}
                      </button>`
                    : html`<button
                        class="rounded bg-blue-700 px-2"
                        ?disabled=${refusal !== null}
                        @click=${() =>
                          this.command({ type: "enact-law", law: law.id })}
                      >
                        ${vt("screen.politics.enact")}
                      </button>`}
                </td>
              </tr>
            `;
          })}
        </tbody>
      </table>
    `;
  }

  // --- election (J4) ------------------------------------------------------------------

  private renderElection(
    view: ReadonlyWorldView,
    p: NationPolitics,
    e: NationEconomy,
  ) {
    const cfg = this.config.politics.elections;
    const partyLabel = (id: string) => {
      const party = p.parties.find((x) => x.id === id);
      return party === undefined ? id : this.actorName(party.name);
    };
    const projection = view.electionProjection ?? {};
    const incumbents = new Set(p.government.parties);
    const last = p.lastElection;
    return html`
      <div class="mb-1">
        ${vt("screen.election.next", {
          date: p.nextElection ?? vt("screen.politics.no-election"),
        })}
        ${p.electionsSuspended
          ? html`<span class="text-red-300">
              ${vt("screen.politics.suspended-war")}</span
            >`
          : nothing}
      </div>
      <div class="mt-1 font-bold">${vt("screen.election.levers")}</div>
      <div class="flex items-center gap-2">
        <span class="w-56">${vt("screen.election.propaganda")}</span>
        <input
          type="range"
          class="flex-1"
          min="0"
          max=${cfg.propagandaMaxPctGdp}
          step="0.001"
          .value=${String(p.levers.propagandaPctGdp)}
          @change=${(ev: Event) =>
            this.command({
              type: "set-lever",
              propagandaPctGdp: Number((ev.target as HTMLInputElement).value),
            })}
        />
        <span class="w-40 text-right tabular-nums"
          >${pct(p.levers.propagandaPctGdp, 2)}
          (${money((p.levers.propagandaPctGdp * e.gdp) / 12)}/mois)</span
        >
      </div>
      <div class="flex items-center gap-2">
        <span class="w-56">${vt("screen.election.fraud")}</span>
        <input
          type="range"
          class="flex-1"
          min="0"
          max=${cfg.fraudMax}
          step="0.01"
          .value=${String(p.levers.fraud)}
          @change=${(ev: Event) =>
            this.command({
              type: "set-lever",
              fraud: Number((ev.target as HTMLInputElement).value),
            })}
        />
        <span class="w-40 text-right tabular-nums"
          >${pct(p.levers.fraud, 0)} —
          ${vt("screen.election.detection", {
            value: pct(
              Math.min(
                1,
                cfg.fraudDetectionScale *
                  p.levers.fraud *
                  (1 - p.mediaControl) *
                  p.pressFreedom,
              ),
              0,
            ),
          })}</span
        >
      </div>
      <div class="flex items-center gap-2">
        <span class="w-56">${vt("screen.election.clientelism")}</span>
        <select
          class="bg-gray-800"
          @change=${(ev: Event) => {
            const value = (ev.target as HTMLSelectElement).value;
            void this.command({
              type: "set-lever",
              clientelism:
                value === ""
                  ? null
                  : (value as (typeof INTEREST_GROUPS)[number]),
            });
          }}
        >
          <option value="" ?selected=${p.levers.clientelism === null}>
            ${vt("screen.election.none")}
          </option>
          ${INTEREST_GROUPS.map(
            (g) =>
              html`<option value=${g} ?selected=${p.levers.clientelism === g}>
                ${vt(`group.${g}`)}
              </option>`,
          )}
        </select>
        <span class="text-gray-400"
          >${vt("screen.election.clientelism-note")}</span
        >
      </div>
      <div class="text-gray-400">
        ${vt("screen.election.media", { value: pct(p.mediaControl, 0) })}
      </div>
      <div class="mt-1 font-bold">${vt("screen.politics.projection")}</div>
      <table class="w-full">
        <thead>
          <tr class="text-gray-300">
            <th class="text-left">${vt("screen.election.party")}</th>
            <th class="text-left">${vt("screen.election.leader")}</th>
            <th class="text-right">${vt("screen.election.projected")}</th>
            <th class="text-right">${vt("screen.election.last")}</th>
          </tr>
        </thead>
        <tbody>
          ${[...p.parties]
            .sort((a, b) => (projection[b.id] ?? 0) - (projection[a.id] ?? 0))
            .map(
              (party) => html`
                <tr class=${incumbents.has(party.id) ? "text-yellow-200" : ""}>
                  <td title=${this.ideologyText(party.ideology)}>
                    ${this.actorName(party.name)}${incumbents.has(party.id)
                      ? " ★"
                      : ""}
                  </td>
                  <td>${this.actorName(party.leader.name)}</td>
                  <td class="text-right">${pct(projection[party.id] ?? 0)}</td>
                  <td class="text-right">
                    ${last === null
                      ? pct(party.support)
                      : pct(last.results[party.id] ?? 0)}
                  </td>
                </tr>
              `,
            )}
        </tbody>
      </table>
      ${last === null
        ? nothing
        : html`<div class="mt-1 text-gray-300">
            ${vt("screen.election.last-result", {
              date: last.date,
              winner: partyLabel(
                Object.entries(last.results).sort(
                  (a, b) => b[1] - a[1],
                )[0]?.[0] ?? "",
              ),
              alternation: vt(`alternation.${last.alternation}`),
            })}
            ${last.fraudDetected
              ? html`<span class="text-red-300">
                  ${vt("screen.election.fraud-detected")}</span
                >`
              : nothing}
          </div>`}
      <div class="mt-1 text-gray-400">${vt("screen.election.note")}</div>
    `;
  }

  // --- leaders (J4) -------------------------------------------------------------------

  private renderActor(
    view: ReadonlyWorldView,
    a: ActorState,
    partyLabel: (id: string | null) => string,
  ) {
    const traits = [
      "aggressiveness",
      "corruption",
      "charisma",
      "competence",
    ] as const;
    return html`
      <div class="mb-1 rounded border border-gray-700 p-1">
        <div>
          <b>${this.actorName(a.name)}</b> — ${vt(`role.${a.role}`)},
          ${this.ageOf(a.born, view.date)}
          ${vt("screen.leaders.years")}${a.party === null
            ? ""
            : `, ${partyLabel(a.party)}`}
        </div>
        <div class="text-gray-400">${this.ideologyText(a.traits)}</div>
        <div class="flex flex-wrap gap-x-3">
          ${traits.map(
            (t) =>
              html`<span
                >${vt(`trait.${t}`)} <b>${pct(a.traits[t], 0)}</b></span
              >`,
          )}
        </div>
      </div>
    `;
  }

  private renderLeaders(view: ReadonlyWorldView, p: NationPolitics) {
    const partyLabel = (id: string | null) => {
      const party = p.parties.find((x) => x.id === id);
      return party === undefined ? (id ?? "") : this.actorName(party.name);
    };
    const incumbents = new Set(p.government.parties);
    return html`
      <div class="font-bold">${vt("screen.leaders.leader")}</div>
      ${this.renderActor(view, p.leader, partyLabel)}
      <div class="mt-1 font-bold">${vt("screen.leaders.parties")}</div>
      ${[...p.parties]
        .sort((a, b) => b.support - a.support)
        .map(
          (party) => html`
            <div
              class="mb-1 rounded border border-gray-700 p-1 ${incumbents.has(
                party.id,
              )
                ? "border-yellow-600"
                : ""}"
            >
              <div>
                <b>${this.actorName(party.name)}</b> ${pct(
                  party.support,
                )}${incumbents.has(party.id)
                  ? html` <span class="text-yellow-200"
                      >${vt("screen.leaders.in-government")}</span
                    >`
                  : html` <span class="text-gray-400"
                      >${vt("screen.leaders.opposition")}</span
                    >`}
                <span class="text-gray-400"
                  >— ${this.ideologyText(party.ideology)}</span
                >
              </div>
              <div class="text-gray-300">
                ${vt("screen.leaders.led-by")}
                ${this.actorName(party.leader.name)} (${vt("trait.charisma")}
                ${pct(party.leader.traits.charisma, 0)},
                ${vt("trait.competence")}
                ${pct(party.leader.traits.competence, 0)})
              </div>
            </div>
          `,
        )}
      <div class="mt-1 font-bold">${vt("screen.leaders.world")}</div>
      ${this.worldList(
        view,
        ["name", "stability", "gdp", "relations"],
        (ids) =>
          html`<table class="w-full">
            <thead>
              <tr class="text-gray-300">
                <th class="text-left">${vt("screen.diplomacy.nation")}</th>
                <th class="text-left">${vt("screen.politics.regime")}</th>
                <th class="text-left">${vt("screen.leaders.leader")}</th>
                <th class="text-right">${vt("screen.politics.legitimacy")}</th>
                <th class="text-right">${vt("screen.opinion.stability")}</th>
                <th class="text-left">
                  ${vt("screen.politics.next-election")}
                </th>
              </tr>
            </thead>
            <tbody>
              ${ids.map((id) => {
                const q = view.politics[id];
                return html`
                  <tr>
                    <td>${this.nationLabel(view, id)}</td>
                    <td>${vt(`regime.${q.regime}`)}</td>
                    <td title=${this.ideologyText(q.leader.traits)}>
                      ${this.actorName(q.leader.name)}
                    </td>
                    <td class="text-right">${pct(q.legitimacy, 0)}</td>
                    <td class="text-right">
                      ${q.stability.toFixed(2)}${q.unrest ? " ⚠" : ""}
                    </td>
                    <td>
                      ${q.nextElection ?? "—"}${q.electionsSuspended
                        ? " ⏸"
                        : ""}
                    </td>
                  </tr>
                `;
              })}
            </tbody>
          </table>`,
      )}
    `;
  }

  // --- blocs (J5) ---------------------------------------------------------------------

  @state() private selectedBloc: string | null = null;
  @state() private armedExit: string | null = null;

  private measureLabel(
    view: ReadonlyWorldView,
    kind: string,
    target: string | undefined | null,
    direction: string | undefined | null,
  ): string {
    return measureName(viewNames(view), kind, target, direction);
  }

  private renderTally(view: ReadonlyWorldView, t: Tally): TemplateResult {
    return html`<span class=${t.adopted ? "text-green-300" : "text-red-300"}
        >${vt(
          t.adopted ? "screen.blocs.would-pass" : "screen.blocs.would-fail",
          {
            yes: t.yes,
            no: t.no,
            abstain: t.abstain,
          },
        )}</span
      >
      <span class="text-gray-400">
        ${Object.entries(t.votes).map(
          ([n, v]) =>
            html`<span class="mr-1"
              >${this.nationLabel(view, n)} ${vt(`bloc.vote.${v}`)}
              (${(t.utilities[n] ?? 0).toFixed(2)})</span
            >`,
        )}
      </span>`;
  }

  private renderBlocs(view: ReadonlyWorldView, politics: NationPolitics) {
    const selected =
      view.blocs.find((b) => b.id === this.selectedBloc) ??
      view.blocs.find((b) => b.playerStatus === "full") ??
      view.blocs[0];
    return html`
      <table class="w-full text-right">
        <thead>
          <tr class="text-gray-300">
            <th class="text-left">${vt("screen.blocs.bloc")}</th>
            <th>${vt("screen.blocs.leader")}</th>
            <th>${vt("screen.blocs.members")}</th>
            <th>${vt("screen.blocs.status")}</th>
            <th>${vt("screen.blocs.pending")}</th>
          </tr>
        </thead>
        <tbody>
          ${view.blocs.map(
            (b) =>
              html`<tr
                class="cursor-pointer ${b.id === selected?.id
                  ? "bg-gray-700"
                  : ""}"
                @click=${() => {
                  this.selectedBloc = b.id;
                  this.armedExit = null;
                }}
              >
                <td class="text-left">${vt(`bloc.${b.id}.name`)}</td>
                <td>
                  ${b.leader === null
                    ? vt("screen.blocs.no-leader")
                    : this.nationLabel(view, b.leader)}
                </td>
                <td>
                  ${vt("screen.blocs.member-count", {
                    simulated: b.members.filter((m) => m.status === "full")
                      .length,
                    world: b.worldMembers,
                  })}
                </td>
                <td>
                  ${b.playerStatus === null
                    ? vt("screen.blocs.not-member")
                    : vt(`bloc.status.${b.playerStatus}`)}
                </td>
                <td>${b.pending.length}</td>
              </tr>`,
          )}
        </tbody>
      </table>
      ${selected === undefined
        ? nothing
        : this.renderBloc(view, selected, politics)}
    `;
  }

  private renderBloc(
    view: ReadonlyWorldView,
    b: BlocView,
    politics: NationPolitics,
  ): TemplateResult {
    const me = view.playerNation!;
    const s = b.state;
    const label = (n: string) => this.nationLabel(view, n);
    const member = b.playerStatus === "full" || b.playerStatus === "suspended";
    const leaving = s.exits.some((e) => e.nation === me);
    const q = b.qualifiedMajority;
    return html`
      <div class="mt-2 text-sm font-bold">${vt(`bloc.${b.id}.name`)}</div>
      <div>
        ${vt(`bloc.leadership.${b.leadership}`)} :
        <b
          >${b.leader === null
            ? vt("screen.blocs.no-leader")
            : label(b.leader)}</b
        >
        ${b.termEnds === null || b.leader === null
          ? nothing
          : vt("screen.blocs.until", { date: b.termEnds })}
        ${b.leader === me
          ? html`<span class="text-green-300"
              >${vt("screen.blocs.you-lead")}</span
            >`
          : nothing}
      </div>
      <div>
        ${vt("screen.blocs.simulated-members")} :
        ${b.members.map(
          (m) =>
            html`<span class="mr-2"
              >${label(m.nation)} (${vt(`bloc.status.${m.status}`)})</span
            >`,
        )}
      </div>
      ${b.members.filter((m) => m.status === "full").length < b.worldMembers
        ? html`<div class="text-gray-400">${vt("screen.blocs.artifact")}</div>`
        : nothing}
      <div>
        ${vt("screen.blocs.rules")} :
        ${Object.entries(b.rules).map(
          ([domain, rule]) =>
            html`<span class="mr-2"
              >${vt(`bloc.domain.${domain}`)} : ${vt(`bloc.rule.${rule}`)}</span
            >`,
        )}
      </div>
      ${q === null
        ? nothing
        : html`<div>
            ${vt("screen.blocs.qmv", {
              members: pct(q.memberShare, 0),
              population: pct(q.populationShare, 0),
            })}
          </div>`}
      ${b.contributionPctGdp === null
        ? nothing
        : html`<div>
            ${vt("screen.blocs.budget", {
              pct: pct(b.contributionPctGdp, 2),
              scale: s.budgetScale.toFixed(2),
              paid: money(s.contributions[me] ?? 0),
              received: money(s.received[me] ?? 0),
            })}
          </div>`}
      <div>
        ${vt("screen.blocs.defense")} :
        ${b.collectiveDefense ? vt("screen.blocs.yes") : vt("screen.blocs.no")}
      </div>
      ${s.sanctions.length === 0
        ? nothing
        : html`<div>
            ${vt("screen.blocs.sanctions")} :
            ${s.sanctions.map(label).join(", ")}
          </div>`}
      ${s.agreements.length === 0
        ? nothing
        : html`<div>
            ${vt("screen.blocs.agreements")} :
            ${s.agreements.map(label).join(", ")}
          </div>`}
      ${s.programs.length === 0
        ? nothing
        : html`<div>
            ${vt("screen.blocs.programs")} :
            ${s.programs
              .map((p) =>
                vt("screen.blocs.program", { since: p.since, until: p.until }),
              )
              .join(", ")}
          </div>`}
      ${s.accessions.map(
        (a) =>
          html`<div>
            ${vt("screen.blocs.accession", {
              nation: label(a.nation),
              until: a.completeOn,
              vote: a.nextVote,
            })}
          </div>`,
      )}
      ${s.applications.map(
        (a) =>
          html`<div>
            ${vt("screen.blocs.application", {
              nation: label(a.nation),
              date: a.date,
            })}
          </div>`,
      )}
      ${s.exits.map(
        (e) =>
          html`<div class="text-yellow-300">
            ${vt("screen.blocs.exit", {
              nation: label(e.nation),
              at: e.effectiveOn,
            })}
          </div>`,
      )}
      ${b.calls.map(
        (c) =>
          html`<div class="text-red-300">
            ${vt("screen.blocs.call", { until: c.until })}
            <button
              class="rounded bg-red-800 px-1"
              @click=${() =>
                void this.command({
                  type: "bloc-honor",
                  bloc: b.id,
                  war: c.war,
                })}
            >
              ${vt("screen.blocs.honor")}
            </button>
          </div>`,
      )}
      <div class="mt-1 font-bold">${vt("screen.blocs.votes")}</div>
      ${b.pending.length === 0
        ? html`<div class="text-gray-400">${vt("screen.blocs.no-vote")}</div>`
        : b.pending.map(
            ({ proposal: p, projection }) =>
              html`<div>
                <b>${this.measureLabel(view, p.kind, p.target, p.direction)}</b
                >,
                ${vt("screen.blocs.proposed-by", {
                  nation: label(p.by),
                  date: p.resolveOn,
                })}
                ${this.renderTally(view, projection)}
                ${me in projection.votes && p.by !== me
                  ? html`<div>
                      ${vt("screen.blocs.your-vote")}
                      ${(["yes", "no", "abstain"] as const).map(
                        (v) =>
                          html`<button
                            class="ml-1 rounded px-1 ${p.cast[me] === v
                              ? "bg-blue-700"
                              : "bg-gray-700"}"
                            @click=${() =>
                              void this.command({
                                type: "bloc-vote",
                                proposal: p.id,
                                vote: v,
                              })}
                          >
                            ${vt(`bloc.vote.${v}`)}
                          </button>`,
                      )}
                    </div>`
                  : nothing}
              </div>`,
          )}
      ${b.leader === me
        ? html`<div class="mt-1 font-bold">
              ${vt("screen.blocs.propose", {
                capital: politics.capital.toFixed(0),
              })}
            </div>
            ${b.options.length === 0
              ? html`<div class="text-gray-400">
                  ${vt("screen.blocs.no-option")}
                </div>`
              : b.options.map(
                  (o) =>
                    html`<div class="border-b border-gray-800 py-0.5">
                      <button
                        class="rounded bg-gray-700 px-1 disabled:opacity-40"
                        ?disabled=${politics.capital < o.cost}
                        @click=${() =>
                          void this.command({
                            type: "bloc-propose",
                            bloc: b.id,
                            kind: o.kind,
                            target: o.target,
                            direction: o.direction,
                          })}
                      >
                        ${vt("screen.blocs.submit", { cost: o.cost })}
                      </button>
                      <b
                        >${this.measureLabel(
                          view,
                          o.kind,
                          o.target,
                          o.direction,
                        )}</b
                      >
                      ${this.renderTally(view, o.projection)}
                    </div>`,
                )}`
        : nothing}
      ${b.criteria === null
        ? nothing
        : html`<div class="mt-1">
            ${vt("screen.blocs.criteria", {
              regime: vt(
                b.criteria.regime ? "screen.blocs.ok" : "screen.blocs.ko",
              ),
              debt: vt(b.criteria.debt ? "screen.blocs.ok" : "screen.blocs.ko"),
              relations: b.criteria.meanRelations.toFixed(0),
            })}
            ${s.applications.some((a) => a.nation === me) ||
            s.accessions.some((a) => a.nation === me)
              ? nothing
              : html`<button
                  class="rounded bg-gray-700 px-1 disabled:opacity-40"
                  ?disabled=${!b.criteria.ok}
                  @click=${() =>
                    void this.command({ type: "bloc-apply", bloc: b.id })}
                >
                  ${vt("screen.blocs.apply")}
                </button>`}
          </div>`}
      ${member && !leaving
        ? html`<div class="mt-1">
            <button
              class="rounded bg-red-900 px-1"
              @click=${() => {
                if (this.armedExit === b.id) {
                  this.armedExit = null;
                  void this.command({ type: "bloc-leave", bloc: b.id });
                } else {
                  this.armedExit = b.id;
                }
              }}
            >
              ${this.armedExit === b.id
                ? vt("screen.blocs.leave-confirm")
                : vt("screen.blocs.leave", {
                    months: b.exitDelayMonths,
                    cost: pct(b.exitTradeCostPctGdp, 0),
                  })}
            </button>
          </div>`
        : nothing}
      ${b.resolved.length === 0
        ? nothing
        : html`<div class="mt-1 font-bold">${vt("screen.blocs.history")}</div>
            ${b.resolved.slice(0, 8).map(
              (p) =>
                html`<div class="text-gray-300">
                  <span class="tabular-nums text-gray-500">${p.resolveOn}</span>
                  ${this.measureLabel(view, p.kind, p.target, p.direction)} :
                  ${vt(`bloc.result.${p.result}`)}
                </div>`,
            )}`}
    `;
  }

  // --- technology (J5) ---------------------------------------------------------------

  @state() private techDomain = "energy";

  private techEffectLabel(effect: TechEffect): string {
    const [head, tail] = effect.target.split(".");
    const value =
      effect.op === "mul"
        ? `×${effect.value.toFixed(2)}`
        : `+${(effect.value * 100).toFixed(2)}`;
    if (head === "production" || head === "consumption") {
      return vt(`screen.tech.effect.${head}`, {
        good: vt(`good.${tail}`),
        value,
      });
    }
    return vt(`screen.tech.effect.${effect.target}`, { value });
  }

  private renderTech(view: ReadonlyWorldView) {
    const me = view.playerNation!;
    const mine = view.tech.nations[me];
    if (mine === undefined) return nothing;
    const tabs = [
      ...TECH_DOMAINS,
      ...new Set(
        this.techNodes.filter((n) => n.bloc !== undefined).map((n) => n.bloc!),
      ),
    ];
    const nodes = this.techNodes.filter((n) =>
      (TECH_DOMAINS as readonly string[]).includes(this.techDomain)
        ? n.domain === this.techDomain && n.bloc === undefined
        : n.bloc === this.techDomain,
    );
    const tier1 = this.techNodes.filter(
      (n) => n.tier === 1 && n.bloc === undefined,
    );
    const name = (id: string) => vt(`tech.${id}.name`);
    return html`
      <div>
        ${vt("screen.tech.points", {
          points: mine.pointsLastMonth.toFixed(1),
          tier1: `${tier1.filter((n) => mine.done.includes(n.id)).length} / ${tier1.length}`,
        })}
      </div>
      <div class="mt-1 font-bold">
        ${vt("screen.tech.projects", {
          max: this.config.tech.maxProjects,
        })}
      </div>
      ${mine.projects.length === 0
        ? html`<div class="text-yellow-300">${vt("screen.tech.idle")}</div>`
        : mine.projects.map(
            (p) =>
              html`<div class="flex items-center gap-2">
                <span class="w-64">${name(p.node)}</span>
                ${this.bar(
                  "",
                  Math.min(
                    1,
                    p.points / Math.max(1, view.techCosts[p.node] ?? 1),
                  ),
                )}
                <span class="w-28 text-right tabular-nums"
                  >${p.points.toFixed(0)} /
                  ${(view.techCosts[p.node] ?? 0).toFixed(0)}</span
                >
                <button
                  class="rounded bg-gray-700 px-1"
                  @click=${() =>
                    void this.command({ type: "tech-cancel", node: p.node })}
                >
                  ${vt("screen.tech.cancel")}
                </button>
              </div>`,
          )}
      <div class="mt-1 flex flex-wrap gap-1">
        ${tabs.map(
          (d) =>
            html`<button
              class="rounded px-1 ${d === this.techDomain
                ? "bg-blue-700"
                : "bg-gray-700"}"
              @click=${() => {
                this.techDomain = d;
              }}
            >
              ${(TECH_DOMAINS as readonly string[]).includes(d)
                ? vt(`tech.domain.${d}`)
                : vt(`bloc.${d}.name`)}
            </button>`,
        )}
      </div>
      <table class="mt-1 w-full">
        <thead>
          <tr class="text-left text-gray-300">
            <th>${vt("screen.tech.node")}</th>
            <th>${vt("screen.tech.tier")}</th>
            <th>${vt("screen.tech.cost")}</th>
            <th>${vt("screen.tech.effects")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${nodes.map((n) => {
            const refusal = view.techRefusals[n.id];
            const done = mine.done.includes(n.id);
            return html`<tr title=${vt(n.description)}>
              <td class=${done ? "text-green-300" : ""}>${vt(n.name)}</td>
              <td>${n.tier}</td>
              <td class="tabular-nums">
                ${(view.techCosts[n.id] ?? n.cost).toFixed(0)}
                (${vt("screen.tech.months", { months: n.monthsMin })})
              </td>
              <td class="text-gray-300">
                ${n.effects.map((e) => this.techEffectLabel(e)).join(", ")}
              </td>
              <td>
                ${done
                  ? vt("screen.tech.done")
                  : refusal === null
                    ? html`<button
                        class="rounded bg-gray-700 px-1"
                        @click=${() =>
                          void this.command({
                            type: "tech-research",
                            node: n.id,
                          })}
                      >
                        ${vt("screen.tech.research")}
                      </button>`
                    : html`<span class="text-gray-400"
                        >${vt(`screen.tech.refusal.${refusal}`, {
                          requires: n.requires
                            .filter((r) => !mine.done.includes(r))
                            .map(name)
                            .join(", "),
                        })}</span
                      >`}
              </td>
            </tr>`;
          })}
        </tbody>
      </table>
      <div class="text-gray-400">${vt("screen.tech.note")}</div>
    `;
  }

  // --- events (J5) -------------------------------------------------------------------

  private eventEffectLabel(
    view: ReadonlyWorldView,
    effect: EventEffect,
    other: string | null,
  ): string {
    return effectLabel(
      viewNames(view),
      effect,
      other,
      this.config.events.grievanceMonths,
    );
  }

  private renderEvents(view: ReadonlyWorldView) {
    const params = (i: {
      nation: string;
      other: string | null;
      good: string | null;
    }) => ({
      nation: this.nationLabel(view, i.nation),
      other: i.other === null ? "" : this.nationLabel(view, i.other),
      good: i.good === null ? "" : vt(`good.${i.good}`),
    });
    return html`
      <div class="font-bold">${vt("screen.events.pending")}</div>
      ${view.events.pending.length === 0
        ? html`<div class="text-gray-400">${vt("screen.events.none")}</div>`
        : view.events.pending.map((p) => {
            const event = this.eventCatalogue.find((e) => e.id === p.event);
            if (event === undefined) return nothing;
            return html`<div class="mb-2 rounded border border-yellow-700 p-1">
              <div class="text-sm font-bold">${vt(event.title, params(p))}</div>
              <div>${vt(event.text, params(p))}</div>
              ${[...(event.worldEffects ?? []), ...(event.effects ?? [])]
                .length === 0
                ? nothing
                : html`<div class="text-gray-400">
                    ${[...(event.worldEffects ?? []), ...(event.effects ?? [])]
                      .map((e) => this.eventEffectLabel(view, e, p.other))
                      .join(", ")}
                  </div>`}
              ${event.choices.map(
                (c) =>
                  html`<div class="mt-1">
                    <button
                      class="rounded bg-blue-800 px-2"
                      @click=${() =>
                        void this.command({
                          type: "event-choose",
                          id: p.id,
                          choice: c.id,
                        })}
                    >
                      ${vt(c.label, params(p))}
                    </button>
                    <span class="text-gray-300">
                      ${c.effects
                        .map((e) => this.eventEffectLabel(view, e, p.other))
                        .join(", ")}
                    </span>
                  </div>`,
              )}
              <div class="text-gray-400">
                ${vt("screen.events.deadline", { date: p.deadline })}
                ${(() => {
                  const leaning = event.choices.find(
                    (c) => c.id === view.eventLeanings[p.id],
                  );
                  return leaning === undefined
                    ? nothing
                    : html`·
                      ${vt("screen.events.leaning", {
                        choice: vt(leaning.label, params(p)),
                      })}`;
                })()}
              </div>
            </div>`;
          })}
      <div class="mt-1 font-bold">${vt("screen.events.history")}</div>
      ${[...view.events.history]
        .reverse()
        .slice(0, 25)
        .map((h) => {
          const event = this.eventCatalogue.find((e) => e.id === h.event);
          if (event === undefined) return nothing;
          const choice = event.choices.find((c) => c.id === h.choice);
          const line =
            vt(event.title, params(h)) +
            (choice === undefined ? "" : `, ${vt(choice.label, params(h))}`);
          return html`<div class="text-gray-300">
            <span class="tabular-nums text-gray-500">${h.date}</span>
            ${this.nationLabel(view, h.nation)} : ${line}
          </div>`;
        })}
    `;
  }

  // --- objectives and journal (J4) ----------------------------------------------------

  @state() private noteDraft = "";

  // --- the journal (J7) -----------------------------------------------------------

  // The filters of the journal screen: scope (all, mine, allies,
  // neighbours, "r:<region>", "s:<subregion>", "b:<bloc>"), category,
  // years, a nation searched by name, a thread; the page read from the
  // simulation.
  @state() private journalScope = "all";
  @state() private journalCategory = "";
  @state() private journalFrom = "";
  @state() private journalTo = "";
  @state() private journalSearch = "";
  @state() private journalLink: string | null = null;
  @state() private journalShown = JOURNAL_PAGE;
  @state() private journalPage: JournalPage | null = null;
  private journalAsked = "";

  // Opens the journal on one nation, or one thread (a marker of the map).
  openJournal(filter: { nation?: string; link?: string }): void {
    this.journalScope = "all";
    this.journalCategory = "";
    this.journalFrom = "";
    this.journalTo = "";
    this.journalShown = JOURNAL_PAGE;
    this.journalLink = filter.link ?? null;
    this.journalSearch =
      filter.nation === undefined || this.view === null
        ? ""
        : this.nationLabel(this.view, filter.nation);
    this.journalAsked = "";
    this.show("journal");
  }

  private journalQuery(view: ReadonlyWorldView): JournalQuery {
    const scope: JournalScope =
      this.journalScope === "mine"
        ? { kind: "mine" }
        : this.journalScope === "allies"
          ? { kind: "allies" }
          : this.journalScope === "neighbours"
            ? { kind: "neighbours" }
            : this.journalScope.startsWith("b:")
              ? { kind: "bloc", bloc: this.journalScope.slice(2) }
              : /^[rs]:/.test(this.journalScope)
                ? { kind: "region", region: this.journalScope.slice(2) }
                : { kind: "all" };
    const search = fold(this.journalSearch.trim());
    const nations =
      search === ""
        ? undefined
        : view.nations
            .filter((n) => fold(this.nationLabel(view, n.id)).includes(search))
            .map((n) => n.id);
    return {
      scope,
      ...(nations === undefined ? {} : { nations }),
      ...(this.journalCategory === ""
        ? {}
        : { category: this.journalCategory }),
      ...(/^\d{4}$/.test(this.journalFrom)
        ? { from: `${this.journalFrom}-01-01` }
        : {}),
      ...(/^\d{4}$/.test(this.journalTo)
        ? { to: `${this.journalTo}-12-31` }
        : {}),
      ...(this.journalLink === null ? {} : { link: this.journalLink }),
      limit: this.journalShown,
    };
  }

  // Reads the page of the journal when the filters or the view changed.
  private async loadJournal(view: ReadonlyWorldView): Promise<void> {
    const sim = this.sim;
    if (sim === null) return;
    const query = this.journalQuery(view);
    const key = `${view.version}|${JSON.stringify(query)}`;
    if (key === this.journalAsked) return;
    this.journalAsked = key;
    try {
      this.journalPage = await sim.queryJournal(query);
    } catch {
      this.journalPage = null;
    }
  }

  // The place of an entry: the camera goes there; the nation opens in the
  // diplomacy screen (its sheet at the J7b).
  private goToEntry(entry: JournalEntry): void {
    if (entry.tile !== undefined) campaignController().focus(entry.tile);
    if (
      entry.nation !== undefined &&
      entry.nation !== this.view?.playerNation
    ) {
      this.picked = entry.nation;
      this.show("diplomacy");
    }
  }

  // The effects of the choice of an event, in figures (J7).
  private entryEffects(
    view: ReadonlyWorldView,
    j: JournalEntry,
  ): TemplateResult | typeof nothing {
    if (j.params.event === undefined || j.params.choice === undefined) {
      return nothing;
    }
    const event = this.eventCatalogue.find((e) => e.id === j.params.event);
    const choice = event?.choices.find((c) => c.id === j.params.choice);
    if (choice === undefined || choice.effects.length === 0) return nothing;
    const other =
      j.params.other === undefined || j.params.other === ""
        ? null
        : j.params.other;
    return html`<span class="block text-gray-500"
      >${choice.effects
        .map((e) => this.eventEffectLabel(view, e, other))
        .join(", ")}</span
    >`;
  }

  private renderJournal(view: ReadonlyWorldView): TemplateResult {
    void this.loadJournal(view);
    const page = this.journalPage;
    const names = viewNames(view);
    const scopes: { value: string; label: string }[] = [
      { value: "all", label: vt("screen.journal.scope.all") },
      { value: "mine", label: vt("screen.journal.scope.mine") },
      { value: "allies", label: vt("screen.journal.scope.allies") },
      { value: "neighbours", label: vt("screen.journal.scope.neighbours") },
      ...regionOptions(view.nations.map((n) => n.id)),
      ...view.blocs.map((b) => ({
        value: `b:${b.id}`,
        label: vt(`bloc.${b.id}.name`),
      })),
    ];
    const set = (patch: () => void) => {
      patch();
      this.journalShown = JOURNAL_PAGE;
    };
    return html`
      <div class="mb-1 flex flex-wrap items-center gap-2">
        <select
          class="bg-gray-800"
          @change=${(e: Event) =>
            set(
              () => (this.journalScope = (e.target as HTMLSelectElement).value),
            )}
        >
          ${scopes.map(
            (o) =>
              html`<option
                value=${o.value}
                ?selected=${this.journalScope === o.value}
              >
                ${o.label}
              </option>`,
          )}
        </select>
        <select
          class="bg-gray-800"
          @change=${(e: Event) =>
            set(
              () =>
                (this.journalCategory = (e.target as HTMLSelectElement).value),
            )}
        >
          <option value="" ?selected=${this.journalCategory === ""}>
            ${vt("screen.journal.all-categories")}
          </option>
          ${JOURNAL_CATEGORIES.map(
            (c) =>
              html`<option value=${c} ?selected=${this.journalCategory === c}>
                ${vt(`journal.category.${c}`)}
              </option>`,
          )}
        </select>
        <input
          class="w-40 bg-gray-800 px-1"
          .value=${this.journalSearch}
          placeholder=${vt("screen.journal.search")}
          @keydown=${(e: Event) => e.stopPropagation()}
          @input=${(e: Event) =>
            set(
              () => (this.journalSearch = (e.target as HTMLInputElement).value),
            )}
        />
        <span>${vt("screen.journal.from")}</span>
        <input
          class="w-14 bg-gray-800 px-1"
          .value=${this.journalFrom}
          placeholder="2026"
          @keydown=${(e: Event) => e.stopPropagation()}
          @input=${(e: Event) =>
            set(
              () => (this.journalFrom = (e.target as HTMLInputElement).value),
            )}
        />
        <span>${vt("screen.journal.to")}</span>
        <input
          class="w-14 bg-gray-800 px-1"
          .value=${this.journalTo}
          placeholder=${view.date.slice(0, 4)}
          @keydown=${(e: Event) => e.stopPropagation()}
          @input=${(e: Event) =>
            set(() => (this.journalTo = (e.target as HTMLInputElement).value))}
        />
        ${this.journalLink === null
          ? nothing
          : html`<button
              class="rounded bg-yellow-700 px-2"
              @click=${() => set(() => (this.journalLink = null))}
            >
              ${vt("screen.journal.thread-clear")}
            </button>`}
        <span class="text-gray-400"
          >${page === null
            ? ""
            : vt("screen.journal.count", {
                shown: String(page.entries.length),
                total: String(page.total),
              })}</span
        >
      </div>
      <div class="max-h-[60vh] overflow-y-auto">
        ${page === null
          ? html`<div class="text-gray-400">${vt("screen.loading")}</div>`
          : page.entries.length === 0
            ? html`<div class="text-gray-400">
                ${vt("screen.journal.empty")}
              </div>`
            : page.entries.map(
                (j) =>
                  html`<div class="flex items-start gap-2 text-gray-300">
                    <span class="w-28 shrink-0 tabular-nums text-gray-500"
                      >${longDate(j.date)}</span
                    >
                    <span class="w-20 shrink-0 text-gray-500"
                      >${vt(`journal.category.${entryCategory(j)}`)}</span
                    >
                    <span
                      class="flex-1 ${j.tile === undefined &&
                      j.nation === undefined
                        ? ""
                        : "cursor-pointer hover:text-white"}"
                      title=${vt("screen.journal.go")}
                      @click=${() => this.goToEntry(j)}
                      >${journalLine(names, j)}${this.entryEffects(
                        view,
                        j,
                      )}</span
                    >
                    ${j.link === undefined || this.journalLink === j.link
                      ? nothing
                      : html`<button
                          class="shrink-0 rounded bg-gray-700 px-1"
                          @click=${() =>
                            set(() => (this.journalLink = j.link ?? null))}
                        >
                          ${vt("screen.journal.thread")}
                        </button>`}
                  </div>`,
              )}
        ${page !== null && page.total > page.entries.length
          ? html`<button
              class="mt-1 rounded bg-gray-700 px-2"
              @click=${() => (this.journalShown += JOURNAL_PAGE)}
            >
              ${vt("screen.journal.more")}
            </button>`
          : nothing}
      </div>
    `;
  }

  // A claimed region (J6): a region of the scenario, or the homeland of a
  // nation ("homeland:<id>").
  private regionLabel(view: ReadonlyWorldView, region: string): string {
    return regionName(viewNames(view), region);
  }

  private renderObjectives(view: ReadonlyWorldView, p: NationPolitics) {
    const pinned = view.objectives;
    const active = pinned.filter((o) => !o.done).length;
    void p;
    return html`
      <div class="font-bold">
        ${vt("screen.objectives.pinned")} (${active}/5)
      </div>
      ${pinned.length === 0
        ? html`<div class="text-gray-400">${vt("screen.objectives.none")}</div>`
        : pinned.map((o) => {
            const objective = this.objectives.find((x) => x.id === o.id);
            return html`
              <div class="flex items-center gap-2">
                <span
                  class="w-56 ${o.done ? "text-green-300" : ""}"
                  title=${objective === undefined
                    ? ""
                    : vt(objective.description)}
                  >${objective === undefined ? o.id : vt(objective.name)}</span
                >
                ${this.bar("", o.progress)}
                <span class="w-12 text-right">${pct(o.progress, 0)}</span>
                <span class="w-24 text-gray-400"
                  >${vt("screen.objectives.since", { date: o.since })}</span
                >
                ${o.done
                  ? html`<span class="text-green-300"
                      >${vt("screen.objectives.done")}</span
                    >`
                  : html`<button
                      class="rounded bg-gray-700 px-2"
                      @click=${() =>
                        this.command({
                          type: "unpin-objective",
                          objective: o.id,
                        })}
                    >
                      ${vt("screen.objectives.unpin")}
                    </button>`}
              </div>
            `;
          })}
      <div class="mt-1 font-bold">${vt("screen.objectives.catalogue")}</div>
      <div class="flex flex-wrap gap-1">
        ${this.objectives
          .filter((o) => !pinned.some((x) => x.id === o.id))
          .map(
            (o) =>
              html`<button
                class="rounded bg-gray-700 px-2"
                title=${vt(o.description)}
                ?disabled=${active >= 5}
                @click=${() =>
                  this.command({ type: "pin-objective", objective: o.id })}
              >
                ${vt(o.name)}
              </button>`,
          )}
      </div>
      <div class="mt-1 font-bold">${vt("screen.objectives.notes")}</div>
      <div class="flex gap-2">
        <input
          class="flex-1 bg-gray-800 px-1"
          .value=${this.noteDraft}
          placeholder=${vt("screen.objectives.note-placeholder")}
          @input=${(ev: Event) =>
            (this.noteDraft = (ev.target as HTMLInputElement).value)}
        />
        <button
          class="rounded bg-blue-700 px-2"
          ?disabled=${this.noteDraft.trim() === ""}
          @click=${() => {
            const text = this.noteDraft.trim();
            this.noteDraft = "";
            void this.command({ type: "add-note", text });
          }}
        >
          ${vt("screen.objectives.add-note")}
        </button>
      </div>
    `;
  }

  render() {
    const { screen, view } = this;
    if (screen === null) return nothing;
    const player = view?.playerNation ?? null;
    const economy = player === null ? undefined : view!.economies[player];
    const politics = player === null ? undefined : view!.politics[player];
    // Under the top bar, whatever its height (it wraps on narrow screens).
    const bar = document
      .querySelector("veritable-topbar > div")
      ?.getBoundingClientRect();
    const top = bar === undefined ? 40 : Math.round(bar.bottom + 4);
    return html`
      <div
        class="fixed left-1/2 z-[10000] max-h-[80vh] w-[52rem] max-w-[96vw] -translate-x-1/2 overflow-y-auto rounded border border-gray-500 bg-gray-900/95 p-2 text-xs text-white"
        style="pointer-events:auto; top:${top}px"
      >
        <div class="mb-1 flex items-center justify-between">
          <span class="text-sm font-bold">${vt(`screen.${screen}.title`)}</span>
          <button
            class="rounded bg-gray-700 px-2"
            @click=${() => this.toggle(screen)}
          >
            ${vt("screen.close")}
          </button>
        </div>
        ${this.error !== null
          ? html`<div class="mb-1 text-red-300">${this.error}</div>`
          : nothing}
        ${view === null || economy === undefined || politics === undefined
          ? html`<div class="text-gray-400">${vt("screen.loading")}</div>`
          : screen === "economy"
            ? this.renderEconomy(view, economy)
            : screen === "budget"
              ? this.renderBudget(
                  economy,
                  politics,
                  view.constructionCost[view.playerNation ?? ""] ?? 0,
                  view.blocs.reduce(
                    (s, b) =>
                      s +
                      (b.state.received[view.playerNation ?? ""] ?? 0) -
                      (b.state.contributions[view.playerNation ?? ""] ?? 0),
                    0,
                  ),
                )
              : screen === "opinion"
                ? this.renderOpinion(view, politics)
                : screen === "war"
                  ? this.renderWar(view)
                  : screen === "diplomacy"
                    ? this.renderDiplomacy(view)
                    : screen === "politics"
                      ? this.renderPolitics(view, politics, economy)
                      : screen === "election"
                        ? this.renderElection(view, politics, economy)
                        : screen === "leaders"
                          ? this.renderLeaders(view, politics)
                          : screen === "blocs"
                            ? this.renderBlocs(view, politics)
                            : screen === "tech"
                              ? this.renderTech(view)
                              : screen === "events"
                                ? this.renderEvents(view)
                                : screen === "journal"
                                  ? this.renderJournal(view)
                                  : this.renderObjectives(view, politics)}
      </div>
    `;
  }
}

export function veritableScreens(): VeritableScreens {
  let screens = document.querySelector(
    "veritable-screens",
  ) as VeritableScreens | null;
  if (screens === null) {
    screens = document.createElement("veritable-screens") as VeritableScreens;
    document.body.appendChild(screens);
  }
  return screens;
}
