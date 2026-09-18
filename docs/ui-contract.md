# WisdomTree ETF UI contract

This document is the normative UI contract for the single-file application in
`index.html` + `app.tsx`, shared in spirit with the other daggerok provider
apps (SPDR, iShares, Amplify, Vanguard) while using this repository's own tab
names, identifiers and payload schema. Acceptance tests for every section live
in `scripts/ui.test.ts` and run against the real generated feed in
`api/wisdomtree/`.

## Tabs

- **All ETFs** (`All`) plus one tab per WisdomTree asset class (category).
- Detail tabs for the active (selected) fund: **Overview**, **Holdings**,
  **History**, **Distributions** (`detail:overview|holdings|history|distributions`).
- **Watchlist** (`watchlist`) — the aggregated, deduplicated holdings of every
  selected ETF.

Unlike the Vanguard app, return metrics are not a separate Performance tab
here; they are the `Returns` section rows of the Overview tab.

## Storage keys (localStorage)

| Key | Content |
| --- | --- |
| `wisdomtree-selected-etfs` | JSON array of selected ETF tickers |
| `wisdomtree-active-fund` | active fund ticker (removed when none) |
| `wisdomtree-blacklisted-etfs` | JSON array of blacklisted tickers |
| `wisdomtree-tab-sorts` | JSON map `tab -> { key, dir }` of **explicitly chosen** sorts |
| `wisdomtree-tab-filters` | JSON map `tab -> query` of **explicitly entered** filters |
| `wisdomtree-site-state` | auxiliary state: `sheetFilter` mirror of the per-tab filter map plus the last `activeTab` |
| `wisdomtree-theme` | `dark` / `light` |
| `wisdomtree-searches` | **legacy** pre-rename filter key; migrated at boot and removed on first write |

Malformed values are sanitized at boot and can never crash the app: only a
non-empty sort key plus `asc`/`desc` is accepted; non-string or empty filter
values are dropped; broken JSON falls back to defaults.

## 1. Sort persistence

- Every tab (All ETFs, category tabs, Watchlist, Overview, Holdings, History,
  Distributions) remembers its own last **explicitly selected** column and
  direction in `wisdomtree-tab-sorts`.
- The remembered sort is restored whenever the tab is reopened and after a
  full reload. A tab that was never explicitly sorted keeps its default:
  catalog tabs and detail sheets = source order (`rank`), Watchlist =
  Weight Sum desc, Overview = Section asc.
- **No button or checkbox may reset sorting** — not row Use checkboxes, not
  the header Use select-all, not the All ETFs pill checkbox, not tab buttons
  (including the All ETFs button), not search, Copy Tickers, CSV/TXT export,
  theme toggle, blacklist actions, and not Clear.
- **Clear removes the selection and the searches only**; remembered sorts
  survive in memory and in localStorage.
- Defaults are never written to storage as remembered sorts; only column
  header clicks record a sort.

## 2. Per-tab filter persistence & 1-click clear

- Every tab remembers its own search query in `wisdomtree-tab-filters`.
- The search input is scoped to the current view: typing in the search input
  filters only the active tab and persists its filter.
- Switching tabs saves the outgoing tab's input text (transition guard in the
  tab click handler) and restores the destination tab's query into the input.
- Tabs with no explicit filter default to empty (`""`), rendering their full
  unfiltered data — preventing cross-view search collisions such as a catalog
  search wiping out the Overview metrics or Watchlist rows.
- Backspacing/clearing the input removes the entry for that tab.
- **Clear removes the selection and all per-tab searches** from memory and
  from `wisdomtree-tab-filters`.
- Filter persistence survives tab switches and full page reloads; the active
  tab itself is restored from `wisdomtree-site-state`.
- The search field is wrapped in a relative toolbar container with a
  right-edge `#search-clear-btn` (`✕`). It is hidden for an empty value,
  appears as soon as the active query has text, and clears only that tab's
  entry, updates both storage keys, focuses the input, and re-renders
  synchronously. Its visibility is refreshed on input, tab switches,
  restored state, the one-click clear, and Clear.
- `wisdomtree-site-state.sheetFilter` mirrors the dedicated filter map so
  older sessions can migrate without reintroducing a global search string.
- Malformed storage is sanitized at boot and can never crash the app.

## 3. Selection scopes

Three distinct operations:

1. **Row Use checkbox** (or row click) — toggles exactly one ETF.
2. **Header Use checkbox** (in the catalog table head) — scope is exactly the
   rows currently rendered by the catalog table: catalog tab + active search
   filter + blacklist exclusion. Checking selects exactly those visible rows;
   unchecking deselects exactly those visible rows; selections hidden by
   another filter survive. Its checked state is computed with `.every(...)`
   over the visible rows (true iff every visible row is selected), never by
   comparing selection size to a catalog count.
