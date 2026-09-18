/**
 * Acceptance tests for the WisdomTree ETF UI contract (index.html + app.tsx).
 *
 * These boot the real application script (transpiled exactly as Babel
 * standalone would do) inside a headless harness (scripts/ui-harness.ts)
 * that serves the actual generated feed from api/wisdomtree/. Expected
 * values are computed independently from the feed (oracle helpers in the
 * harness) — nothing is hardcoded from other providers.
 */
import { expect, test } from "bun:test";
import {
  AppHandle,
  MemoryStorage,
  catalogTickers,
  createApp,
  expectedWatchlist,
  feedJson,
  sleep,
  until,
} from "./ui-harness";

const SORTS_KEY = "wisdomtree-tab-sorts";
const FILTERS_KEY = "wisdomtree-tab-filters";
const SELECTED_KEY = "wisdomtree-selected-etfs";
const ACTIVE_FUND_KEY = "wisdomtree-active-fund";
const BLACKLIST_KEY = "wisdomtree-blacklisted-etfs";
const SITE_STATE_KEY = "wisdomtree-site-state";

async function bootFresh(storage?: MemoryStorage): Promise<AppHandle> {
  const app = await createApp({ storage });
  await app.boot();
  return app;
}

// --- DOM helpers -------------------------------------------------------------

function sortButton(app: AppHandle, key: string) {
  const button = app
    .el("table-head")
    .querySelectorAll("button[data-sort]")
    .find((el) => el.dataset.sort === key);
  if (!button) throw new Error(`sort header not found: ${key}`);
  return button;
}

function clickSort(app: AppHandle, key: string) {
  sortButton(app, key).click();
}

function catalogRow(app: AppHandle, ticker: string) {
  const row = app.el("table-body").querySelector(`tr[data-ticker="${ticker}"]`);
  if (!row) throw new Error(`catalog row not found: ${ticker}`);
  return row;
}

function toggleRow(app: AppHandle, ticker: string) {
  catalogRow(app, ticker).click();
}

function headerCheckbox(app: AppHandle) {
  const cb = app.el("table-head").querySelector("#select-all-checkbox");
  if (!cb) throw new Error("header select-all checkbox not found");
  return cb;
}

function pillCheckbox(app: AppHandle) {
  const cb = app.el("tabs-bar").querySelector("#select-all-toggle");
  if (!cb) throw new Error("All ETFs pill checkbox not found");
  return cb;
}

function allTabButton(app: AppHandle) {
  const button = app.el("tabs-bar").querySelector('button[data-tab="All"]');
  if (!button) throw new Error("All ETFs tab button not found");
  return button;
}

function setChecked(el: { checked: boolean; dispatch: (t: string, i?: object) => void }, checked: boolean) {
  el.checked = checked;
  el.dispatch("change", { target: el });
}

function setSearch(app: AppHandle, query: string) {
  const input = app.el("search-input");
  input.value = query;
  input.dispatch("input", { target: input });
}

async function waitForTab(app: AppHandle, tabId: string) {
  await until(() => app.run("state.activeTab") === tabId, 10000);
  // let async renders settle
  await sleep(60);
}

async function clickTab(app: AppHandle, tabId: string) {
  const button =
    app.el("selected-tabs-bar").querySelector(`button[data-tab="${tabId}"]`) ??
    app.el("tabs-bar").querySelector(`button[data-tab="${tabId}"]`);
  if (!button) throw new Error(`tab button not found: ${tabId}`);
  button.click();
  await waitForTab(app, tabId);
}

function selectedTickers(app: AppHandle): string[] {
  return app.run<string[]>("[...state.selected]").sort();
}

function watchlistTabLabel(app: AppHandle): string {
  const match = /Watchlist\s*\(([^)]*)\)/.exec(app.el("selected-tabs-bar").innerHTML);
  return match ? match[1] : "";
}

async function waitWatchlistCount(app: AppHandle, expected: number, timeoutMs = 120000) {
  await until(() => app.run<number>("getDedupedWatchlistRows().length") === expected, timeoutMs);
}

/** True once every selected ETF's holdings finished loading. */
async function waitForHoldingsSettled(app: AppHandle, timeoutMs = 300000) {
  await until(() => app.run<boolean>("isHoldingsLoading()") === false, timeoutMs);
}

function bodyRowHtml(app: AppHandle): string {
  return app.el("table-body").innerHTML;
}

function bodyRowCount(app: AppHandle): number {
  return (bodyRowHtml(app).match(/<tr\b/g) ?? []).length;
}

