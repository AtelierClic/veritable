import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { RemoteVeritableSim } from "../adapters/RemoteVeritableSim";
import { dataSource } from "../data/catalog";
import { vt } from "../data/i18n";
import { INTEREST_GROUPS } from "../data/schemas/common";
import { Law } from "../data/schemas/laws";
import { SPENDING_POSTS, TAX_IDS } from "../data/schemas/nation";
import { Ideology } from "../data/schemas/politics";
import {
  ActorState,
  Division,
  NationEconomy,
  NationPolitics,
  PeaceTerms,
  War,
} from "../data/schemas/save";
import { CONSCRIPTION_LEVELS, POSTURES } from "../data/schemas/war";
import { relation } from "../sim/diplomacy/diplomacy";
import { FrontView, ReadonlyWorldView } from "../sim/VeritableSim";

export type ScreenId =
  | "economy"
  | "budget"
  | "opinion"
  | "war"
  | "diplomacy"
  | "politics"
  | "election"
  | "leaders"
  | "objectives";
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
];

const REFRESH_MS = 1000;

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
  // Nuclear shot of the player (J5): the first click arms it, the second
  // fires.
  @state() private armedShot: {
    target: string;
    aim: "front" | "capital";
  } | null = null;

  private sim: RemoteVeritableSim | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly goods = dataSource.goods();
  private readonly config = dataSource.config();
  private readonly templates = dataSource.divisions();
  private readonly casusBelli = dataSource.casusBelli();
  private readonly laws = dataSource.laws();
  private readonly regimes = dataSource.regimes();
  private readonly objectives = dataSource.objectives();

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

  connectedCallback(): void {
    super.connectedCallback();
    this.timer = setInterval(() => {
      if (this.screen !== null) void this.refresh();
    }, REFRESH_MS);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.timer !== null) clearInterval(this.timer);
  }

  private async refresh(): Promise<void> {
    try {
      if (this.sim !== null) this.view = await this.sim.read();
    } catch {
      this.view = null;
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
      ${view.nations
        .filter((n) => !n.isPlayer)
        .map((n) =>
          this.bar(
            `${this.nationLabel(view, n.id)}${view.politics[n.id].unrest ? " ⚠" : ""}`,
            view.politics[n.id].stability,
          ),
        )}
    `;
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
      const armed =
        this.armedShot?.target === target && this.armedShot.aim === aim;
      return html`<button
        class="rounded px-2 ${armed ? "bg-red-600" : "bg-red-900"}"
        @click=${() => {
          if (!armed) {
            this.armedShot = { target, aim };
            return;
          }
          this.armedShot = null;
          void this.command({
            type: "nuclear-launch",
            target,
            aim,
            confirmed: true,
          });
        }}
      >
        ${vt(armed ? "screen.nuclear.confirm" : `screen.nuclear.fire-${aim}`, {
          nation: this.nationLabel(view, target),
        })}
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
    const others = view.nations.filter((n) => n.id !== me).map((n) => n.id);
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
            return html`<tr>
              <td class="text-left">${this.nationLabel(view, id)}</td>
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
                          @click=${() =>
                            void this.command({
                              type: "declare-war",
                              target: id,
                              casusBelli: c,
                            })}
                        >
                          ${vt("screen.diplomacy.declare", {
                            casus: vt(
                              this.casusBelli.find((cb) => cb.id === c)?.name ??
                                c,
                            ),
                          })}
                        </button>`,
                    )}
              </td>
            </tr>`;
          })}
        </tbody>
      </table>
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
      <div class="mt-1 font-bold">${vt("screen.diplomacy.embargoes")}</div>
      <table class="w-full text-center">
        <thead>
          <tr class="text-gray-300">
            <th class="text-left">${vt("screen.diplomacy.nation")}</th>
            ${this.goods.map(
              (g) =>
                html`<th title=${vt(g.name)}>${vt(g.name).slice(0, 4)}</th>`,
            )}
          </tr>
        </thead>
        <tbody>
          ${others.map(
            (id) =>
              html`<tr>
                <td class="text-left">${this.nationLabel(view, id)}</td>
                ${this.goods.map((g) => {
                  const active = view.market.embargoes.some(
                    (e) => e.from === me && e.to === id && e.good === g.id,
                  );
                  return html`<td>
                    <input
                      type="checkbox"
                      .checked=${active}
                      @change=${() =>
                        void this.command({
                          type: "set-embargo",
                          from: me,
                          to: id,
                          good: g.id,
                          active: !active,
                        })}
                    />
                  </td>`;
                })}
              </tr>`,
          )}
        </tbody>
      </table>
      <div class="mt-1 text-gray-400">${vt("screen.diplomacy.note")}</div>
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
      <table class="w-full">
        <thead>
          <tr class="text-gray-300">
            <th class="text-left">${vt("screen.diplomacy.nation")}</th>
            <th class="text-left">${vt("screen.politics.regime")}</th>
            <th class="text-left">${vt("screen.leaders.leader")}</th>
            <th class="text-right">${vt("screen.politics.legitimacy")}</th>
            <th class="text-right">${vt("screen.opinion.stability")}</th>
            <th class="text-left">${vt("screen.politics.next-election")}</th>
          </tr>
        </thead>
        <tbody>
          ${view.nations
            .filter((n) => !n.isPlayer)
            .map((n) => {
              const q = view.politics[n.id];
              return html`
                <tr>
                  <td>${this.nationLabel(view, n.id)}</td>
                  <td>${vt(`regime.${q.regime}`)}</td>
                  <td title=${this.ideologyText(q.leader.traits)}>
                    ${this.actorName(q.leader.name)}
                  </td>
                  <td class="text-right">${pct(q.legitimacy, 0)}</td>
                  <td class="text-right">
                    ${q.stability.toFixed(2)}${q.unrest ? " ⚠" : ""}
                  </td>
                  <td>
                    ${q.nextElection ?? "—"}${q.electionsSuspended ? " ⏸" : ""}
                  </td>
                </tr>
              `;
            })}
        </tbody>
      </table>
    `;
  }

  // --- objectives and journal (J4) ----------------------------------------------------

  @state() private journalFilter = "";
  @state() private noteDraft = "";

  private journalCategory(kind: string): string {
    if (kind === "note") return "notes";
    if (kind === "objective-completed") return "objectives";
    if (/^(war|peace|annexation|landing|nuclear|dead-hand)/.test(kind)) {
      return "war";
    }
    if (/^sanctions/.test(kind)) return "diplomacy";
    if (/^(austerity|sovereign|bloc-reprimand)/.test(kind)) return "economy";
    if (kind === "campaign-started" || kind === "nation-status") return "other";
    return "politics";
  }

  private renderObjectives(view: ReadonlyWorldView, p: NationPolitics) {
    const pinned = view.objectives;
    const active = pinned.filter((o) => !o.done).length;
    const categories = [
      "",
      "politics",
      "economy",
      "war",
      "diplomacy",
      "objectives",
      "notes",
      "other",
    ];
    const entries = [...view.journal]
      .reverse()
      .filter(
        (j) =>
          this.journalFilter === "" ||
          this.journalCategory(j.kind) === this.journalFilter,
      )
      .slice(0, 60);
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
      <div class="mt-1 flex items-center gap-2">
        <span class="font-bold">${vt("screen.objectives.journal")}</span>
        <select
          class="bg-gray-800"
          @change=${(ev: Event) =>
            (this.journalFilter = (ev.target as HTMLSelectElement).value)}
        >
          ${categories.map(
            (c) =>
              html`<option value=${c} ?selected=${this.journalFilter === c}>
                ${c === ""
                  ? vt("screen.objectives.all")
                  : vt(`journal.category.${c}`)}
              </option>`,
          )}
        </select>
      </div>
      <div class="max-h-64 overflow-y-auto">
        ${entries.map(
          (j) =>
            html`<div class="text-gray-300">
              <span class="tabular-nums text-gray-500">${j.date}</span>
              ${vt(`journal.${j.kind}`, {
                ...j.params,
                nation:
                  j.nation === undefined
                    ? ""
                    : this.nationLabel(view, j.nation),
                ...(j.params.law === undefined
                  ? {}
                  : { law: vt(`law.${j.params.law}.name`) }),
                ...(j.params.objective === undefined
                  ? {}
                  : { objective: vt(`objective.${j.params.objective}.name`) }),
                ...(j.params.alternation === undefined
                  ? {}
                  : { alternation: vt(`alternation.${j.params.alternation}`) }),
                ...(j.params.reason === undefined
                  ? {}
                  : { reason: vt(`law.reason.${j.params.reason}`) }),
                ...(j.params.aim === undefined
                  ? {}
                  : { aim: vt(`screen.nuclear.aim-${j.params.aim}`) }),
                ...(j.params.target === undefined
                  ? {}
                  : { target: this.nationLabel(view, j.params.target) }),
                ...(j.params.by === undefined
                  ? {}
                  : { by: this.nationLabel(view, j.params.by) }),
                ...(j.params.to === undefined
                  ? {}
                  : { to: this.nationLabel(view, j.params.to) }),
                ...(j.params.against === undefined
                  ? {}
                  : { against: this.nationLabel(view, j.params.against) }),
              })}
            </div>`,
        )}
      </div>
    `;
  }

  render() {
    const { screen, view } = this;
    if (screen === null) return nothing;
    const player = view?.playerNation ?? null;
    const economy = player === null ? undefined : view!.economies[player];
    const politics = player === null ? undefined : view!.politics[player];
    return html`
      <div
        class="fixed top-10 left-1/2 z-[10000] max-h-[80vh] w-[52rem] max-w-[96vw] -translate-x-1/2 overflow-y-auto rounded border border-gray-500 bg-gray-900/95 p-2 text-xs text-white"
        style="pointer-events:auto"
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
