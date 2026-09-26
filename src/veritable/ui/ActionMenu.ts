import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { vt } from "../data/i18n";

// The action menu of the map (J7b): opened at the point of a left click, it
// lists what can be done there — eight entries at most, submenus, a digit
// for each entry, the cost or the consequences of an entry on hover, an
// entry that cannot be taken greyed with its reason. It runs the commands
// of the screens; it holds no rule of its own.

export interface MenuEntry {
  label: string;
  // Cost or consequences, shown on hover and under the label.
  hint?: string;
  // Why the entry cannot be taken (greyed); null or absent: it can.
  disabled?: string | null;
  run?: () => void | Promise<void>;
  children?: () => MenuEntry[] | Promise<MenuEntry[]>;
}

const MAX_ENTRIES = 8;

@customElement("veritable-action-menu")
export class ActionMenu extends LitElement {
  @state() private stack: {
    title: string;
    subtitle?: string;
    entries: MenuEntry[];
  }[] = [];
  @state() private busy = false;
  private x = 0;
  private y = 0;
  // Keys the menu took on their keydown: their keyup is its too — the
  // legacy input handler builds on the keyup of a digit.
  private swallowed = new Set<string>();

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("keyup", this.onKeyUp, true);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("keyup", this.onKeyUp, true);
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    if (!this.swallowed.delete(e.code)) return;
    e.stopPropagation();
    e.preventDefault();
  };

  private swallow(e: KeyboardEvent): void {
    e.stopPropagation();
    e.preventDefault();
    this.swallowed.add(e.code);
  }

  isOpen(): boolean {
    return this.stack.length > 0;
  }

  open(
    x: number,
    y: number,
    title: string,
    entries: MenuEntry[],
    subtitle?: string,
  ): void {
    const wasOpen = this.isOpen();
    this.x = x;
    this.y = y;
    this.stack = [{ title, subtitle, entries: entries.slice(0, MAX_ENTRIES) }];
    if (wasOpen) return;
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("pointerdown", this.onPointer, true);
  }

  close(): void {
    this.stack = [];
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("pointerdown", this.onPointer, true);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.isOpen()) return;
    if (e.key === "Escape") {
      this.swallow(e);
      this.close();
      return;
    }
    if (e.key === "Backspace" && this.stack.length > 1) {
      this.swallow(e);
      this.stack = this.stack.slice(0, -1);
      return;
    }
    const n = Number(e.key);
    const level = this.stack[this.stack.length - 1];
    if (Number.isInteger(n) && n >= 1 && n <= level.entries.length) {
      this.swallow(e);
      void this.take(level.entries[n - 1]);
    }
  };

  private onPointer = (e: PointerEvent): void => {
    if (this.isOpen() && !this.contains(e.target as Node)) this.close();
  };

  private async take(entry: MenuEntry): Promise<void> {
    if (this.busy || (entry.disabled ?? null) !== null) return;
    if (entry.children !== undefined) {
      this.busy = true;
      try {
        const entries = (await entry.children()).slice(0, MAX_ENTRIES);
        this.stack = [...this.stack, { title: entry.label, entries }];
      } finally {
        this.busy = false;
      }
      return;
    }
    this.close();
    await entry.run?.();
  }

  render() {
    if (!this.isOpen()) return nothing;
    const level = this.stack[this.stack.length - 1];
    const left = Math.max(8, Math.min(this.x + 4, window.innerWidth - 300));
    const top = Math.max(8, Math.min(this.y + 4, window.innerHeight - 320));
    return html`<div
      class="fixed z-[1150] w-72 max-w-[calc(100vw-16px)] rounded border border-gray-500 bg-gray-900/95 p-1 text-xs text-white shadow-lg"
      style="left:${left}px;top:${top}px"
      role="menu"
    >
      <div class="flex items-center justify-between px-1 pb-1 text-gray-300">
        <span class="truncate font-bold">${level.title}</span>
        ${this.stack.length > 1
          ? html`<button
              class="rounded px-1 hover:bg-gray-700"
              title=${vt("menu.back-hint")}
              @click=${() => (this.stack = this.stack.slice(0, -1))}
            >
              ${vt("menu.back")}
            </button>`
          : nothing}
      </div>
      ${level.subtitle === undefined
        ? nothing
        : html`<div class="px-1 pb-1 text-[10px] text-gray-400">
            ${level.subtitle}
          </div>`}
      ${level.entries.length === 0
        ? html`<div class="px-1 text-gray-400">${vt("menu.empty")}</div>`
        : level.entries.map((entry, i) => {
            const disabled = entry.disabled ?? null;
            return html`<button
              class="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left ${disabled ===
              null
                ? "hover:bg-gray-700"
                : "cursor-not-allowed opacity-50"}"
              role="menuitem"
              title=${disabled ?? entry.hint ?? ""}
              @click=${() => void this.take(entry)}
            >
              <span class="w-3 shrink-0 text-gray-400">${i + 1}</span>
              <span class="min-w-0 flex-1">
                <span
                  >${entry.label}${entry.children === undefined
                    ? ""
                    : " ›"}</span
                >
                ${disabled !== null
                  ? html`<span class="block text-[10px] text-red-300"
                      >${disabled}</span
                    >`
                  : entry.hint === undefined
                    ? nothing
                    : html`<span class="block text-[10px] text-gray-400"
                        >${entry.hint}</span
                      >`}
              </span>
            </button>`;
          })}
    </div>`;
  }
}

let menu: ActionMenu | null = null;
export function actionMenu(): ActionMenu {
  if (menu === null) {
    menu = document.createElement("veritable-action-menu") as ActionMenu;
    document.body.appendChild(menu);
  }
  return menu;
}