// =============================================================================
// 1. Sort persistence round-trip
// =============================================================================

test("1. per-tab sort survives tabs, checkboxes, buttons, Clear, and reload", async () => {
  const app = await bootFresh();

  // explicit non-default catalog sort
  clickSort(app, "ytd"); // 'YTD Return' numeric column -> starts descending
  expect(app.run("state.sortKey")).toBe("ytd");
  expect(app.run("state.sortDir")).toBe("desc");
  expect(app.el("table-head").innerHTML).toContain("YTD Return ↓");
  expect(JSON.parse(app.storage.getItem(SORTS_KEY)!)).toEqual({
    All: { key: "ytd", dir: "desc" },
  });

  // select a fund and round-trip through the Watchlist tab
  toggleRow(app, "AGGY");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("Watchlist"));
  await clickTab(app, "watchlist");
  expect(app.run("state.activeTab")).toBe("watchlist");

  // Watchlist gets its own sort; catalog memory must stay untouched
  clickSort(app, "fundCount"); // '# ETFs'
  expect(app.run("state.sortKey")).toBe("fundCount");

  // All ETFs button returns to the catalog with the remembered sort
  allTabButton(app).click();
  await waitForTab(app, "All");
  expect(app.run("state.sortKey")).toBe("ytd");
  expect(app.run("state.sortDir")).toBe("desc");
  expect(app.el("table-head").innerHTML).toContain("YTD Return ↓");

  // header Use checkbox + All ETFs pill checkbox must not reset sorting
  setChecked(headerCheckbox(app), true);
  setChecked(pillCheckbox(app), true);
  setChecked(pillCheckbox(app), false);
  setChecked(headerCheckbox(app), false);
  expect(app.run("state.sortKey")).toBe("ytd");

  // search, Copy Tickers, theme toggle must not reset sorting
  setSearch(app, "bond");
  setSearch(app, "");
  app.el("copy-btn").click();
  app.el("theme-toggle").click();
  expect(app.run("state.sortKey")).toBe("ytd");

  // Clear removes selection and search only — never the remembered sort
  app.el("reset-btn").click();
  expect(app.run<string[]>("[...state.selected]")).toEqual([]);
  expect(app.el("search-input").value).toBe("");
  expect(app.run("state.sortKey")).toBe("ytd");
  expect(app.run("state.sortDir")).toBe("desc");
  expect(app.el("table-head").innerHTML).toContain("YTD Return ↓");
  expect(JSON.parse(app.storage.getItem(SORTS_KEY)!)).toEqual({
    All: { key: "ytd", dir: "desc" },
    watchlist: { key: "fundCount", dir: "desc" },
  });

  // full reload restores both per-tab sorts
  const reloaded = await bootFresh(app.storage);
  expect(reloaded.run("state.sortKey")).toBe("ytd");
  expect(reloaded.run("state.sortDir")).toBe("desc");
  expect(reloaded.el("table-head").innerHTML).toContain("YTD Return ↓");
}, 120000);

test("1b. Watchlist remembers its own sort separately from the catalog", async () => {
  const app = await bootFresh();
  toggleRow(app, "AGGY");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("Watchlist"));
  await clickTab(app, "watchlist");
  expect(JSON.parse(app.storage.getItem(SORTS_KEY) || "{}").watchlist).toBeUndefined();

  clickSort(app, "symbol"); // Ticker: asc
  clickSort(app, "symbol"); // asc -> desc
  expect(app.run("state.sortKey")).toBe("symbol");
  expect(app.run("state.sortDir")).toBe("desc");

  allTabButton(app).click();
  await waitForTab(app, "All");
  expect(app.run("state.sortKey")).toBe("rank"); // catalog was never explicitly sorted

  await clickTab(app, "watchlist");
  expect(app.run("state.sortKey")).toBe("symbol");
  expect(app.run("state.sortDir")).toBe("desc");
}, 120000);

// =============================================================================
// 2+3. Header select-all is scoped to the visible (filtered) rows
// =============================================================================

test("2. header Use check selects exactly the filtered ETFs", async () => {
  const app = await bootFresh();
  setSearch(app, "yield enhanced"); // matches AGGY, SHAG, UNIY only
  const visible = app.run<string[]>("visibleCatalogRows().map((f) => f.ticker)").sort();
  expect(visible).toEqual(["AGGY", "SHAG", "UNIY"]);

  setChecked(headerCheckbox(app), true);
  expect(selectedTickers(app)).toEqual(visible);
}, 60000);

