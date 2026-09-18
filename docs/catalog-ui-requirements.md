# Catalog UI requirements: dividend-frequency column + pinned columns

This is a concrete, WisdomTree-specific implementation plan for two catalog-table
features that have already been built and verified in the sibling SPDR repo
(`daggerok/SPDR`). It was written by investigating this repo's actual current
code (`app.tsx`, `index.html`, `scripts/update-data.ts`, `README.md`,
`docs/ui-contract.md`) — not copied from SPDR's generic checklist. Follow it
mechanically; the specific selectors, function names, and code snippets below
match this repo as of the commit this plan was written against
(`git log -1` on `main`, catalog table implemented in `app.tsx` /
`index.html`).

Do not touch any table other than the **All ETFs** catalog table
(`renderFundsTable()` in `app.tsx`, rendered into `#table-head` / `#table-body`
inside `#table-scroll`). The Watchlist table (`renderWatchlistTable()`), the
per-fund Overview/Distributions/Holdings/History sheet tables
(`renderOverviewTable()`/`renderDistributionsTable()`/generic sheet renderer
around line 1278+) all reuse the same `#table-scroll` container and the same
`sortHeader()` / `indexHeader()` helper functions. Feature 2 below is written
so it only ever touches the catalog table, never those others.

## 1. Distribution frequency column — already implemented and correct

WisdomTree already has this column (see git history: "Add dividend frequency
catalog column (#7)"). Investigation confirms it already meets the full spec.
**No code changes are required for Feature 1.** Do not add a second frequency
column or a second formatting function.

What exists today, verified against `app.tsx`:

- **Data source**: `fund.distributions.frequency`, populated in
  `scripts/update-data.ts` by `inferDistributionFrequency()` (around line 912),
  which derives the cadence from the gap between consecutive dividend
  ex-dates in the **Yahoo Finance public chart API** feed
  (`/v8/finance/chart/{TICKER}?...events=div|split...`, see
  `README.md` → "Daily history and distributions"). This is the same feed
  WisdomTree already uses for history; the plan does not add a new source.
  `inferDistributionFrequency()` returns exactly these raw labels: `Monthly`,
  `Quarterly`, `Semi-Annual`, `Annual`, `None`, `Unknown`, `Irregular`.
- **Formatting/coding function**: `formatDividendFrequency()` (`app.tsx`
  line 301) normalizes all of the above (and spelling variants such as
  `Semi-Annually`/`Semiannual`, `Annually`) into the two-digit prefixed codes:
  `00 - —`, `01 - Monthly`, `04 - Quarterly`, `06 - Semi-annually`,
  `12 - Annually`, `00 - None`, `00 - Unknown`, `99 - Irregular`. This exactly
  matches the required coding scheme.
- **Wiring**: `normalizeFundRow()` (`app.tsx` line 409) sets
  `row.dividendFrequency = formatDividendFrequency(fund.distributions.frequency ?? '—')`,
  so the coded string is what's sorted, displayed and exported — never
  recomputed in the browser.
- **Catalog header**: `sortHeader('Dividend Frequency', 'dividendFrequency')`
  at `app.tsx` line 899. WisdomTree's column label is **"Dividend Frequency"**
  (not the bare "Frequency" SPDR uses) — this is this repo's own established
  naming (paired with the existing "Dividend Yield" and "SEC Yield" columns)
  and should be kept as-is; do not rename it.
- **Column placement**: `TER`(Expense) → **Dividend Frequency** →
  `Dividend Yield` → `SEC Yield` → `YTD Return` → ... (see the header row in
  `renderFundsTable()`, `app.tsx` lines 890–916). Neither `README.md` nor
  `docs/ui-contract.md` enumerates a stricter explicit column order than what
  is already implemented, so this existing placement **is** WisdomTree's
  column contract — keep it exactly where it is. Do not move it to "after SEC
  Yield" (that was SPDR's own layout, not a cross-repo requirement — the
  generic checklist explicitly says to preserve a sibling's existing explicit
  order when it differs).
- **Header tooltip**: `COLUMN_TOOLTIPS['Dividend Frequency']` (`app.tsx` line
  150) already states the source and the numeric codes: *"Dividend Frequency
  — sortable payment cadence from the Yahoo dividend history: 01 - Monthly,
  04 - Quarterly, 06 - Semi-annually, 12 - Annually; 00 denotes
  unavailable/unknown and 99 denotes irregular."* Rendered via
  `getHeaderTooltip()` as the `title` attribute on both the `<th>` and the
  sort `<button>` inside `sortHeader()`.
- **CSV/TXT export**: `currentExportRows()` (`app.tsx` line 1443) includes
  `'Dividend Frequency'` in the `headers` array at the same relative position
  as the visible catalog column, and `fund.dividendFrequency || ''` in the row
  values (line 1525), in the same order. Both `exportCsv()` and `exportTxt()`
  (lines 1561/1571) call the same `currentExportRows()`, so CSV and TXT are
  automatically kept in sync — no separate export-formatting code exists that
  could drift.
- **Detail view**: `renderOverviewTable()`'s Distributions section (line
  1229) and `renderDistributionsTable()`'s subtitle (line 1311) both continue
  to show the raw, uncoded label (e.g. "Monthly") from
  `fund.distributions.frequency` directly — this is correct per spec: the
  coded value is only required for the sortable catalog column and exports.