3. **All ETFs pill checkbox** — scope is always **every non-blacklisted ETF in
   the entire catalog**, independent of any category/detail/Watchlist tab and
   of any search filter. Checking selects the whole catalog; unchecking
   clears the whole-catalog selection. Clicking it toggles selection only and
   never navigates to All ETFs. Its checked state is `.every(...)` over all
   non-blacklisted catalog tickers.

## 4. Immediate selection reactivity

After every selection writer — row toggle, header select-all, All ETFs pill,
blacklist removal from selection, Clear, and localStorage restore — the app
updates immediately (no extra click needed):

- selected ETF count and clickable ticker badges in the subtitle (the active
  fund is highlighted);
- active fund ticker (falls back to another selected fund when the active one
  is deselected);
- detail-tabs panel visibility and per-sheet counts (Overview, Holdings,
  History, Distributions);
- Watchlist tab visibility, loading state and count;
- `wisdomtree-selected-etfs` / `wisdomtree-active-fund` in localStorage.

Clicking a catalog row, a selected ticker badge in the subtitle, or an ETF
badge inside a Watchlist row activates that fund and opens/loads its detail
view.

On reload: selection restores; the active fund restores if still selected
(otherwise the first selected fund); the active tab restores; the active
fund's sheets load in the background; selected holdings start loading in the
background; the Watchlist rebuilds without any checkbox interaction.

## 5. Holdings & Watchlist reactivity

`ensureHoldingsForSelection()` runs after selection restore, after every row
selection change, after either select-all control, after blacklist changes
that alter selection, and whenever the Watchlist tab is opened.

- The Watchlist tab count is the number of **deduplicated holding rows**, not
  the number of selected ETFs.
- While holdings are loading the tab never shows a misleading exact count: it
  shows `Watchlist (Loading…)` when nothing is aggregated yet and
  `Watchlist (N+)` while partial results stream in. Once loading finishes it
  shows the exact deduplicated count — and the tab bar refreshes even while
  the user stays on another tab.
- The Watchlist table mirrors this: `Loading holdings of N selected ETFs…`
  while nothing is aggregated; partial rows plus a loading note while
  streaming; the search-specific empty state when a search matches no rows;
  and only after loading completes with no usable holdings: `Holdings data is
  not available yet. Run bun ./scripts/update-data.ts to refresh the WisdomTree feed.`
- Deselecting ETFs immediately removes their positions and recomputes count,
  Weight Sum, Max Weight, ETF badges and # ETFs. Because holdings overlap,
  deselecting one ETF does not guarantee every count decreases — but all
  values exactly reflect the remaining selection.

## 6. Watchlist aggregation & identifier fallbacks

Columns: Ticker/security key, Name, ETFs (clickable badges), # ETFs,
Weight Sum, Max Weight, Identifier.

The WisdomTree feed publishes one `Identifier` column per holding row
(CUSIP or ISIN as recorded by the data build) plus `Ticker` and `Name`;
there are no separate CUSIP/ISIN/SEDOL columns.

Dedupe key fallback order (blank values, `-`, `--`, `—`, `–`, `N/A`, `NA`,
`NONE`, `NULL` count as missing):

1. Ticker (any non-placeholder ticker, including numeric local listing codes
   such as `005930`);
2. CUSIP;
3. ISIN;
4. Identifier / Security ID;
5. SEDOL / FIGI;
6. published security name (last resort for legitimate cash/futures/swaps/
   derivatives without any identifier).

**WisdomTree extension:** some EDGAR N-PORT filings publish the literal all-
zero CUSIP `000000000` for positions without a CUSIP. All-zero identifiers
are treated as missing as well, so those rows fall through to the published
name instead of collapsing into a single garbage key (`D:000000000` must
never appear in the aggregation).

A literal `-` Ticker must not prevent fallback to a valid identifier. Keys
are namespaced by type (`T:`/`C:`/`I:`/`D:`/`S:`/`N:`) so identifier values
never collide with tickers.

Rows are never aggressively dropped: bond positions without exchange tickers,
cash positions (e.g. the `CASH` rows published in the feed), futures/swaps/
derivatives and zero-weight rows with otherwise valid data all remain in the
aggregation. `scripts/ui.test.ts` (test 12) proves these rows are retained
against the real feed.

## 7. Cache & paging races

- `meta.json` requests are deduplicated per ticker while in flight (detail
  view and Watchlist loader share one request).
- Each ticker has at most one holdings-page writer: the detail-view pager and
  the background Watchlist loader enqueue onto the same per-ticker chain, and
  each unit of work re-checks `nextPage` while holding the chain — two rapid
  selection updates can never duplicate a page or skip another. Page
  envelopes are cached in `sheetState` under each fund's own key and shared
  between both consumers.