test("3. header Use uncheck removes only visible tickers; hidden selections survive", async () => {
  const app = await bootFresh();

  // a selection that will be hidden by the filter
  toggleRow(app, "DEM");
  await sleep(20);

  setSearch(app, "yield enhanced");
  const visible = app.run<string[]>("visibleCatalogRows().map((f) => f.ticker)").sort();
  expect(visible).not.toContain("DEM");

  setChecked(headerCheckbox(app), true);
  expect(selectedTickers(app)).toEqual([...visible, "DEM"].sort());
  // checked state: every visible row selected -> header box is checked
  expect(headerCheckbox(app).checked).toBe(true);

  setChecked(headerCheckbox(app), false);
  expect(selectedTickers(app)).toEqual(["DEM"]); // hidden selection survives
  expect(app.el("table-head").innerHTML.includes("YTD Return")).toBe(true);
}, 60000);

// =============================================================================
// 4. All ETFs pill checkbox: whole catalog, filter/tab independent, no nav
// =============================================================================

test("4. All ETFs pill selects the whole non-blacklisted catalog without navigating", async () => {
  const app = await bootFresh();
  const all = catalogTickers();
  app.run("blacklistTickers(['DEM'])");
  await until(() => app.run<string[]>("[...state.blacklist]").length === 1);

  // from the Watchlist tab, with a filter active
  toggleRow(app, "AGGY");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("Watchlist"));
  setSearch(app, "bond");
  await clickTab(app, "watchlist");
  setChecked(pillCheckbox(app), true);

  expect(app.run("state.activeTab")).toBe("watchlist"); // no navigation
  const selected = selectedTickers(app);
  expect(selected).not.toContain("DEM");
  expect(selected.length).toBe(all.length - 1);
  expect(selected).toEqual(all.filter((t) => t !== "DEM").sort());

  // checked state reflects the whole catalog, not the filtered view
  expect(pillCheckbox(app).checked).toBe(true);

  // unchecking clears the catalog selection and still does not navigate
  setChecked(pillCheckbox(app), false);
  expect(app.run("state.activeTab")).toBe("All"); // watchlist tab no longer valid -> All
  expect(selectedTickers(app)).toEqual([]);

  // the pill also works from a fund detail tab
  setSearch(app, "");
  toggleRow(app, "AGGY");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("AGGY Overview"));
  await clickTab(app, "detail:holdings");
  setChecked(pillCheckbox(app), true);
  expect(app.run("state.activeTab")).toBe("detail:holdings"); // still no navigation
  expect(selectedTickers(app).length).toBe(all.length - 1);
}, 300000);

// =============================================================================
// 5. Watchlist reacts to selection: Loading… then exact count
// =============================================================================

test("5. selecting one ETF shows Watchlist Loading then the exact count", async () => {
  const app = await bootFresh();
  // slow the selected fund down so the loading state is observable
  app.stats.latency = (url) => (url.includes("/AGGY/") ? 60 : 0);

  toggleRow(app, "AGGY");

  // immediately: no misleading exact "Watchlist (0)"
  await sleep(10);
  const labelDuringLoad = watchlistTabLabel(app);
  expect(labelDuringLoad).not.toBe("0");

  const expected = expectedWatchlist(["AGGY"]).size;
  await until(() => watchlistTabLabel(app) === String(expected), 120000);
  expect(app.run<number>("getDedupedWatchlistRows().length")).toBe(expected);
}, 180000);

// =============================================================================
// 6. Race-free holdings loading for overlapping rapid selections
// =============================================================================

test("6. rapid overlapping selections load without duplicate or skipped pages", async () => {
  const app = await bootFresh();
  app.stats.latency = (url) => (url.includes("/AGGY/") || url.includes("/AGZD/") ? 40 : 0);

  toggleRow(app, "AGGY");
  toggleRow(app, "AGZD"); // second selection while the first is still in flight

  const oracle = expectedWatchlist(["AGGY", "AGZD"]);
  await waitWatchlistCount(app, oracle.size);

  // every holdings page fetched exactly once — no duplicates, no gaps
  for (const ticker of ["AGGY", "AGZD"]) {
    const pages: string[] = feedJson(`funds/${ticker}/meta.json`).holdings.pages;
    for (const page of pages) {
      expect(app.stats.counts.get(`./api/wisdomtree/funds/${ticker}/${page}`) ?? 0).toBe(1);
    }
    // meta.json requests are deduplicated per ticker while in flight
    expect(app.stats.counts.get(`./api/wisdomtree/funds/${ticker}/meta.json`) ?? 0).toBe(1);
  }

  // an overlapping security reports both funds and correct weight aggregates
  const overlap = [...oracle.values()].find((row) => row.funds.size === 2 && row.hasWeight);
  expect(overlap).toBeDefined();
  const appRow = app
    .run<Array<Record<string, unknown>>>("getDedupedWatchlistRows()")
    .find((row) => row.key === overlap!.key);
  expect(appRow).toBeDefined();
  expect(appRow!.funds.length).toBe(2);
  expect(Number(appRow!.weightSum)).toBeCloseTo(overlap!.weightSum, 10);
  expect(Number(appRow!.maxWeight)).toBeCloseTo(overlap!.maxWeight, 10);
}, 240000);