**Conclusion: nothing to build here.** If the implementing agent is told to
"add" this feature, it must first re-read `app.tsx` lines 301–313, 409–437,
899, and 1516–1525 and confirm this description still matches before touching
anything — it should not create a duplicate column, a duplicate formatting
function, or a second export header.

## 2. Horizontally pinned catalog columns — needs to be built from scratch

Nothing resembling column pinning exists yet. `grep -in "sticky\|pinned"
app.tsx index.html` only turns up the *vertical* header stickiness already on
`<thead id="table-head">` in `index.html` line 190
(`class="... sticky top-0 z-20 backdrop-blur"`). There is no horizontal
pinning of any column today, and the `<table>` currently uses Tailwind's
`border-collapse` utility (`index.html` line 189:
`<table class="w-full text-left border-collapse whitespace-nowrap">`), which
sets `border-collapse: collapse` — the opposite of what sticky columns need.

### 2.0 WisdomTree's real catalog column contract

Row order today, from `renderFundsTable()` (`app.tsx` lines 887–959):

| # | Header | Cell key / value | Header helper | Width today |
|---|---|---|---|---|
| 1 | `#` | row index | `indexHeader()` | `w-12` (3rem) — **not pinned** |
| 2 | `Use` | checkbox + blacklist `✕` button | `useHeader()` | `w-20` (5rem) — **pin this** |
| 3 | `Ticker` | `fund.ticker` | `sortHeader('Ticker', 'ticker')` | none today — **pin this, give it a width** |
| 4 | `Fund Name` | `fund.name` | `sortHeader('Fund Name', 'name')` | none |
| 5 | `Type` | `fund.category` | ... | none |
| 6+ | `NAV`, `Net Assets`, `Expense`, `Dividend Frequency`, `Dividend Yield`, `SEC Yield`, `YTD Return`, `TR 1Y`…`TR 10Y`, `CAGR 3Y`…`CAGR 10Y`, `SI Ann.`, `Return As Of`, `Inception`, `Holdings`, `History`, `As Of` | — | — | none |

So: pin **`Use`** then **`Ticker`**, in that order, exactly per spec — `#`
stays an ordinary (non-sticky) leading column, and it keeps rendering before
`Use` in row order.

`indexHeader()` and `sortHeader()` are shared by other tables (Watchlist,
Overview, Distributions, generic sheet views — see the "Do not touch" note
above). `useHeader()` is used **only** by `renderFundsTable()` (confirmed:
`grep -n "useHeader()" app.tsx` returns exactly one call site, line 892), so
it is safe to hard-code the sticky classes inside `useHeader()` itself.
`sortHeader()` is **not** safe to hard-code — it is called 20+ times across
5+ tables, including the Watchlist's own Ticker column
(`sortHeader('Ticker', 'symbol')`, `app.tsx` line 1066, note the different
key `symbol`). To pin only the catalog's Ticker header without affecting the
Watchlist or sheet tables, add an optional trailing parameter to
`sortHeader()` and pass it only at the one catalog call site.