- Holdings loading runs with bounded concurrency (6 funds at a time) when All
  ETFs selects the whole catalog; queued work for an ETF deselected meanwhile
  is safely skipped; in-flight loads finish into the cache and are ignored by
  the aggregation, which only reads the current selection.
- The aggregation is memoized and invalidated whenever the selection or the
  loaded row counts change; progressive Watchlist rerenders are throttled
  (~150 ms) and happen even while the user stays on the catalog tab.
- Every page listed in `meta.json holdings.pages` is loaded for complete
  aggregation.

### Large-Watchlist rendering

The Watchlist renders in chunks of 250 rows; scrolling near the bottom (or
clicking the "load more" row) grows the rendered chunk. The full deduplicated
result is never inserted into the DOM at once. Copy Tickers / CSV / TXT
export always operate on the complete active-tab filtered result, not just
the rendered chunk; a search can reduce the exported set without limiting it
to the mounted 250-row slice.

## 8. Payload contract

- `api/wisdomtree/index.json` — catalog; `funds[].holdings`/`funds[].history`
  agree with the per-fund manifests (validated by the acceptance tests' feed
  oracle, test 15).
- `api/wisdomtree/funds/<TICKER>/meta.json` — `holdings.pages[]` and
  `history.pages[]` manifests plus identifiers, yields and inline
  Distribution rows.
- Page rows are keyed by the literal `headers` strings published in each page
  envelope (holdings: `Name`, `Ticker`, `Identifier`, `Weight`, `Market
  Value`, `Shares Held`, `Asset Category`, plus `Coupon`/`Maturity` for bond
  funds; history: `Date`, `Close`, `Adj Close`, `Volume`).
- Distributions use the actual ex-date from the Yahoo chart feed, rendered
  under the `Ex-Date` column.

## 9. Detail views

Clicking a selected fund loads its actual data. Holdings, History, Overview
and Distributions render real rows when their manifests/rows exist; infinite
scroll loads subsequent pages without duplicate requests. Switching funds or
sheets resets the paging generation. The previous fund's table is never left
visible while the next fund loads (a loading placeholder is shown), and
fetch failures render `Could not load <TICKER> data — …` instead of stale
rows or a "no search matches" message. Funds without published data get
per-sheet explanatory empty states.

## 10. Sticky columns

- Catalog: the **Use** header/body cells are pinned at `left: 0` and the
  **Ticker** header/body cells immediately after (`left: 5rem`).
- Watchlist: the **Ticker** header/body cells are pinned at the left edge
  (`left: 0`, `.watchlist-sticky-col` / `.watchlist-sticky-ticker`).
- Sticky positioning is applied directly to each `th`/`td` (not a nested
  span), with opaque light/dark backgrounds, correct z-index, and matching
  hover backgrounds so scrolled text never bleeds through.
- Only the table area scrolls (`overscroll-behavior: contain` plus a fitted
  max-height); the document never scrolls vertically.

## 11. Acceptance tests

`scripts/ui.test.ts` boots the real application script inside a headless
harness (`scripts/ui-harness.ts`: minimal fake DOM, localStorage and a
file-backed `fetch` over `api/wisdomtree/`) and covers:

1. sort round-trip through tabs/checkboxes/buttons/Clear/reload;
2. header Use check selects exactly the filtered rows;
3. header Use uncheck keeps hidden selections;
4. All ETFs pill scope from Watchlist/detail tabs, blacklist exclusion, no
   navigation;
5. one ETF: Watchlist Loading → exact deduplicated count;
6. rapid overlapping selections: no duplicate/skipped pages, exact overlap
   aggregates (# ETFs, Weight Sum, Max Weight);
7. deselection updates subtitle/badges/tabs/Watchlist immediately;
8. select-all exact full-catalog aggregate vs. an independently computed
   oracle, with bounded DOM rendering;
9. reload restores selection, active fund and background loading;
10. Holdings (shared cache, exactly one fetch per page), History (infinite
    scroll), Overview and Distributions render real rows;
11. failing fund files produce an explanatory state replacing the prior table;
12. identifier fallbacks for bonds, cash, all-zero CUSIP placeholders and
    numeric local tickers are kept;
13. sticky classes present on catalog Use/Ticker and Watchlist Ticker cells;
14. malformed localStorage cannot crash boot;
15. index.json / meta.json / page manifests stay consistent;
16. per-tab filter persistence across all catalog, detail, and Watchlist
    views, including the site-state mirror and Clear;
17. one-click `#search-clear-btn` visibility, active-tab clearing, and
    immediate unfiltered re-render.

Run them with `bun test` (or `bun test scripts/ui.test.ts`). Expected values
are computed from this repository's generated feed, never copied from another
provider.