// =============================================================================
// 7. Deselection updates everything immediately
// =============================================================================

test("7. deselecting an ETF updates subtitle, tabs and Watchlist immediately", async () => {
  const app = await bootFresh();
  toggleRow(app, "AGGY");
  toggleRow(app, "AGZD");
  const both = expectedWatchlist(["AGGY", "AGZD"]).size;
  await waitWatchlistCount(app, both);
  expect(watchlistTabLabel(app)).toBe(String(both));

  toggleRow(app, "AGZD"); // deselect — everything below must be synchronous

  const onlyAggy = expectedWatchlist(["AGGY"]).size;
  expect(app.run<number>("getDedupedWatchlistRows().length")).toBe(onlyAggy);
  expect(watchlistTabLabel(app)).toBe(String(onlyAggy));
  expect(app.el("app-subtitle").innerHTML).toContain("1 selected");
  expect(app.el("app-subtitle").innerHTML).not.toContain('data-activate-fund="AGZD"');
  expect(app.el("selected-tabs-bar").innerHTML).not.toContain("AGZD Overview");
  expect(app.el("selected-tabs-bar").innerHTML).toContain("AGGY Overview");
  expect(app.run("state.activeFundTicker")).toBe("AGGY");
}, 240000);

// =============================================================================
// 8. Select-all loads the complete catalog aggregate; DOM stays bounded
// =============================================================================

test("8. selecting all ETFs aggregates the whole feed and keeps the DOM bounded", async () => {
  const app = await bootFresh();
  const all = catalogTickers();
  setChecked(pillCheckbox(app), true);
  expect(selectedTickers(app).length).toBe(all.length);

  const oracle = expectedWatchlist(all);
  await waitForHoldingsSettled(app, 600000);
  expect(app.run<number>("getDedupedWatchlistRows().length")).toBe(oracle.size);

  await clickTab(app, "watchlist");
  expect(watchlistTabLabel(app)).toBe(String(oracle.size));

  // rendered watchlist DOM must stay bounded (chunked), never all rows at once
  const renderedRows = bodyRowCount(app);
  expect(renderedRows).toBeGreaterThan(0);
  expect(renderedRows).toBeLessThanOrEqual(400);
  expect(oracle.size).toBeGreaterThan(1000);

  // scrolling grows the rendered chunk but never the full set at once
  const scroll = app.el("table-scroll");
  scroll.scrollTop = scroll.scrollHeight - scroll.clientHeight - 100;
  scroll.dispatch("scroll", { target: scroll });
  const grownRows = bodyRowCount(app);
  expect(grownRows).toBeGreaterThan(renderedRows);
  expect(grownRows).toBeLessThanOrEqual(800);

  // copy/export still operate on the complete filtered result
  const copyCount = app.run<number>("getVisibleWatchlistRows().length");
  expect(copyCount).toBe(oracle.size);
}, 600000);

// =============================================================================
// 9. Reload restores selection, active fund, and background loading
// =============================================================================

test("9. reload restores selection, active fund and rebuilds the Watchlist", async () => {
  const app = await bootFresh();
  toggleRow(app, "AGGY");
  toggleRow(app, "AGZD");
  const both = expectedWatchlist(["AGGY", "AGZD"]).size;
  await waitWatchlistCount(app, both);
  expect(app.run("state.activeFundTicker")).toBe("AGZD");

  const reloaded = await bootFresh(app.storage);
  expect(selectedTickers(reloaded)).toEqual(["AGGY", "AGZD"]);
  expect(reloaded.run("state.activeFundTicker")).toBe("AGZD");

  // background loading completes without any checkbox interaction
  await waitWatchlistCount(reloaded, both);
  await clickTab(reloaded, "watchlist");
  expect(watchlistTabLabel(reloaded)).toBe(String(both));
  // active fund tabs were restored in the background
  expect(reloaded.el("selected-tabs-bar").innerHTML).toContain("AGZD Overview");
}, 300000);

