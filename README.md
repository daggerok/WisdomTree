# WisdomTree

WisdomTree ETF holdings to Watchlist. A single-file client-side tool that reads the generated `./api/wisdomtree` static feed (the official WisdomTree U.S. product table and per-fund pages, SEC EDGAR N-PORT-P holdings, Yahoo Finance daily history and distributions, and an issuer-page top-holdings fallback for the crypto ETP that is not represented in the SEC mutual-fund ticker table) into a searchable ETF / asset-class catalog with per-fund tabs, watchlist aggregation, ticker copy and CSV/TXT export — the same look, feel, columns and business logic as the sibling applications.

## Shared UI contract

The common interaction and data-state rules are documented in [`docs/ui-contract.md`](./docs/ui-contract.md). New provider-specific behavior preserves this contract. The WisdomTree-specific data plan, source decisions and coverage limitations are documented in [`docs/wisdomtree-static-data-plan.md`](./docs/wisdomtree-static-data-plan.md).

## Sibling applications

| Application | Data provider | Repository |
| --- | --- | --- |
| Amplify ETF Holdings to Watchlist | Amplify ETFs (Firestore data feed) | [daggerok/Amplify](https://github.com/daggerok/Amplify) · [published app](https://daggerok.github.io/Amplify/) |
| iShares Excel .xls to Watchlist | iShares (BlackRock) product workbooks | [daggerok/iShares](https://github.com/daggerok/iShares) · [published app](https://daggerok.github.io/iShares/) |
| SPDR ETF Holdings to Watchlist | SSGA / State Street public feeds | [daggerok/SPDR](https://github.com/daggerok/SPDR) · [published app](https://daggerok.github.io/SPDR/) |
| Fidelity ETF Holdings to Watchlist | SEC EDGAR N-PORT-P + Yahoo Finance | [daggerok/Fidelity](https://github.com/daggerok/Fidelity) · [published app](https://daggerok.github.io/Fidelity/) |
| Invesco ETF Holdings to Watchlist | Invesco public downloads + Yahoo Finance | [daggerok/Invesco](https://github.com/daggerok/Invesco) · [published app](https://daggerok.github.io/Invesco/) |
| WisdomTree ETF Holdings to Watchlist | WisdomTree U.S. product table + SEC EDGAR N-PORT-P + Yahoo Finance | [daggerok/WisdomTree](https://github.com/daggerok/WisdomTree) · [published app](https://daggerok.github.io/WisdomTree/) |

## Using Bun

```bash
bunx degit daggerok/WisdomTree#main ./12345 && cd $_
bunx serve . -p 1234
open http://0:1234
```

The published application is available at <https://daggerok.github.io/WisdomTree/>.

The application is a static site: `index.html` loads `api/wisdomtree/index.json` and the paginated fund files with relative URLs. It can be hosted by GitHub Pages or any static file server.

## Updating the static WisdomTree data

Run the zero-dependency updater with Bun:

```bash
bun test scripts/update-data.test.ts
bun ./scripts/update-data.ts
```

Run `bun ./scripts/update-data.ts --help` to print the configuration variables and examples. The **Update WisdomTree ETF data** GitHub Actions workflow exposes the same settings as manual inputs. All supplied filters use **AND** logic.

### Data sources

| Block | Source |
| --- | --- |
| U.S. ETF catalog, category, inception date, gross/net expense ratio, AUM and trailing-12-month yield | Official WisdomTree U.S. product table: [`wisdomtree.com/us/products`](https://www.wisdomtree.com/us/products). The updater first requests that page directly and falls back to a read-only `r.jina.ai` rendering of the same official URL when Cloudflare blocks a non-browser request. |
| Per-fund NAV, closing market price, premium/discount, CUSIP, SEC yield and official returns | The official WisdomTree product page for each catalog URL, rendered through the same read-only proxy when necessary. Product-page `Market Price Returns` are used where published; missing values fall back to Yahoo adjusted closes. |
| Latest full holdings per fund | SEC EDGAR Form **N-PORT-P** for the exact series. [`company_tickers_mf.json`](https://www.sec.gov/files/company_tickers_mf.json) supplies WisdomTree Trust CIK `1350487` plus exact series/class IDs; the series Atom feed resolves the newest non-amendment filing and the updater downloads the raw accession `.txt` payload. |
| BTCW holdings fallback | BTCW is present in the official catalog but has no SEC mutual-fund/ETF row in the current ticker map. The updater preserves the catalog fund and reads the issuer product page's displayed holdings table as an explicitly labeled top-holdings fallback. |
| Exchange tickers for N-PORT positions | SEC [`company_tickers.json`](https://www.sec.gov/files/company_tickers.json), matching normalized issuer names. Bonds, cash, futures and other positions without an exchange ticker retain `Ticker: "-"` and their CUSIP/ISIN identifier. |
| Daily history and distributions | Yahoo Finance public chart API (`/v8/finance/chart/{TICKER}?period1=0&period2=…&interval=1d&events=div%7Csplit&includeAdjustedClose=true`). Adjusted closes are used for derived returns; raw close, adjusted close, volume and dividend rows are kept in paginated JSON. |
| Catalog fallback | The previously published `api/wisdomtree/index.json`, so a temporary WisdomTree outage does not erase the static catalog. |

Each fund carries a `metrics` object and detailed `meta.json` that power the shared catalog/detail UI:

- `ytd`, `tr1y`, `cagr3y`, `cagr5y`, `cagr10y` and `siAnn` use official WisdomTree product-page Market Price Returns where published, with Yahoo adjusted market-price closes as a transparent fallback;
- `tr3y`, `tr5y` and `tr10y` are cumulative returns computed as `(1 + CAGR nY)^n − 1` from the annualized source figures;
- the fallback `siAnn` is the annualized adjusted-close return from the first available Yahoo observation;
- `dividendYield` is the trailing-12-month yield from the WisdomTree catalog when published, otherwise an explicitly labeled indicated yield based on the latest Yahoo distribution and inferred frequency;
- `secYield` comes from the official product page when that page publishes a 30-day SEC yield; otherwise it stays unavailable (`—`) with the reason recorded in metadata;
- `returns.derivedFrom` and `metrics.returnsBasis` distinguish official WisdomTree Market Price Returns from the Yahoo adjusted-close fallback; neither is mislabeled as a NAV total-return series.

### Known coverage and freshness limitations

- WisdomTree's official catalog snapshot is periodic. The generated feed records the source as-of date (`9/15/2026` in the checked-in snapshot) and converts the catalog's `Assets Under Mgmt $(000)` into dollars by multiplying by 1,000.
- SEC N-PORT-P is periodic and can lag the catalog/market date. Every holdings manifest records the accession and report period; it must not be read as an intraday holdings file.
- The SEC archive root `primary_doc.xml` is not assumed to contain positions. The updater parses the raw accession `.txt` payload, whose structured XML contains `genInfo`, `fundInfo` and `invstOrSec` sections.
- N-PORT filings commonly contain bonds, Treasury bills, cash, derivatives and other non-equity positions without an exchange ticker. The UI and Watchlist preserve these rows by identifier instead of discarding them.
- Official product pages provide current NAV, closing price and many SEC-yield/return fields; the updater records their individual as-of dates. Yahoo Finance remains the public fallback for daily history, distributions and any missing return values.
- BTCW's issuer fallback is a small displayed holdings table rather than a verified full N-PORT portfolio. Its `holdings.source` names that limitation.
- A fund with no current SEC or issuer rows can retain the previous generated sheet during a transient update failure; updater logs and metadata retain the previous source rather than silently claiming a fresh filing.

### Update controls

| Environment variable | Default | Meaning |
| --- | ---: | --- |
| `MAX_FETCHES` | `0` / all | Batch size. A positive value continues after the committed ticker cursor in `api/wisdomtree/update-state.json`; `0` is a full pass. |
| `REQUEST_SLEEP` | `1.5` | Minimum delay in seconds between request starts. SEC, WisdomTree and Yahoo endpoints should be used politely. |
| `CONCURRENCY` | `3` | Parallel fund workers. Request starts remain globally paced. |
| `AUM` | `:` | AUM range in dollars, `K/M/B/T` suffixes, or `nano`, `micro`, `small`, `mid`, `large`. |
| `TER` | `:` | Net expense-ratio range in percent, using strict `min:max` syntax. |
| `DIVIDEND_YIELD` | `:` | Catalog trailing-yield percentage range. |
| `PERFORMANCE_YTD` … `PERFORMANCE_10Y` | unset | Annualized adjusted-close return ranges. |
| `TOTAL_RETURN_YTD` … `TOTAL_RETURN_10Y` | unset | Cumulative adjusted-close return ranges. |
| `TICKERS` | all | Space-, comma- or semicolon-separated ticker allowlist, e.g. `USFR DGRW WCLD`. |
| `HOLDINGS_PAGE_SIZE` | `250` | Rows in each holdings JSON page. |
| `HISTORY_PAGE_SIZE` | `1000` | Rows in each history JSON page. |
| `HISTORY_RANGE` | `max` | Yahoo chart range (`max`, `10y`, `5y`, …). |
| `STORE_RAW_DOWNLOADS` | off | Store the raw official rendered catalog under `api/wisdomtree/raw`. SEC filing payloads are not committed by default. |
| `MAX_RETRIES` | `2` | Retries after the initial network/403/408/425/429/5xx request. |
| `EDGAR_FALLBACK` | on | Set `0` to omit SEC holdings resolution. |
| `SKIP_WISDOMTREE` | off | Keep the previously generated catalog and fund metadata. |
| `SKIP_YAHOO` | off | Keep previously generated history/distribution rows when possible. |

### Full passes and resuming bounded runs

Running the updater without filters refreshes all catalog rows in alphabetical ticker order and resets the saved cursor after a full pass. A positive `MAX_FETCHES` is a resumable batch, not a permanent first-page limit: repeated runs continue after the committed cursor and wrap around the catalog. A filter run publishes only the eligible result set; an unfiltered run preserves prior rows for a fund that fails transiently. During every run, the updater prints one `[progress] n/total TICKER updated` or `[progress] n/total TICKER not updated` line as each fund finishes.

All range variables use `min:max`; both bounds are inclusive and optional, but the colon is required (`15:`, `:0.5`, `0.1:0.5`, `:`). AUM presets use the same sibling convention: nano (< $10M), micro ($10M–$300M), small ($300M–$2B), mid ($2B–$10B), large (>$10B).

### Examples

```bash
MAX_FETCHES=10 bun ./scripts/update-data.ts
TICKERS="USFR DGRW BTCW" bun ./scripts/update-data.ts
AUM="1B:" TER=":0.30" bun ./scripts/update-data.ts
PERFORMANCE_3Y="5:" bun ./scripts/update-data.ts
SKIP_YAHOO=1 bun ./scripts/update-data.ts
```

## Uploading N-PORT files in the browser

The header toolbar includes the same integrated drag-and-drop upload as `daggerok/iShares` and `daggerok/Fidelity`, N-PORT flavored: drop or pick an N-PORT XML payload and the app parses it entirely in your browser — no network — merging the fund and its holdings into the catalog, detail tabs and Watchlist. Uploads live for the current browser session only.

## Developer notes

- `scripts/update-data.ts` — Bun updater with no runtime dependencies: WisdomTree catalog parser, SEC fund/series resolver, raw N-PORT XML parser, issuer fallback, Yahoo chart reader, derived metrics, strict range parsers, bounded-run cursor, retries and deterministic paginated writes.
- `scripts/update-data.test.ts` — Bun tests for range/AUM parsing, catalog parsing and $(000) conversion, SEC mapping and raw N-PORT parsing, Atom resolution, Yahoo chart/return helpers and distribution-frequency inference.
- `scripts/check-index.ts` — Bun transpile check for the inline browser TypeScript, preventing a syntax error from leaving the published catalog on its loading screen.
- `api/wisdomtree/**` — generated static feed: `index.json`, `funds/{TICKER}/meta.json`, paginated `holdings/` and `history/` files, and `update-state.json`.
- `index.html` — single-file TypeScript UI with inline styles and scripts, matching the sibling repositories' searchable catalog, persistent selection/blacklist, watchlist aggregation, detail tabs, exports and N-PORT upload workflow.
- The app keeps search and sort preferences in browser localStorage and reapplies them after reload. Sort order is remembered **per tab** and is **never reset by any button or checkbox**: sort All ETFs by *YTD Return*, round-trip through Watchlist or a fund detail tab, toggle select-all, search, blacklist, export, switch the theme or press **Clear** — the YTD Return order is still there. Like the checkbox selections, the remembered sorts live in browser localStorage (`wisdomtree-tab-sorts`) and are reapplied after reload. A tab that was never sorted keeps its default order (Watchlist: Weight Sum desc, Overview: Section asc, sheets: source order); **Clear** clears only the selection and the searches. To return to the default catalog order, click the *Ticker* header (asc).
- Verification before publishing: `bun test scripts/update-data.test.ts`, `bunx tsc --noEmit`, and a static-server smoke test.

## TypeScript

The browser app is intentionally single-file: `index.html` contains inline TypeScript compiled in the browser with Babel standalone, following the `daggerok/youtube` no-src-files approach used by the sibling applications.
