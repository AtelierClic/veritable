import { ChildProcess, spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

// A browser to play tests in and keep captures of them (J6c): Microsoft Edge
// (or Chrome, VERITABLE_BROWSER) without a window, driven through the Chrome
// DevTools protocol with Node's own WebSocket and fetch — no dependency.
// The integrated browser of the Claude app cannot write its screenshots to
// disk; this one can.

const DEFAULT_BROWSER =
  process.env.VERITABLE_BROWSER ??
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class HeadlessBrowser {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, ((params: unknown) => void)[]>();
  // Errors of the page (console errors, uncaught exceptions), for the logs.
  readonly errors: string[] = [];

  private constructor(
    private readonly process: ChildProcess,
    private readonly socket: WebSocket,
    private readonly profile: string,
    readonly width: number,
    readonly height: number,
  ) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
        method?: string;
        params?: unknown;
      };
      if (message.id !== undefined) {
        const waiting = this.pending.get(message.id);
        if (waiting === undefined) return;
        this.pending.delete(message.id);
        if (message.error !== undefined) {
          waiting.reject(new Error(message.error.message));
        } else {
          waiting.resolve(message.result);
        }
      } else if (message.method !== undefined) {
        for (const listener of this.listeners.get(message.method) ?? []) {
          listener(message.params);
        }
      }
    });
  }

  static async launch(
    options: { width?: number; height?: number; port?: number } = {},
  ): Promise<HeadlessBrowser> {
    const width = options.width ?? 1400;
    const height = options.height ?? 900;
    const port = options.port ?? 9333;
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "veritable-edge-"));
    const child = spawn(
      DEFAULT_BROWSER,
      [
        "--headless=new",
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        `--window-size=${width},${height}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--mute-audio",
        "--enable-unsafe-swiftshader",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "about:blank",
      ],
      { stdio: "ignore" },
    );
    let targets: { type: string; webSocketDebuggerUrl: string }[] = [];
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`);
        targets = (await response.json()) as typeof targets;
        if (targets.some((t) => t.type === "page")) break;
      } catch {
        // not listening yet
      }
      await sleep(200);
    }
    const page = targets.find((t) => t.type === "page");
    if (page === undefined) {
      child.kill();
      throw new Error("the browser did not open a page");
    }
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", () =>
        reject(new Error("DevTools socket error")),
      );
    });
    const browser = new HeadlessBrowser(child, socket, profile, width, height);
    browser.on("Runtime.exceptionThrown", (params) => {
      const p = params as {
        exceptionDetails: {
          text: string;
          exception?: { description?: string };
        };
      };
      browser.errors.push(
        p.exceptionDetails.exception?.description ?? p.exceptionDetails.text,
      );
    });
    browser.on("Runtime.consoleAPICalled", (params) => {
      const p = params as {
        type: string;
        args: { value?: unknown; description?: string }[];
      };
      if (p.type !== "error") return;
      browser.errors.push(
        p.args.map((a) => String(a.value ?? a.description ?? "")).join(" "),
      );
    });
    await browser.send("Page.enable");
    await browser.send("Runtime.enable");
    await browser.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    return browser;
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method: string, listener: (params: unknown) => void): void {
    const list = this.listeners.get(method) ?? [];
    list.push(listener);
    this.listeners.set(method, list);
  }

  private once(method: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timeout waiting for ${method}`)),
        timeoutMs,
      );
      const list = this.listeners.get(method) ?? [];
      const listener = () => {
        clearTimeout(timer);
        this.listeners.set(
          method,
          (this.listeners.get(method) ?? []).filter((l) => l !== listener),
        );
        resolve();
      };
      list.push(listener);
      this.listeners.set(method, list);
    });
  }

  async goto(url: string, timeoutMs = 60_000): Promise<void> {
    const loaded = this.once("Page.loadEventFired", timeoutMs);
    await this.send("Page.navigate", { url });
    await loaded;
  }

  // Evaluates an expression in the page (awaited when it is a promise) and
  // returns its value.
  async eval<T = unknown>(expression: string): Promise<T> {
    const result = (await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })) as {
      result: { value?: T };
      exceptionDetails?: { text: string; exception?: { description?: string } };
    };
    if (result.exceptionDetails !== undefined) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text,
      );
    }
    return result.result.value as T;
  }

  async screenshot(file: string): Promise<void> {
    const result = (await this.send("Page.captureScreenshot", {
      format: "png",
    })) as { data: string };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(result.data, "base64"));
  }

  // A real click of the mouse at a point of the page (CSS pixels).
  async click(x: number, y: number): Promise<void> {
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await this.send("Input.dispatchMouseEvent", {
        type,
        x,
        y,
        button: "left",
        clickCount: type === "mouseMoved" ? 0 : 1,
      });
    }
  }

  // Gives a file input of the page a file from the disk.
  async setFile(selector: string, file: string): Promise<void> {
    const { root } = (await this.send("DOM.getDocument", { depth: -1 })) as {
      root: { nodeId: number };
    };
    const { nodeId } = (await this.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    })) as { nodeId: number };
    if (nodeId === 0) throw new Error(`no element ${selector}`);
    await this.send("DOM.setFileInputFiles", {
      nodeId,
      files: [path.resolve(file)],
    });
  }

  async close(): Promise<void> {
    try {
      await this.send("Browser.close");
    } catch {
      // already gone
    }
    this.socket.close();
    this.process.kill();
    // Edge may hold its profile a moment after it exits.
    for (let attempt = 0; attempt < 10; attempt++) {
      await sleep(500);
      try {
        fs.rmSync(this.profile, { recursive: true, force: true });
        return;
      } catch {
        // still locked
      }
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