// =============================================================================
// 10. Detail sheets render real rows and page onward
// =============================================================================

test("10. Holdings, History, Overview and Distributions render real rows", async () => {
  const app = await bootFresh();
  toggleRow(app, "AGGY");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("AGGY Overview"));

  await clickTab(app, "detail:holdings");
  const firstPageRow = feedJson("funds/AGGY/holdings/001.json").rows[0];
  await until(() => bodyRowHtml(app).includes(String(firstPageRow.Name)));

  // shared envelope cache: the detail pager and the background Watchlist
  // loader reuse the same requests — every holdings page fetched exactly once
  await waitForHoldingsSettled(app);
  for (const page of feedJson("funds/AGGY/meta.json").holdings.pages) {
    expect(app.stats.counts.get(`./api/wisdomtree/funds/AGGY/${page}`) ?? 0).toBe(1);
  }

  await clickTab(app, "detail:history");
  // history is NOT preloaded by the background Watchlist loader: the detail
  // pager loads page 1, and infinite scroll loads page 2.
  await until(() => app.run<number>("sheetState.get('AGGY:history').nextPage") >= 1, 30000);
  const historyRow = feedJson("funds/AGGY/history/001.json").rows[0];
  await until(() => bodyRowHtml(app).includes(String(historyRow.Date)));
  expect(app.stats.counts.get("./api/wisdomtree/funds/AGGY/history/001.json") ?? 0).toBe(1);

  const scroll = app.el("table-scroll");
  scroll.scrollHeight = 20000;
  scroll.scrollTop = 20000 - scroll.clientHeight - 100;
  scroll.dispatch("scroll", { target: scroll });
  await until(() => app.run<number>("sheetState.get('AGGY:history').nextPage") === 2, 30000);
  expect(app.stats.counts.get("./api/wisdomtree/funds/AGGY/history/002.json") ?? 0).toBe(1);
  const secondHistoryRow = feedJson("funds/AGGY/history/002.json").rows[0];
  await until(() => bodyRowHtml(app).includes(String(secondHistoryRow.Date)));

  await clickTab(app, "detail:overview");
  expect(bodyRowHtml(app)).toContain("Holdings Rows");
  expect(bodyRowHtml(app)).toContain("SEC Yield (30-day)");

  await clickTab(app, "detail:distributions");
  const distributions = feedJson("funds/AGGY/meta.json").distributions;
  await until(() => bodyRowHtml(app).includes(String(distributions.rows[0][0])));
  expect(app.el("table-head").innerHTML).toContain("Ex-Date");
}, 180000);

// =============================================================================
// 11. Missing/failing fund data produces an explanatory state
// =============================================================================

test("11. a fund whose files fail to load shows an explanatory state", async () => {
  const app = await bootFresh();
  toggleRow(app, "AGGY");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("AGGY Overview"));
  await clickTab(app, "detail:holdings");
  await until(() => bodyRowHtml(app).length > 100);
  expect(bodyRowHtml(app)).not.toContain("Could not load");

  // back to the catalog so rows can be toggled again
  allTabButton(app).click();
  await waitForTab(app, "All");

  // now the selected fund's files "disappear" — the previous table must go
  const priorName = String(feedJson("funds/AGGY/holdings/001.json").rows[0].Name);
  app.stats.blocked.add("funds/AGZD/");
  toggleRow(app, "AGZD"); // becomes the active fund; its files fail to load
  toggleRow(app, "AGGY"); // deselect AGGY so AGZD is the only remaining fund
  await until(() => app.run("state.activeFundTicker") === "AGZD");
  await clickTab(app, "detail:holdings"); // must show the failure state, not AGGY's table
  await until(() => bodyRowHtml(app).toLowerCase().includes("could not load"), 10000);
  const body = bodyRowHtml(app);
  expect(body).not.toContain(priorName); // prior fund's table is gone
  expect(body.toLowerCase()).toContain("could not load");
}, 180000);

// =============================================================================
// 12. Identifier fallbacks: bonds, cash, zero weights kept; placeholders dropped
// =============================================================================

