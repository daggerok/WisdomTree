/**
 * Headless harness for the WisdomTree UI (index.html + app.tsx).
 *
 * The application ships as browser TypeScript compiled in place by Babel
 * standalone. This harness extracts the same <script type="text/babel">
 * source the browser would compile, transpiles it with Bun.Transpiler, and
 * evaluates it inside a node:vm context wired to a deliberately small fake
 * DOM, localStorage, and a file-backed fetch() that serves the real
 * generated feed from api/wisdomtree/. That lets bun test exercise the exact
 * production code (selection writers, sort/filter persistence, watchlist
 * aggregation, paging) without a browser.
 */
import { readFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { extractBrowserScript, parseBrowserScript } from "./check-index";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_HTML = path.join(REPO_ROOT, "index.html");
const API_ROOT = path.join(REPO_ROOT, "api", "wisdomtree");

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function until(cond: () => boolean, timeoutMs = 30000, stepMs = 20): Promise<void> {
  // flush pending microtasks/render passes before the first check
  await sleep(stepMs);
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await sleep(stepMs);
  }
}

// ---------------------------------------------------------------------------
// Fake DOM
// ---------------------------------------------------------------------------

type AttrConstraint = { name: string; value?: string };
type Selector = { tag?: string; id?: string; attrs: AttrConstraint[] };

function parseSelector(sel: string): Selector {
  const out: Selector = { attrs: [] };
  const rest = sel.replace(/#([A-Za-z0-9_-]+)/g, (_m, id) => {
    out.id = id;
    return "";
  });
  const tagMatch = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(rest.trim());
  if (tagMatch) out.tag = tagMatch[1].toLowerCase();
  for (const match of rest.matchAll(/\[([a-zA-Z-]+)(?::(?:hover|focus|active))?=?["']?(.*?)["']?\]/g)) {
    out.attrs.push({ name: match[1], value: match[2] || undefined });
  }
  return out;
}

export class FakeElement {
  tagName: string;
  id = "";
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  listeners = new Map<string, Array<(event: any) => void>>();
  classSet = new Set<string>();
  style: Record<string, string> = {};
  textContentValue = "";
  value = "";
  checked = false;
  disabled = false;
  hidden = false;
  offsetWidth = 0;
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 600;
  title = "";
  private html = "";

  classList: {
    add: (...names: string[]) => void;
    remove: (...names: string[]) => void;
    toggle: (name: string, force?: boolean) => boolean;
    contains: (name: string) => boolean;
  };

  constructor(tag: string) {
    this.tagName = tag.toLowerCase();
    this.classList = {
      add: (...names: string[]) => {
        for (const name of names) this.classSet.add(name);
      },
      remove: (...names: string[]) => {
        for (const name of names) this.classSet.delete(name);
      },
      toggle: (name: string, force?: boolean) => {
        const wanted = force === undefined ? !this.classSet.has(name) : force;
        if (wanted) this.classSet.add(name);
        else this.classSet.delete(name);
        return wanted;
      },
      contains: (name: string) => this.classSet.has(name),
    };
  }

  get className() {
    return [...this.classSet].join(" ");
  }

  // --- attributes -----------------------------------------------------------
  setAttribute(name: string, value: string) {
    this.attrs[name] = String(value);
    if (name === "id") this.id = String(value);
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
      this.dataset[key] = String(value);
    }
    if (name === "class") {
      this.classSet = new Set(String(value).split(/\s+/).filter(Boolean));
    }
  }
  getAttribute(name: string) {
    return this.attrs[name] ?? null;
  }
  removeAttribute(name: string) {
    delete this.attrs[name];
  }

  // --- content --------------------------------------------------------------
  get innerHTML() {
    return this.html;
  }
  set innerHTML(next: string) {
    this.html = String(next ?? "");
    parseChildrenInto(this, this.html);
  }
  insertAdjacentHTML(_pos: string, fragment: string) {
    this.html += String(fragment ?? "");
    parseChildrenInto(this, this.html);
  }
  get textContent() {
    return this.textContentValue;
  }
  set textContent(next: string) {
    this.textContentValue = String(next ?? "");
  }

  // --- tree -----------------------------------------------------------------
  appendChild(child: FakeElement) {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  removeChild(child: FakeElement) {
    this.children = this.children.filter((c) => c !== child);
    child.parent = null;
    return child;
  }
  contains(el: FakeElement) {
    let cur: FakeElement | null = el;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parent;
    }
    return false;
  }

  matchesSelector(sel: Selector): boolean {
    if (sel.tag && sel.tag !== this.tagName) return false;
    if (sel.id && sel.id !== this.id) return false;
    for (const attr of sel.attrs) {
      if (attr.name === "id") {
        if (this.id !== attr.value) return false;
        continue;
      }
      if (attr.name.startsWith("data-")) {
        const key = attr.name.slice(5).replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
        if (!(key in this.dataset)) return false;
        if (attr.value !== undefined && this.dataset[key] !== attr.value) return false;
        continue;
      }
      if (!(attr.name in this.attrs)) return false;
      if (attr.value !== undefined && this.attrs[attr.name] !== attr.value) return false;
    }
    return true;
  }

  private walk(visitor: (el: FakeElement) => void) {
    for (const child of this.children) {
      visitor(child);
      child.walk(visitor);
    }
  }

  querySelector(sel: string): FakeElement | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  querySelectorAll(sel: string): FakeElement[] {
    const parsed = parseSelector(sel);
    const found: FakeElement[] = [];
    this.walk((el) => {
      if (el.matchesSelector(parsed)) found.push(el);
    });
    return found;
  }
  closest(sel: string): FakeElement | null {
    const parsed = parseSelector(sel);
    let cur: FakeElement | null = this;
    while (cur) {
      if (cur.matchesSelector(parsed)) return cur;
      cur = cur.parent;
    }
    return null;
  }

  // --- events ----------------------------------------------------------------
  addEventListener(type: string, fn: (event: any) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, fn: (event: any) => void) {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(type, list.filter((f) => f !== fn));
  }
  dispatch(type: string, init: Record<string, unknown> = {}) {
    const event = {
      type,
      target: this,
      preventDefault() {},
      stopPropagation() {},
      ...init,
    };
    for (const fn of this.listeners.get(type) ?? []) fn(event);
    return event;
  }
  click() {
    this.dispatch("click", { target: this });
  }

  getBoundingClientRect() {
    return { top: 120, left: 0, right: 1200, bottom: 700, width: 1200, height: 580 };
  }
  focus() {}
  blur() {}
}

function attrsFromTag(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:]*)="([^"]*)"/g)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function makeFromTag(tagName: string, tag: string): FakeElement {
  const el = new FakeElement(tagName);
  const attrs = attrsFromTag(tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  if (/\bchecked\b/.test(tag)) el.checked = true;
  if (/\bdisabled\b/.test(tag)) el.disabled = true;
  if (/\bhidden\b/.test(tag)) el.hidden = true;
  return el;
}

