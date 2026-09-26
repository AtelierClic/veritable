import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { dataSource } from "../data/catalog";
import { vt } from "../data/i18n";
import { BlocVote, EventsState } from "../data/schemas/save";
import { HudView, PendingVote } from "../sim/VeritableSim";
import { daysBetweenDates } from "../sim/time";
import { nationCard } from "./NationCard";
import { effectLabel, eventParams } from "./eventText";
import { longDate } from "./format";
import { catalogueNames, journalLine, measureName } from "./journalText";
import { Notice } from "./notices";

// The pile of cards at the top left, under the top bar (J7): the decisions
// the player's nation has to take (with the government's leaning and the
// time left), the bloc votes that await its voice, and the news that
// concerns it — a critical one stays until it is read, the others fade
// after 8 seconds. Three cards at most, the others behind a "+ n". Reading a
// card never pauses the game.

const VISIBLE = 3;
const INFO_MS = 8_000;

interface ShownNotice {
  key: number;
  notice: Notice;
  until: number | null; // real time it fades at; null: until dismissed
}

@customElement("veritable-event-cards")
export class EventCards extends LitElement {
  @state() private hud: HudView | null = null;
  @state() private notices: ShownNotice[] = [];
  @state() private expanded = false;
  private nextKey = 1;
  private readonly catalogue = dataSource.events();
  private readonly config = dataSource.config();
  private names = catalogueNames();

  onChoose: (id: number, choice: string) => void = () => {};
  onVote: (proposal: number, vote: BlocVote) => void = () => {};
  onOpenJournal: () => void = () => {};

  createRenderRoot() {
    return this;
  }

  setHud(hud: HudView | null): void {
    // J7b: the intelligence of the player (the losses of other nations).
    if (hud !== null) this.names = catalogueNames(hud);
    this.hud = hud;
  }

  push(notice: Notice): void {
    if (notice.level === "log") return;
    const key = this.nextKey++;
    const until = notice.level === "info" ? Date.now() + INFO_MS : null;
    this.notices = [...this.notices, { key, notice, until }];
    if (until !== null) {
      setTimeout(() => this.dismiss(key), INFO_MS);
    }
  }

  clear(): void {
    this.hud = null;
    this.notices = [];
    this.expanded = false;
  }

  private dismiss(key: number): void {
    this.notices = this.notices.filter((n) => n.key !== key);
  }