test("12. bond rows fall back to identifiers; cash and zero-weight rows are kept", async () => {
  const app = await bootFresh();
  // AGGY: bond rows without exchange tickers (real CUSIPs);
  // DEM:  rows whose EDGAR CUSIP is the all-zero placeholder 000000000
  //       (must fall through to the published name, not one garbage key);
  // EES:  the CASH position row (kept, not dropped).
  toggleRow(app, "AGGY");
  toggleRow(app, "DEM");
  toggleRow(app, "EES");
  const oracle = expectedWatchlist(["AGGY", "DEM", "EES"]);
  await waitForHoldingsSettled(app, 300000);
  expect(app.run<number>("getDedupedWatchlistRows().length")).toBe(oracle.size);

  const rows = app.run<Array<Record<string, unknown>>>("getDedupedWatchlistRows()");
  const shown = new Set(rows.map((r) => String(r.symbol)));

  // bond rows whose Ticker is "-" must appear under their identifier
  const byIdentifier = [...oracle.values()].filter((r) => r.key.startsWith("D:"));
  expect(byIdentifier.length).toBeGreaterThan(500);
  for (const sample of byIdentifier.slice(0, 25)) {
    expect(shown.has(sample.shown)).toBe(true);
  }

  // the all-zero CUSIP placeholder never becomes a key; DEM rows fall back to Name
  expect([...oracle.values()].some((r) => r.key === "D:000000000")).toBe(false);
  const byName = [...oracle.values()].filter((r) => r.key.startsWith("N:"));
  expect(byName.length).toBeGreaterThan(100);
  for (const sample of byName.slice(0, 25)) {
    expect(shown.has(sample.shown)).toBe(true);
  }

  // cash positions are kept, not aggressively dropped
  expect(oracle.has("T:CASH")).toBe(true);
  expect(shown.has("CASH")).toBe(true);

  // zero-weight rows with otherwise valid data are kept
  const zeroWeight = [...oracle.values()].find((r) => r.hasWeight && Math.abs(r.weightSum) < 1e-12);
  expect(zeroWeight).toBeDefined();
  expect(shown.has(zeroWeight!.shown)).toBe(true);

  // the key resolver honors the documented contract (incl. numeric local tickers)
  expect(app.run("JSON.stringify(positionDedupeKey({ Ticker: '005930', Name: 'SK HYNIX' }))")).toBe(
    JSON.stringify({ key: "T:005930", shown: "005930" }),
  );
  expect(app.run("JSON.stringify(positionDedupeKey({ Ticker: '-', Identifier: '000000000', Name: 'US TREASURY NOTE' }))")).toBe(
    JSON.stringify({ key: "N:US TREASURY NOTE", shown: "US TREASURY NOTE" }),
  );
  expect(app.run("JSON.stringify(positionDedupeKey({ Ticker: '—', Identifier: 'N/A', Name: 'SWAP' }))")).toBe(
    JSON.stringify({ key: "N:SWAP", shown: "SWAP" }),
  );
}, 300000);

// =============================================================================
// 13. Sticky columns
// =============================================================================

test("13. sticky classes are on catalog Use/Ticker and Watchlist Ticker cells", async () => {
  const app = await bootFresh();
  toggleRow(app, "AGGY");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("Watchlist"));

  const head = app.el("table-head").innerHTML;
  expect(head).toContain("catalog-sticky-col catalog-sticky-use");
  expect(head).toContain("catalog-sticky-col catalog-sticky-ticker");
  const body = bodyRowHtml(app);
  expect(body).toContain("catalog-sticky-col catalog-sticky-use");
  expect(body).toContain("catalog-sticky-col catalog-sticky-ticker");

  await clickTab(app, "watchlist");
  const wHead = app.el("table-head").innerHTML;
  const wBody = bodyRowHtml(app);
  expect(wHead).toContain("watchlist-sticky-col watchlist-sticky-ticker");
  expect(wBody).toContain("watchlist-sticky-col watchlist-sticky-ticker");
}, 180000);

// =============================================================================
// 14. Malformed localStorage cannot crash boot
// =============================================================================