/**
 * Very small structural scan: enough to expose the interactive pieces the
 * app queries back (sort header buttons, catalog rows + row checkboxes,
 * select-all checkboxes, tab buttons, badge links). It is NOT a DOM parser —
 * it only extracts elements the tests need to see.
 */
function parseChildrenInto(container: FakeElement, html: string) {
  container.children = [];
  const openings: Array<{ index: number; end: number; tag: string }> = [];
  for (const match of html.matchAll(/<tr\b([^>]*)>/g)) {
    openings.push({ index: match.index ?? 0, end: (match.index ?? 0) + match[0].length, tag: match[0] });
  }
  const innerTag = /<(input|button|a)\b[^>]*?\/?>/g;

  const addFlat = (segment: string) => {
    for (const match of segment.matchAll(innerTag)) {
      container.appendChild(makeFromTag(match[1], match[0]));
    }
  };

  if (!openings.length) {
    addFlat(html);
    return;
  }

  addFlat(html.slice(0, openings[0].index));
  openings.forEach((opening, i) => {
    const nextStart = i + 1 < openings.length ? openings[i + 1].index : html.length;
    const body = html.slice(opening.end, nextStart);
    const row = makeFromTag("tr", opening.tag);
    container.appendChild(row);
    for (const match of body.matchAll(innerTag)) {
      row.appendChild(makeFromTag(match[1], match[0]));
    }
  });
}

// ---------------------------------------------------------------------------
// Storage / fetch shims
// ---------------------------------------------------------------------------

export class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
  get size() {
    return this.map.size;
  }
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.map);
  }
  restore(snapshot: Record<string, string>) {
    this.map = new Map(Object.entries(snapshot));
  }
}

export type FetchStats = {
  counts: Map<string, number>;
  blocked: Set<string>;
  latency: (url: string) => number;
};

