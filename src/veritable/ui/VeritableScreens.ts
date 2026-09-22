import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { RemoteVeritableSim } from "../adapters/RemoteVeritableSim";
import { dataSource } from "../data/catalog";
import { vt } from "../data/i18n";
import { INTEREST_GROUPS } from "../data/schemas/common";
import { SPENDING_POSTS, TAX_IDS } from "../data/schemas/nation";
import {
  Division,
  NationEconomy,
  NationPolitics,
  PeaceTerms,
  War,
} from "../data/schemas/save";
import { CONSCRIPTION_LEVELS, POSTURES } from "../data/schemas/war";
import { relation } from "../sim/diplomacy/diplomacy";
import { FrontView, ReadonlyWorldView } from "../sim/VeritableSim";

export type ScreenId = "economy" | "budget" | "opinion" | "war" | "diplomacy";
export const SCREENS: ScreenId[] = [
  "economy",
  "budget",
  "opinion",
  "war",
  "diplomacy",
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

  private sim: RemoteVeritableSim | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly goods = dataSource.goods();
  private readonly config = dataSource.config();
  private readonly templates = dataSource.divisions();
  private readonly casusBelli = dataSource.casusBelli();

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

  private renderBudget(e: NationEconomy, p: NationPolitics) {
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
              ? this.renderBudget(economy, politics)
              : screen === "opinion"
                ? this.renderOpinion(view, politics)
                : screen === "war"
                  ? this.renderWar(view)
                  : this.renderDiplomacy(view)}
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