test("14. malformed localStorage is sanitized and boot still succeeds", async () => {
  const storage = new MemoryStorage();
  storage.setItem(SORTS_KEY, "{this is not json");
  storage.setItem(FILTERS_KEY, "{this is not json");
  storage.setItem(SITE_STATE_KEY, '{"sheetFilter": 42, "activeTab": 7}');
  storage.setItem(SELECTED_KEY, "{broken");
  storage.setItem(BLACKLIST_KEY, "not-an-array");
  storage.setItem(ACTIVE_FUND_KEY, "  ###not a ticker### ");

  const app = await bootFresh(storage);
  expect(app.run<number>("state.funds.length")).toBeGreaterThan(50);
  expect(app.run<string[]>("[...state.selected]")).toEqual([]);
  expect(app.run<string[]>("[...state.blacklist]")).toEqual([]);
  expect(app.run("state.activeFundTicker")).toBeNull();
  expect(app.run("Object.keys(state.sortByTab).length")).toBe(0);
  expect(app.run("Object.keys(state.queryByTab).length")).toBe(0);
  expect(app.run("state.sortKey")).toBe("rank");

  // structurally valid but semantically invalid entries are dropped too
  storage.setItem(SORTS_KEY, JSON.stringify({
    All: { key: "", dir: "asc" },
    watchlist: { key: "symbol", dir: "sideways" },
    "detail:holdings": { key: "Weight", dir: "desc" },
  }));
  storage.setItem(FILTERS_KEY, JSON.stringify({
    All: 123,
    watchlist: "",
    "detail:overview": "returns",
  }));
  const second = await bootFresh(storage);
  expect(second.run("Object.keys(state.sortByTab).length")).toBe(1); // only detail:holdings survives
  expect(second.run("state.sortByTab['detail:holdings']")).toEqual({ key: "Weight", dir: "desc" });
  expect(second.run("Object.keys(state.queryByTab).length")).toBe(1); // only detail:overview survives
  expect(second.run("state.queryByTab['detail:overview']")).toBe("returns");
}, 120000);

// =============================================================================
// 15. Manifest consistency
// =============================================================================

test("15. index.json / meta.json / page manifests stay consistent", () => {
  const index = feedJson("index.json");
  expect(Array.isArray(index.funds)).toBe(true);
  expect(index.funds.length).toBeGreaterThan(0);
  expect(index.counts.funds).toBe(index.funds.length);

  let holdingsTotal = 0;
  let historyTotal = 0;
  for (const fund of index.funds) {
    const meta = feedJson(`funds/${fund.ticker}/meta.json`);
    for (const kind of ["holdings", "history"] as const) {
      const manifest = meta[kind] ?? {};
      const pages: string[] = manifest.pages ?? [];
      expect(manifest.totalRows ?? 0).toBe(fund[kind] ?? 0);
      let rows = 0;
      for (const page of pages) {
        const payload = feedJson(`funds/${fund.ticker}/${page.replace(/^\.?\//, "")}`);
        expect(Array.isArray(payload.headers)).toBe(true);
        expect(Array.isArray(payload.rows)).toBe(true);
        rows += payload.rows.length;
      }
      expect(rows).toBe(manifest.totalRows ?? 0);
      if (kind === "holdings") holdingsTotal += manifest.totalRows ?? 0;
      else historyTotal += manifest.totalRows ?? 0;
    }
  }
  expect(index.counts.holdings).toBe(holdingsTotal);
  expect(index.counts.history).toBe(historyTotal);
}, 120000);

// =============================================================================
// 16. Per-tab filter persistence across views
// =============================================================================

