import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { vt } from "../data/i18n";

// The only modal windows of a campaign (J7): the irreversible actions the
// player launches itself — a declaration of war, a nuclear shot. Everything
// else (events, votes, news) is a card that never blocks the screen.

export interface ConfirmRequest {
  title: string;
  body: string;
  confirm: string;
}

@customElement("veritable-confirm")
export class ConfirmModal extends LitElement {
  @state() private request: ConfirmRequest | null = null;
  private answer: ((ok: boolean) => void) | null = null;

  createRenderRoot() {
    return this;
  }

  ask(request: ConfirmRequest): Promise<boolean> {
    this.answer?.(false);
    this.request = request;
    return new Promise((resolve) => {
      this.answer = resolve;
    });
  }

  private close(ok: boolean): void {
    const answer = this.answer;
    this.answer = null;
    this.request = null;
    answer?.(ok);
  }

  private onKey = (e: KeyboardEvent) => {
    if (this.request === null) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      this.close(false);
    }
  };

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKey, true);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKey, true);
  }

  render() {
    const r = this.request;
    if (r === null) return nothing;
    return html`<div
      class="fixed inset-0 z-[20000] flex items-center justify-center bg-black/60"
      style="pointer-events:auto"
      @click=${(e: Event) => {
        if (e.target === e.currentTarget) this.close(false);
      }}
    >
      <div
        class="w-[28rem] max-w-[92vw] rounded border border-red-500 bg-gray-900 p-3 text-sm text-white"
        role="dialog"
        aria-modal="true"
      >
        <div class="mb-1 text-base font-bold text-red-200">${r.title}</div>
        <div class="mb-3 text-gray-300">${r.body}</div>
        <div class="flex justify-end gap-2">
          <button
            class="rounded bg-gray-700 px-3 py-1"
            @click=${() => this.close(false)}
          >
            ${vt("confirm.cancel")}
          </button>
          <button
            class="rounded bg-red-700 px-3 py-1"
            @click=${() => this.close(true)}
          >
            ${r.confirm}
          </button>
        </div>
      </div>
    </div>`;
  }
}

export function confirmAction(request: ConfirmRequest): Promise<boolean> {
  let modal = document.querySelector(
    "veritable-confirm",
  ) as ConfirmModal | null;
  if (modal === null) {
    modal = document.createElement("veritable-confirm") as ConfirmModal;
    document.body.appendChild(modal);
  }
  return modal.ask(request);
}