### 2.1 JS/markup changes — `app.tsx`

**a) `sortHeader()` (line 840) — add an optional `extraClass` parameter, default empty:**

```ts
function sortHeader(label: string, key: string, numeric = false, extraClass = ''): string {
  const active = state.sortKey === key;
  const arrow = active ? (state.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
  const align = numeric ? ' text-right' : '';
  const tooltip = getHeaderTooltip(label);
  return `<th class="py-3.5 px-4${align}${extraClass ? ' ' + extraClass : ''}" title="${escapeHtml(tooltip)}"><button data-sort="${escapeHtml(key)}" title="${escapeHtml(tooltip)}" class="uppercase tracking-wider hover:text-blue-600 dark:hover:text-blue-400 focus:outline-none focus:text-blue-600 dark:focus:text-blue-400">${escapeHtml(label)}${arrow}</button></th>`;
}
```

This is backward compatible — every other call site (Watchlist, sheets,
Overview) omits the 4th argument and renders exactly as before.

**b) `renderFundsTable()` header row (line 893) — pass the extra classes only here:**

```ts
${sortHeader('Ticker', 'ticker', false, 'catalog-sticky-col catalog-sticky-ticker')}
```

**c) `useHeader()` (line 852) — add the sticky classes directly (safe: single call site):**

```ts
function useHeader(): string {
  const candidates = visibleFunds();
  const allSelected = candidates.length > 0 && state.selected.size === candidates.length;
  return `<th class="catalog-sticky-col catalog-sticky-use py-3.5 px-4 w-20 text-center" title="${escapeHtml(getHeaderTooltip('Use'))}">
    <div class="inline-flex items-center justify-center gap-1">
      <input type="checkbox" id="select-all-checkbox" ${allSelected ? 'checked' : ''} class="w-4 h-4 accent-blue-600 cursor-pointer" title="Select / Deselect all ETFs" />
      <span>Use</span>
    </div>
  </th>`;
}
```

**d) Row template inside `renderFundsTable()` (lines 927–936) — add sticky classes to the same two `<td>`s, no new wrapper element:**

```ts
<tr data-ticker="${escapeHtml(fund.ticker)}" class="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/30 transition border-b border-slate-100 dark:border-slate-700/30 ${selected ? 'selected-row' : ''}">
  <td class="py-2.5 px-4 text-slate-400 dark:text-slate-500 text-xs text-center font-mono">${index + 1}</td>
  <td class="catalog-sticky-col catalog-sticky-use py-2.5 px-4 text-center">
    <div class="inline-flex items-center justify-center gap-1.5">
      <input data-checkbox="${escapeHtml(fund.ticker)}" type="checkbox" ${selected ? 'checked' : ''} class="w-4 h-4 accent-blue-600" aria-label="Use ${escapeHtml(fund.ticker)}" />
      <button data-blacklist="${escapeHtml(fund.ticker)}" class="w-4 h-4 rounded text-slate-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 leading-none transition" title="Blacklist ${escapeHtml(fund.ticker)} — hide it from All ETFs">✕</button>
    </div>
  </td>
  <td class="catalog-sticky-col catalog-sticky-ticker py-2.5 px-4 font-mono font-semibold text-blue-600 dark:text-blue-400">${escapeHtml(fund.ticker)}</td>
  <td class="py-2.5 px-4 text-slate-700 dark:text-slate-300 font-medium" title="${escapeHtml(fund.name)}">${escapeHtml(fund.name)}</td>
  <!-- ...all remaining <td>s are unchanged... -->
```

Do not add any wrapper `<div>`/`<span>` inside these two `<td>`s beyond what
already exists (the `Use` cell's `inline-flex` div is pre-existing and stays;
it is not the sticky element — the `<td>` itself is). Padding/typography
classes on both cells are unchanged; only the two `catalog-sticky-*` classes
and (for `Use`) the sticky-col class are added.

### 2.2 CSS changes — `index.html`

