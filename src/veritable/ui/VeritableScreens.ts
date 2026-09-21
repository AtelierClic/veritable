import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { RemoteVeritableSim } from "../adapters/RemoteVeritableSim";
import { dataSource } from "../data/catalog";
import { vt } from "../data/i18n";
import { INTEREST_GROUPS } from "../data/schemas/common";
import { SPENDING_POSTS, TAX_IDS } from "../data/schemas/nation";
import { NationEconomy, NationPolitics } from "../data/schemas/save";
import { ReadonlyWorldView } from "../sim/VeritableSim";

export type ScreenId = "economy" | "budget" | "opinion";
export const SCREENS: ScreenId[] = ["economy", "budget", "opinion"];

const REFRESH_MS = 1000;

const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)} %`;
const money = (usd: number) =>
  Math.abs(usd) >= 1e12
    ? `${(usd / 1e12).toFixed(2)} T$`
    : `${(usd / 1e9).toFixed(1)} Md$`;
const quantity = (v: number) =>
  v >= 1000 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);

// The three screens of the J2: economy, budget, opinion. Functional, ugly on
// purpose (polish is J7). They only read the world view and send commands.
@customElement("veritable-screens")
export class VeritableScreens extends LitElement {
  @state() private screen: ScreenId | null = null;
  @state() private view: ReadonlyWorldView | null = null;

  private sim: RemoteVeritableSim | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly goods = dataSource.goods();
  private readonly config = dataSource.config();

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
    await this.sim?.apply(command);
    await this.refresh();
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
            <th>${vt("screen.economy.coverage")}</th>
          </tr>
        </thead>
        <tbody>
          ${this.goods.map((good) => {
            const price = view.market.prices[good.id];
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
    const label = (id: string) => {
      const nation = view.nations.find((n) => n.id === id);
      if (nation === undefined) return id;
      return nation.name.kind === "key"
        ? vt(nation.name.key)
        : nation.name.text;
    };
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
            `${label(n.id)}${view.politics[n.id].unrest ? " ⚠" : ""}`,
            view.politics[n.id].stability,
          ),
        )}
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
        class="fixed top-10 left-1/2 z-[10000] max-h-[80vh] w-[44rem] max-w-[96vw] -translate-x-1/2 overflow-y-auto rounded border border-gray-500 bg-gray-900/95 p-2 text-xs text-white"
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
        ${view === null || economy === undefined || politics === undefined
          ? html`<div class="text-gray-400">${vt("screen.loading")}</div>`
          : screen === "economy"
            ? this.renderEconomy(view, economy)
            : screen === "budget"
              ? this.renderBudget(economy, politics)
              : this.renderOpinion(view, politics)}
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