  private decisionCard(p: EventsState["pending"][number]): TemplateResult {
    const hud = this.hud!;
    const event = this.catalogue.find((e) => e.id === p.event);
    if (event === undefined) return html``;
    const params = eventParams(this.names, p);
    const effects = (list: (typeof event.choices)[number]["effects"]) =>
      list
        .map((e) =>
          effectLabel(
            this.names,
            e,
            p.other,
            this.config.events.grievanceMonths,
          ),
        )
        .join(", ");
    const leaning = event.choices.find((c) => c.id === hud.leanings[p.id]);
    const days = Math.max(0, daysBetweenDates(hud.date, p.deadline));
    return html`<div
      class="rounded border border-yellow-500 bg-gray-900/95 p-2 shadow"
      data-card="decision"
    >
      <div class="flex justify-between text-gray-400">
        <span>${longDate(p.date)} · ${this.names.nation(p.nation)}</span>
        <span>${vt("cards.days-left", { days })}</span>
      </div>
      <div class="font-bold text-yellow-200">${vt(event.title, params)}</div>
      <div class="line-clamp-3 text-gray-300" title=${vt(event.text, params)}>
        ${vt(event.text, params)}
      </div>
      <div class="mt-1 flex flex-col gap-1">
        ${event.choices.map(
          (c) =>
            html`<button
              class="rounded px-2 py-0.5 text-left ${c.id === leaning?.id
                ? "bg-blue-700"
                : "bg-gray-700"}"
              title=${effects(c.effects)}
              @click=${() => this.onChoose(p.id, c.id)}
            >
              ${vt(c.label, params)}
            </button>`,
        )}
      </div>
      ${leaning === undefined
        ? nothing
        : html`<div class="mt-1 text-gray-400">
            ${vt("cards.leaning", { choice: vt(leaning.label, params) })}
          </div>`}
    </div>`;
  }

  private voteCard(v: PendingVote): TemplateResult {
    const hud = this.hud!;
    const days = Math.max(0, daysBetweenDates(hud.date, v.resolveOn));
    const vote = (choice: BlocVote, label: string) =>
      html`<button
        class="rounded bg-gray-700 px-2"
        @click=${() => this.onVote(v.id, choice)}
      >
        ${vt(label)}
      </button>`;
    return html`<div
      class="rounded border border-sky-500 bg-gray-900/95 p-2 shadow"
      data-card="vote"
    >
      <div class="flex justify-between text-gray-400">
        <span>${vt("cards.vote", { bloc: vt(`bloc.${v.bloc}.name`) })}</span>
        <span>${vt("cards.days-left", { days })}</span>
      </div>
      <div class="font-bold text-sky-200">
        ${measureName(this.names, v.kind, v.target, v.direction)}
      </div>
      <div class="text-gray-400">
        ${vt("cards.proposed-by", { nation: this.names.nation(v.by) })}
      </div>
      <div class="mt-1 flex gap-1">
        ${vote("yes", "cards.vote-yes")} ${vote("no", "cards.vote-no")}
        ${vote("abstain", "cards.vote-abstain")}
      </div>
    </div>`;
  }

  private noticeCard(n: ShownNotice): TemplateResult {
    const { entry, level } = n.notice;
    return html`<div
      class="rounded border ${level === "critical"
        ? "border-red-500"
        : "border-gray-500"} bg-gray-900/95 p-2 shadow"
      data-card=${level}
    >
      <div class="flex justify-between text-gray-400">
        <span
          >${longDate(entry.date)}${entry.nation === undefined
            ? ""
            : html` ·
                <button
                  class="underline decoration-dotted"
                  @click=${(e: MouseEvent) =>
                    void nationCard().open(entry.nation!, e.clientX, e.clientY)}
                >
                  ${this.names.nation(entry.nation)}
                </button>`}</span
        >
        <button
          class="px-1 text-gray-300"
          title=${vt("cards.dismiss")}
          @click=${() => this.dismiss(n.key)}
        >
          ×
        </button>
      </div>
      <div
        class="cursor-pointer ${level === "critical" ? "text-red-200" : ""}"
        @click=${() => this.onOpenJournal()}
      >
        ${journalLine(this.names, entry)}
      </div>
    </div>`;
  }

  render() {
    const hud = this.hud;
    if (hud === null) return nothing;
    const cards = [
      ...hud.pending.map((p) => this.decisionCard(p)),
      ...hud.votes.map((v) => this.voteCard(v)),
      ...[...this.notices].reverse().map((n) => this.noticeCard(n)),
    ];
    if (cards.length === 0) return nothing;
    const shown = this.expanded ? cards : cards.slice(0, VISIBLE);
    const hidden = cards.length - shown.length;
    // Under the top bar, whatever its height (its buttons may wrap).
    const bar = document
      .querySelector("veritable-topbar > div")
      ?.getBoundingClientRect();
    const top = bar === undefined ? 48 : Math.round(bar.bottom + 6);
    return html`<div
      class="fixed left-2 z-[9500] flex max-h-[80vh] w-[22rem] max-w-[92vw] flex-col gap-1 overflow-y-auto text-xs text-white"
      style="pointer-events:auto; top:${top}px"
    >
      ${shown}
      ${hidden > 0
        ? html`<button
            class="rounded bg-gray-800/95 px-2 py-0.5 text-left text-gray-300"
            @click=${() => (this.expanded = true)}
          >
            ${vt("cards.more", { count: hidden })}
          </button>`
        : this.expanded && cards.length > VISIBLE
          ? html`<button
              class="rounded bg-gray-800/95 px-2 py-0.5 text-left text-gray-300"
              @click=${() => (this.expanded = false)}
            >
              ${vt("cards.less")}
            </button>`
          : nothing}
    </div>`;
  }
}

export function eventCards(): EventCards {
  let cards = document.querySelector(
    "veritable-event-cards",
  ) as EventCards | null;
  if (cards === null) {
    cards = document.createElement("veritable-event-cards") as EventCards;
    document.body.appendChild(cards);
  }
  return cards;
}