Add the following block to the existing `<style>` element in `index.html`
(insert it right after the existing comment/rule block for
`#table-scroll{overscroll-behavior:contain}`, around line 87). Do **not**
change the `border-collapse` Tailwind class on the `<table>` element itself
(`index.html` line 189) — the `#table-scroll table{border-collapse:separate}`
rule below has higher CSS specificity (ID + tag vs. a single utility class)
and will override it in place, so the markup does not need to change:

```css
/*
 * Horizontally pinned catalog columns (Use + Ticker). Sticky positioning is
 * applied directly to the pinned <th>/<td> cells (see .catalog-sticky-col
 * below) -- never to a wrapper nested inside an otherwise-static cell. A
 * sticky element can't move past the bounds of its own containing block; if
 * that block were a static parent cell instead of the cell itself, the pin
 * would silently vanish once the row scrolled past the viewport edge. Verify
 * by actually scrolling all the way to the right, not just by reading this
 * CSS.
 */
#table-scroll table{min-width:max-content;border-collapse:separate;border-spacing:0;isolation:isolate}
#table-scroll tbody{position:relative;z-index:0}
#table-scroll tbody tr{position:relative;z-index:0}
#table-scroll .catalog-sticky-col{position:sticky;background:#fff;background-clip:padding-box}
#table-scroll thead .catalog-sticky-col{top:0;z-index:30}
#table-scroll tbody .catalog-sticky-col{z-index:20}
#table-scroll .catalog-sticky-use{left:0;width:5rem;min-width:5rem}
#table-scroll .catalog-sticky-ticker{left:5rem;width:7rem;min-width:7rem;box-shadow:4px 0 6px -6px rgba(15,23,42,.7)}
.dark #table-scroll .catalog-sticky-col{background:#162032}
#table-scroll tbody tr:hover .catalog-sticky-col{background:#f8fafc}
#table-scroll tbody tr.selected-row .catalog-sticky-col{background:#eff6ff}
.dark #table-scroll tbody tr:hover .catalog-sticky-col{background:#1f2a3c}
.dark #table-scroll tbody tr.selected-row .catalog-sticky-col{background:#18274e}
```

Notes on where these values come from (this repo's own tokens, not SPDR's):

- **`left` offsets**: `Use` is first at `left:0`; `Ticker` sits immediately
  after it, so its offset equals `Use`'s own width, `5rem` (matching the
  existing `w-20` Tailwind class already on `useHeader()`'s `<th>`).