function createFeedFetch(stats: FetchStats) {
  return async function fetchStub(input: string): Promise<any> {
    const url = String(input);
    stats.counts.set(url, (stats.counts.get(url) ?? 0) + 1);
    const wait = stats.latency(url);
    if (wait > 0) await sleep(wait);
    const notFound = () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => {
        throw new Error(`404 for ${url}`);
      },
    });
    for (const blocked of stats.blocked) {
      if (url.includes(blocked)) return notFound();
    }
    const relative = url.replace(/^\.\//, "").replace(/^\/+/, "");
    if (!relative.startsWith("api/wisdomtree/")) return notFound();
    const file = path.join(REPO_ROOT, relative);
    if (!existsSync(file)) return notFound();
    const data = await readFile(file, "utf8");
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => JSON.parse(data),
    };
  };
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

export type AppHandle = {
  ctx: vm.Context;
  run: <T = unknown>(code: string) => T;
  boot: () => Promise<void>;
  storage: MemoryStorage;
  stats: FetchStats;
  elements: Map<string, FakeElement>;
  el: (id: string) => FakeElement;
};

export async function createApp(options: { storage?: MemoryStorage } = {}): Promise<AppHandle> {
  const htmlSource = await readFile(INDEX_HTML, "utf8");
  const scriptRef = extractBrowserScript(htmlSource);
  if (!("src" in scriptRef)) throw new Error("expected the text/babel script to reference a local .tsx file");
  const appPath = path.join(REPO_ROOT, scriptRef.src.replace(/^\.\//, ""));
  const appScript = await parseBrowserScript(await readFile(appPath, "utf8"));

  const elements = new Map<string, FakeElement>();
  const staticIds = [
    "theme-toggle", "app-subtitle", "ticker-count", "search-input", "search-clear-btn",
    "tabs-bar", "selected-tabs-panel", "selected-tabs-bar", "table-head", "table-body",
    "table-scroll", "static-load-sentinel", "static-load-status", "dropzone",
    "dropzone-text", "file-input", "copy-btn", "export-csv-btn", "export-txt-btn",
    "reset-btn", "blacklist-btn", "blacklist-panel", "blacklist-input",
    "blacklist-add-btn", "blacklist-clear-btn", "blacklist-chips", "blacklist-empty",
  ];
  for (const id of staticIds) {
    const el = new FakeElement(id === "search-input" ? "input" : "div");
    el.id = id;
    if (id === "search-clear-btn") el.classList.add("hidden");
    if (id === "search-input") el.disabled = true;
    elements.set(id, el);
  }
  elements.get("table-scroll")!.scrollHeight = 4000;
  elements.get("table-scroll")!.clientHeight = 600;

  const documentShim = {
    activeElement: null,
    documentElement: new FakeElement("html"),
    body: new FakeElement("body"),
    addEventListener() {},
    removeEventListener() {},
    getElementById(id: string) {
      if (!elements.has(id)) {
        const el = new FakeElement("div");
        el.id = id;
        elements.set(id, el);
      }
      return elements.get(id)!;
    },
    createElement(tag: string) {
      return new FakeElement(tag);
    },
  };

  const storage = options.storage ?? new MemoryStorage();
  const stats: FetchStats = {
    counts: new Map(),
    blocked: new Set(),
    latency: () => 0,
  };

  const logs: Array<{ level: string; args: unknown[] }> = [];
  const quietConsole = {
    log: (...args: unknown[]) => logs.push({ level: "log", args }),
    info: (...args: unknown[]) => logs.push({ level: "info", args }),
    warn: (...args: unknown[]) => logs.push({ level: "warn", args }),
    error: (...args: unknown[]) => logs.push({ level: "error", args }),
    debug: () => {},
  };

  const sandbox: Record<string, unknown> = {
    console: quietConsole,
    document: documentShim,
    window: {
      addEventListener() {},
      removeEventListener() {},
      innerWidth: 1440,
      innerHeight: 900,
      location: { reload() {} },
    },
    localStorage: storage,
    sessionStorage: new MemoryStorage(),
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: createFeedFetch(stats),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    URL: Object.assign(class extends URL {}, { createObjectURL: () => "blob:fake" }),
    Blob: class {
      constructor(public parts: unknown[], public options: unknown) {}
    },
    __logs: logs,
  };

  const ctx = vm.createContext(sandbox);
  // init() runs synchronously at script evaluation time; boot() below simply
  // waits for the catalog fetch to settle.
  vm.runInContext(appScript, ctx, { filename: "app.tsx-transpiled.js" });

  const run = <T = unknown>(code: string): T => vm.runInContext(code, ctx) as T;

  const boot = async () => {
    await until(() => run<number>("state.funds.length") > 0);
  };

  return {
    ctx,
    run,
    boot,
    storage,
    stats,
    elements,
    el: (id: string) => documentShim.getElementById(id),
  };
}

// ---------------------------------------------------------------------------
// Feed oracle helpers (independent of the UI code, used as expected values)
// ---------------------------------------------------------------------------

export function feedJson(relative: string): any {
  return JSON.parse(readFileSync(path.join(API_ROOT, relative), "utf8"));
}

export function catalogTickers(): string[] {
  return feedJson("index.json").funds.map((fund: any) => fund.ticker);
}

export function fundHoldingRows(ticker: string): Array<Record<string, unknown>> {
  const meta = feedJson(`funds/${ticker}/meta.json`);
  const pages: string[] = meta?.holdings?.pages ?? [];
  const rows: Array<Record<string, unknown>> = [];
  for (const page of pages) {
    const payload = feedJson(`funds/${ticker}/${page.replace(/^\.?\//, "")}`);
    rows.push(...(payload.rows ?? []));
  }
  return rows;
}

const PLACEHOLDER_VALUES = new Set(["", "-", "--", "—", "–", "N/A", "NA", "NONE", "NULL"]);

/**
 * Treats blank / dash / N/A style placeholders as missing. All-zero CUSIPs
 * (published as `000000000` verbatim by some EDGAR N-PORT filings in this
 * feed) also count as missing (contract §5, WisdomTree extension).
 */
export function cleanFeedValue(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text || PLACEHOLDER_VALUES.has(text.toUpperCase())) return "";
  if (/^0+$/.test(text)) return "";
  return text;
}

/**
 * Documented dedupe key fallback order (contract §5):
 * Ticker -> CUSIP -> ISIN -> Identifier/Security ID -> SEDOL/FIGI -> Name.
 * Keys are namespaced (T:/C:/I:/D:/S:/N:) so values never collide across
 * identifier types; numeric local listing tickers are valid, not placeholders.
 */
export function watchlistKey(row: Record<string, unknown>): { key: string; shown: string } | null {
  const first = (...values: unknown[]): string => {
    for (const value of values) {
      const clean = cleanFeedValue(value);
      if (clean) return clean.toUpperCase();
    }
    return "";
  };
  const ticker = first(row.Ticker, row.Symbol);
  if (ticker) return { key: `T:${ticker}`, shown: ticker };
  const cusip = first(row.CUSIP);
  if (cusip) return { key: `C:${cusip}`, shown: cusip };
  const isin = first(row.ISIN);
  if (isin) return { key: `I:${isin}`, shown: isin };
  const identifier = first(row.Identifier, row["Security ID"]);
  if (identifier) return { key: `D:${identifier}`, shown: identifier };
  const sedol = first(row.SEDOL, row.FIGI);
  if (sedol) return { key: `S:${sedol}`, shown: sedol };
  const name = String(row.Name ?? row["Security Name"] ?? "").trim();
  if (name) return { key: `N:${name.toUpperCase()}`, shown: name };
  return null;
}

export function parseFeedNumber(value: unknown): number | null {
  const source = String(value ?? "").trim();
  if (!source || source === "—") return null;
  const normalized = source.replace(/^\((.*)\)$/, "-$1").replace(/[$,%]/g, "").replace(/,/g, "").trim();
  return /^-?(?:\d+|\d*\.\d+)$/.test(normalized) ? Number(normalized) : null;
}

export type ExpectedRow = {
  key: string;
  shown: string;
  funds: Set<string>;
  weightSum: number;
  maxWeight: number;
  hasWeight: boolean;
};

/** Independently computes the expected deduplicated Watchlist aggregation. */
export function expectedWatchlist(tickers: string[]): Map<string, ExpectedRow> {
  const map = new Map<string, ExpectedRow>();
  for (const ticker of tickers) {
    for (const row of fundHoldingRows(ticker)) {
      const resolved = watchlistKey(row);
      if (!resolved) continue;
      let item = map.get(resolved.key);
      if (!item) {
        item = {
          key: resolved.key,
          shown: resolved.shown,
          funds: new Set(),
          weightSum: 0,
          maxWeight: Number.NEGATIVE_INFINITY,
          hasWeight: false,
        };
        map.set(resolved.key, item);
      }
      item.funds.add(ticker);
      const weight = parseFeedNumber(row.Weight);
      if (weight !== null) {
        item.hasWeight = true;
        item.weightSum += weight;
        item.maxWeight = Math.max(item.maxWeight, weight);
      }
    }
  }
  return map;
}