test("16. per-tab filter persistence: each tab keeps its own search query independently", async () => {
  const app = await bootFresh();

  // 1. On "All ETFs", search for "yield enhanced" (matches 3 ETFs)
  setSearch(app, "yield enhanced");
  expect(app.run<number>("visibleCatalogRows().length")).toBe(3);
  expect(app.el("ticker-count").textContent).toBe("3 ETFs");
  expect(JSON.parse(app.storage.getItem(FILTERS_KEY)!)).toEqual({
    All: "yield enhanced",
  });

  // select AGGY so detail tabs and Watchlist appear
  toggleRow(app, "AGGY");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("AGGY Overview"));

  // 2. Overview tab: search must NOT carry over "yield enhanced"
  await clickTab(app, "detail:overview");
  expect(app.el("search-input").value).toBe("");
  expect(bodyRowHtml(app)).toContain("Holdings Rows");
  expect(bodyRowHtml(app)).not.toContain("No overview metrics match");

  // 3. Set a specific filter on Overview (the Returns section)
  setSearch(app, "returns");
  expect(app.el("search-input").value).toBe("returns");
  expect(bodyRowHtml(app)).toContain("YTD (ME)");
  expect(bodyRowHtml(app)).not.toContain("Fund Name");
  expect(JSON.parse(app.storage.getItem(FILTERS_KEY)!)).toEqual({
    All: "yield enhanced",
    "detail:overview": "returns",
  });
  // site-state mirror stays in sync
  expect(JSON.parse(app.storage.getItem(SITE_STATE_KEY)!).sheetFilter).toEqual({
    All: "yield enhanced",
    "detail:overview": "returns",
  });

  // 4. Switch to Holdings tab: search is empty, shows full holdings
  await clickTab(app, "detail:holdings");
  expect(app.el("search-input").value).toBe("");
  await until(() => bodyRowHtml(app).length > 100);
  expect(bodyRowHtml(app)).not.toContain("No rows match your search");

  // type a filter on Holdings tab (AGGY holds 5 TREASURY rows)
  setSearch(app, "treasury");
  expect(app.el("search-input").value).toBe("treasury");
  expect(bodyRowCount(app)).toBe(5);

  // 5. Switch back to All ETFs: restores "yield enhanced"
  allTabButton(app).click();
  await waitForTab(app, "All");
  expect(app.el("search-input").value).toBe("yield enhanced");
  expect(app.el("ticker-count").textContent).toBe("3 ETFs");

  // 6. Switch back to Overview: restores "returns"
  await clickTab(app, "detail:overview");
  expect(app.el("search-input").value).toBe("returns");

  // 7. Switch to Watchlist: search is initially empty, then filter by fund badge
  await clickTab(app, "watchlist");
  expect(app.el("search-input").value).toBe("");
  setSearch(app, "AGGY");
  expect(app.el("search-input").value).toBe("AGGY");
  await until(() => app.run<number>("getDedupedWatchlistRows().length") > 0, 120000);

  // 8. Full reload: the active view (Watchlist) restores its filter, and all
  //    per-tab filters survive in storage
  const reloaded = await bootFresh(app.storage);
  expect(reloaded.run("state.activeTab")).toBe("watchlist");
  expect(reloaded.el("search-input").value).toBe("AGGY");
  expect(JSON.parse(reloaded.storage.getItem(FILTERS_KEY)!)).toEqual({
    All: "yield enhanced",
    "detail:overview": "returns",
    "detail:holdings": "treasury",
    watchlist: "AGGY",
  });

  // 9. The inline one-click clear only removes the active tab's query
  const searchClear = reloaded.el("search-clear-btn");
  expect(searchClear.classList.contains("hidden")).toBe(false);
  searchClear.click();
  expect(reloaded.el("search-input").value).toBe("");
  expect(searchClear.classList.contains("hidden")).toBe(true);
  expect(JSON.parse(reloaded.storage.getItem(FILTERS_KEY)!)).toEqual({
    All: "yield enhanced",
    "detail:overview": "returns",
    "detail:holdings": "treasury",
  });

  // #reset-btn still clears selection and every tab filter
  reloaded.el("reset-btn").click();
  expect(reloaded.el("search-input").value).toBe("");
  expect(reloaded.storage.getItem(FILTERS_KEY)).toBeNull();
  expect(reloaded.run<string[]>("[...state.selected]")).toEqual([]);
  expect(reloaded.el("ticker-count").textContent).toBe("94 ETFs");
}, 300000);

// =============================================================================
// 17. One-click clear button
// =============================================================================

test("17. #search-clear-btn visibility, active-tab clearing, and immediate re-render", async () => {
  const app = await bootFresh();
  const input = app.el("search-input");
  const clearBtn = app.el("search-clear-btn");

  expect(clearBtn.classList.contains("hidden")).toBe(true);
  setSearch(app, "emerging"); // matches 13 ETFs
  expect(clearBtn.classList.contains("hidden")).toBe(false);
  expect(app.run<number>("visibleCatalogRows().length")).toBe(13);
  expect(app.el("ticker-count").textContent).toBe("13 ETFs");

  clearBtn.click();
  expect(input.value).toBe("");
  expect(clearBtn.classList.contains("hidden")).toBe(true);
  expect(app.el("ticker-count").textContent).toBe("94 ETFs");
  expect(JSON.parse(app.storage.getItem(FILTERS_KEY) ?? "null") ?? {}).toEqual({});

  // typing again makes the button visible again
  setSearch(app, "bond");
  expect(clearBtn.classList.contains("hidden")).toBe(false);

  // tab switch updates visibility to the destination tab's stored query
  await clickTab(app, "All");
  setSearch(app, "");
  toggleRow(app, "AGGY");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("Watchlist"));
  await clickTab(app, "watchlist");
  expect(clearBtn.classList.contains("hidden")).toBe(true);
}, 180000);