- **Ticker column width (`7rem`)**: WisdomTree has no existing width on the
  Ticker column today (unlike `Use`, which already has `w-20`). All current
  WisdomTree tickers are 4 characters (checked against
  `api/wisdomtree/index.json`, e.g. `DGRW`, `AGGY`, `USFR`), but the header
  label itself is `"Ticker"` plus a sort arrow (`↑`/`↓`) in `text-xs
  uppercase tracking-wider`, which needs more room than the 4-character
  ticker text. `7rem` (112px) is a generous estimate that leaves the
  Tailwind-preflight border-box content area (112px minus `px-4` = 32px of
  padding = 80px of content) comfortably wider than either the header label
  or a 4-character mono ticker. **This is an estimate, not a measurement —
  the mandatory verification step below (scroll all the way right in a real
  browser) must confirm the column doesn't visually overflow its 7rem box or
  leave a gap; adjust the `width`/`min-width` value (and the checkbox
  column's, if you also change that) if it does, and keep the `left` offset
  equal to the actual rendered width of the `Use` column.**
- **Dark-mode background colors** (`#162032` default, `#1f2a3c` hover,
  `#18274e` selected): computed by alpha-compositing WisdomTree's own
  existing dark tokens, not reused from SPDR (SPDR's palette differs). The
  catalog table's dark background comes from the card container class
  `dark:bg-slate-800/50` (`index.html` line 187) over the page's
  `dark:bg-slate-900` body background (`index.html` line 99) — i.e. slate-800
  `#1e293b` at 50% opacity over slate-900 `#0f172a`, which composites to
  `#162032`. The row hover class is `dark:hover:bg-slate-700/30`
  (`app.tsx` line 927) — slate-700 `#334155` at 30% opacity over that same
  `#162032` base, composing to `#1f2a3c`. The selected-row rule is
  `.dark .selected-row{background:rgba(30,64,175,.22)}` (`index.html` line
  52) — composited over the `#162032` base, giving `#18274e`. Light mode
  needed no computation: the card background is plain `bg-white` (`#ffffff`,
  opaque already), the hover class `hover:bg-slate-50` is already opaque
  (`#f8fafc`), and `.selected-row{background:#eff6ff}` (`index.html` line 51)
  is already opaque — so those three light-mode values are used as-is.
- **Box shadow** on `.catalog-sticky-ticker` marks the pinned boundary, same
  value used in the SPDR reference (`4px 0 6px -6px rgba(15,23,42,.7)`,
  slate-900-based) — WisdomTree's own slate-900 token is `#0f172a`, i.e. the
  same `rgba(15,23,42,.7)`, so no change needed there.

### 2.3 Acceptance checklist

- [ ] `#` remains unpinned and un-sticky; it still renders first and scrolls
      away with the rest of the row.
- [ ] `Use` (checkbox + blacklist button) is pinned at `left:0`; `Ticker` is
      pinned immediately after it at `left:` (the `Use` column's actual
      rendered width).
- [ ] Scrolling `#table-scroll` **all the way to the right** in an actual
      (or automated headless) browser keeps both `Use` and `Ticker` visible
      and legible for every row, including the last row and while the table
      is also scrolled vertically. Do not sign off from reading the CSS
      alone — this is the exact regression the SPDR repo had to fix.
- [ ] The pinned header cells (`thead .catalog-sticky-col`) stay above pinned
      body cells (`tbody .catalog-sticky-col`) when scrolled both ways at
      once (z-index 30 vs 20).
- [ ] Pinned cells have a fully opaque background in all of: default row,
      hovered row, selected row (`.selected-row`), in both light and dark
      theme (toggle via the existing `#theme-toggle` button /
      `wisdomtree-theme` localStorage key) — no text from a scrolled-behind
      column is visible through a pinned cell in any of those six states.
- [ ] The checkbox, and the blacklist `✕` button, inside the pinned `Use`
      cell remain clickable after scrolling right.
- [ ] `Watchlist`, `Overview`, `Distributions`, and any other sheet-style tab
      rendered into `#table-scroll` are visually unaffected — no unintended
      pinned/sticky columns appear there. (They share `sortHeader()` and
      `indexHeader()` but none of them pass the new `extraClass` argument or
      use `useHeader()`.)
- [ ] Search, sort (including sorting by the `Dividend Frequency` column),
      row selection, dark theme, lazy loading (`static-load-sentinel`), and
      the table's dynamic height calculation (`el.tableScroll.style.maxHeight`
      in `app.tsx`) all continue to work unchanged.
- [ ] `Dividend Frequency` column (Feature 1) is untouched — still positioned
      between `Expense` and `Dividend Yield`, still using the `00`/`01`/`04`/
      `06`/`12`/`99` codes, still exported in `currentExportRows()`.

## Handoff summary

Feature 1 (dividend-frequency column) is fully implemented and correct
already — verified against `formatDividendFrequency()`, `normalizeFundRow()`,
the `Dividend Frequency` header/tooltip, and `currentExportRows()` in
`app.tsx`; no code change needed. Feature 2 (pinned `Use`+`Ticker` columns)
does not exist yet and must be built from scratch: add an `extraClass`
parameter to `sortHeader()` (used only at the catalog's `Ticker` header call
site), hard-code sticky classes into `useHeader()` (its only call site is the
catalog), add matching classes to the two pinned `<td>`s in
`renderFundsTable()`'s row template, and add the CSS block in section 2.2 to
`index.html`. The `left` offsets, widths, and dark-mode colors in that CSS
block were computed against WisdomTree's own existing Tailwind classes and
tokens (`w-20` Use column, `dark:bg-slate-800/50` card background over
`dark:bg-slate-900` page background, `dark:hover:bg-slate-700/30` row hover,
`rgba(30,64,175,.22)` selected-row tint) — do not substitute SPDR's hex
values. The Ticker column's `7rem` width is an estimate that must be
confirmed (or adjusted) by actually scrolling the rendered table, per the
acceptance checklist.
