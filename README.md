# WisdomTree

One of the app's features lets you select WisdomTree ETFs in the Watchlist and aggregate their holdings to see how often each ticker appears across the selected funds. Repeated holdings make overlapping exposure visible: the more selected funds include a ticker, the greater its potential influence on the portfolio; gains in that holding may help, while declines may hurt, and actual impact also depends on each fund's position size.  Another feature makes it faster and easier to find funds with stronger growth over different periods, higher dividend yields or distributions, greater Total Return (price performance plus dividends), and other key performance metrics. A single-file client-side tool reading the generated `./api/wisdomtree` static feed (WisdomTree product pages - including official Market Price/NAV/Underlying Index returns and the official tax-character distributions table, SEC EDGAR N-PORT-P holdings, Yahoo Finance history with a narrow distributions/returns fallback) into a searchable ETF/asset-class catalog with per-fund tabs, watchlist, N-PORT upload, CSV/TXT export - the same look, feel, columns and business logic as the sibling applications.

## Using Bun

```bash
bunx degit daggerok/WisdomTree#main ./12345 && cd $_
bunx serve . -p 1234
open http://0:1234
```

The published application is available at <https://daggerok.github.io/WisdomTree/>.

### Column types and filters

Every column of the ETF catalog and of the Watchlist, Holdings, History and Distributions tabs has a type: text (`ABC`), number (`123`), percentage (`%`), money (`$`), date (`D`), date and time (`DT`) or time of day (`T`). The type is detected from the texts the column shows (80% of the filled cells must agree, otherwise text) and is written in the badge next to the column title: click it to cycle the type, Shift+click to return to auto-detection. Dates are read as `2024-06-15`, `6/15/2024`, `15.06.2024`, `Jun 15, 2024` or `15-Jun-2024`, date and time as `2024-06-15T09:30:00Z` or `2024-06-15 09:30`, time as `09:30`, `16:00:00` or `9:30 PM`

A row of filter inputs sits under the column headers (the `Filters` button hides it, `Clear filters` empties it). Filters of different columns are combined with AND, the search box applies on top, and Copy Tickers and the exports use the filtered rows. Filters and type overrides are remembered in the browser

Inside one filter: a space means AND, a comma means OR, a leading `!` means NOT, `?` matches an empty or unavailable value and `!?` a value that is there; a value that is unavailable matches only `?` and negated conditions. An unquoted space ends the value, so quote values that contain one (`>="2024-06-15 09:30"`)

| Type | Examples |
| --- | --- |
| Text | `bank` contains, `"two words"`, `!bank`, `=exact`, `^starts`, `ends$`, `/regex/`, `tech, health` |
| Number, percentage, money | `>10`, `>=10 <50`, `=22` (matches what rounds to 22), `!=22`, `10..50`, `..50`, `10..`, `>1B` and `K` `M` `B` `T` suffixes, an optional `$` or `%` |
| Date, date and time | `>2024-06-01`, `2024` (the whole year), `2024-06` (the whole month), `2024-01..2024-06`, `today`, `yesterday`, `-7d..` (the last 7 days), `+2w`, `-3m`, `-1y` |
| Time | `>09:30`, `09:30..16:00`, `=12:00` (the whole minute) |

The `Columns` menu next to `Filters` lists every column of the ETF table from the first to the last, all of them shown by default, with a search box and the `All`, `Clear`, `Toggle` and `Reset` buttons. `Use` and `Ticker` are listed but locked. Hiding a column only removes it from the table: the filters, the sorting, the exports and Copy Tickers still use it. The choice is remembered in the browser (localStorage, never the data) and the menu is shown on the ETF catalog only

## Updating the static WisdomTree data

Run the updater with Bun:

```bash
bun scripts/update-data.ts
```

Run `bun scripts/update-data.ts -h` (or `--help`) to print every control with its default and usage examples.

Defaults live in `scripts/update-data.config.json`. Precedence: file defaults < `advanced` JSON < nonblank workflow inputs < protected Actions variable or environment variable. A blank input inherits the file value, and the CLI and the **Update WisdomTree ETF data** workflow share one resolver (`resolveControls` in `scripts/update-data.ts`). The workflow exposes 24 controls as individual inputs; every other control (`HOLDINGS_PAGE_SIZE`, `STORE_RAW_DOWNLOADS`, `SEC_UA`, `VERBOSE`, `USE_SYSTEM_CA`) is reachable through the `advanced` JSON input, for example `{"STORE_RAW_DOWNLOADS":"true"}`. An explicitly set environment variable always wins, even when empty. The protected `SEC_UA` repository Actions variable overrides the SEC contact when nonblank. Output is always written to `api/wisdomtree`. All supplied filters use **AND** logic.

### Data sources

| Block | Source |
| --- | --- |
| Catalog (all US WisdomTree ETFs) | `https://www.wisdomtree.com/investments` (WisdomTree product table) |
| Holdings per fund | SEC EDGAR N-PORT-P `primary_doc.xml` (WisdomTree Trust CIK 0001350487) |
| Per-fund returns, distributions | WisdomTree product page's "Total Returns" table (Market Price/NAV/Underlying Index rows) and "Recent Distributions" table (ex/record/payable date + Ordinary Income/ST/LT Cap Gains/Return of Capital) - the primary source for both |
| Daily history; returns/distributions fallback | Yahoo Finance chart API for daily history unconditionally, and as fallback for Market Price Returns tenors and distribution ex-dates the official page doesn't cover |
| Fallback | WisdomTree product pages for NAV, expense ratio, yields |
| Access path | wisdomtree.com is Cloudflare-protected. Each page is tried directly once (a block latches for the rest of the run), then through the read-only r.jina.ai rendering: one global gate (at least 3.2 s between starts), at most one retry, and a verification page counts as a failure. Only the SEC receives the `SEC_UA` contact; other hosts get a generic User-Agent |

### Metrics and caveats

Each fund carries a derived `metrics` object that powers the catalog columns shared with the sibling sites:

- `ytd` / `tr1y` - official YTD and 1-year returns -> *YTD Return*, *TR 1Y*
- `cagr3y` / `cagr5y` / `cagr10y` - published annualized 3Y/5Y/10Y figures -> *CAGR 3Y/5Y/10Y*
- `tr3y` / `tr5y` / `tr10y` - cumulative 3Y/5Y/10Y figures `(1 + CAGR)^n - 1` -> *TR 3Y/5Y/10Y*
- `siAnn` - since-inception annualized -> *SI Ann.*; derived only for funds with at least one year of history
- `dividendYield` - 12-month trailing yield or indicated yield (latest distribution x frequency / price); a catalog 0.00% is the provider's published value and is kept as published (`yields.dividendYieldKind` says so)
- `dividendYieldBasis` - code of the definition behind `dividendYield`, `null` exactly when `dividendYield` is `null`; it travels with the yield (a retained yield keeps its code):

  | Code | Meaning for WisdomTree |
  | --- | --- |
  | `official-trailing-12m` | trailing 12-month yield published in the WisdomTree product catalog (a published 0.00% included) |
  | `indicated` | updater estimate: latest distribution x inferred payments per year / market price, used when the catalog has no yield |

  The codes `official-distribution-rate`, `official-other` and `computed-trailing-12m` of the shared standard are not produced by this updater
- `secYield` - 30-day SEC yield when published; unavailable values stay empty and are never shown as 0
- `returnsBasis` - mandatory non-empty text saying how the returns were computed: official WisdomTree month-end Market Price Returns (gaps filled with Yahoo estimates), or estimates derived from Yahoo adjusted closes when the product page is unavailable
- `performanceAsOf` - mandatory ISO `YYYY-MM-DD` date the returns are as of: the WisdomTree month-end performance table date, or the last Yahoo close date when derived (not the NAV date); `null` only when truly unknown
- NAV and the catalog figures come from WisdomTree; history and returns derived from Yahoo adjusted closes are market-price estimates, not official NAV returns
- When the product page cannot be fetched, the previous official returns, quarter-end returns, distributions table, NAV, market price and premium/discount are kept together as one unit (with their own dates and basis); they are never replaced by Yahoo estimates or mixed with a fresh price. `meta.json` `source.productPageStatus` says which case applied. A page that is fetched but publishes no quarter-end table leaves quarter-end empty (`asOfDate` `—`)
- A product page that loads only partly (the r.jina.ai rendering proxy sometimes drops sections) counts as a failed read of the missing sections: the page is complete only when it has the pricing tables (NAV, Closing Market Price) and the Total Returns section. Each missing section (NAV/price/premium, returns with `performanceAsOf` and `returnsBasis`, distributions with the tax breakdown) keeps the previous official values as one unit and a `[ kept ]` line is printed with `VERBOSE`; a fully loaded page that lacks a field gives an honest `null`, never a refill from the previous run
- Expense ratio: `terValue` is the net expense ratio (after waivers), `terGrossValue` the gross ratio from the catalog; both are `null` when unknown
- `isin` is derived from the CUSIP (US prefix plus check digit) because the pages do not publish it; `cusip` stays empty for the few funds whose page lacks it, and `exchange` comes from Yahoo and stays empty when Yahoo is unavailable
- A limited `HISTORY_RANGE` shortens the published history, so long-tenor figures derived from Yahoo are unavailable for ranges shorter than the tenor

### Update controls

Every control is a key in `scripts/update-data.config.json`; values are strings.

| Control | Default | Meaning |
| --- | --: | --- |
| `MAX_FETCHES` | `0` | Batch size over the funds that pass `TICKERS`/`AUM`/`TER`/`DIVIDEND_YIELD`: with a positive value the updater continues after the committed cursor in `api/wisdomtree/update-state.json` (in ticker order, wrapping around; the cursor moves past every fund taken, whatever its outcome); `0` is a full pass. A `TICKERS` run never touches the cursor. |
| `REQUEST_SLEEP` | `2` | Minimum delay in seconds between outgoing request starts, including retries. |
| `CONCURRENCY` | `2` | Number of parallel fund update workers, each with its own request pacing lane. |
| `AUM` | `:` | Net Assets range. Each bound may be a USD amount or `K`/`M`/`B`/`T`, or one of `nano`, `micro`, `small`, `mid`, `large`. |
| `TER` | `:` | Expense ratio range in % (strict `min:max`). |
| `DIVIDEND_YIELD` | `:` | Dividend-yield percentage range. |
| `SEC_YIELD` | `:` | 30-day SEC yield percentage range (strict `min:max`), read from the product page; funds without a published SEC yield do not match. |
| `TICKERS` | empty (all) | Space-, comma- or semicolon-separated ticker allowlist, e.g. `DGRW USFR WCLD`. |
| `HOLDINGS_PAGE_SIZE` | `250` | Rows in each generated current-holdings JSON page. |
| `HISTORY_PAGE_SIZE` | `1000` | Rows in each generated daily-history JSON page. |
| `MAX_RETRIES` | `2` | Retries after the initial request (integer, at least 1). Network errors and HTTP 403/408/425/429/5xx are retried with exponential backoff. |
| `HISTORY_RANGE` | `max` | Yahoo history window: `max` or a whole number of years such as `5y`; sent as explicit `period1`/`period2` (Yahoo ignores `range` when `period1=0`). Anything else is an error. |
| `STORE_RAW_DOWNLOADS` | `false` | Store the rendered official catalog under `data/raw/` (outside `api/wisdomtree`, so the workflow never commits it). |
| `EDGAR_FALLBACK` | `true` | Use SEC EDGAR Form N-PORT-P for full holdings. |
| `SKIP_YAHOO` | `false` | Keep previous history and distributions while refreshing catalog and holdings. |
| `SKIP_WISDOMTREE` | `false` | Keep the previously published official catalog. |
| `SEC_UA` | `daggerok ETF feed daggerok@gmail.com` | User-Agent for SEC requests only (other hosts get a generic agent). SEC policy asks automated tools to declare a contact; the protected `SEC_UA` Actions variable overrides the default. Redacted in logs. |
| `VERBOSE` | `false` | Print per-fund retry and fallback notices. |
| `USE_SYSTEM_CA` | `auto` | TLS trust store: `auto` restarts the updater once with Bun's `--use-system-ca` when a request fails with an untrusted-certificate error; `true` always uses the system CA store; `false` never restarts. Not an individual workflow input: use `advanced`, the config file or the CLI environment. |
| `PERFORMANCE_YTD` / `_1Y` / `_3Y` / `_5Y` / `_10Y` | `:` | Annualized adjusted-close return range per tenor: `min:max`. |
| `TOTAL_RETURN_YTD` / `_1Y` / `_3Y` / `_5Y` / `_10Y` | `:` | Cumulative adjusted-close return range per tenor: `min:max`. |

Environment aliases: `WISDOMTREE_<NAME>` (for example `WISDOMTREE_CONCURRENCY`) and `HISTORICAL_PAGE_SIZE` (for `HISTORY_PAGE_SIZE`) work in the environment layer, the same layer as the plain name; when several are set the plain name wins, then `WISDOMTREE_<NAME>`, then the legacy alias. They are validated exactly like the plain names.

Unknown `TICKERS` are an error. Return filters (`PERFORMANCE_*`, `TOTAL_RETURN_*`) exclude funds whose value for a bounded range is unavailable. The run takes no new fund after 25 minutes and still writes the index; it exits non-zero when every fund failed or no fund got data from a live source. A rerun with identical upstream data changes no file. When the live catalog adds or drops funds the run prints `NEW FUNDS: ...` or `DROPPED FUNDS: ...` (also in the Actions step summary); dropped funds keep their published data. Files are written through a temp file and a rename, pages first, then `meta.json`, with stale pages removed afterwards.

`TICKERS` combines with the AUM, TER, yield and return filters using AND logic; it does not override them. Filtered or bounded runs (`TICKERS`, `MAX_FETCHES`, filters, `SKIP_WISDOMTREE`) and runs where the live catalog could not be read never shrink the feed: funds that were not refreshed keep their published row and files, and `index.json` always lists every known fund (the published index plus every `funds/*/meta.json`).

### Examples

```bash
MAX_FETCHES=10 ./scripts/update-data.ts
TICKERS="DGRW USFR WCLD" ./scripts/update-data.ts
AUM="1B:" TER=":0.5" ./scripts/update-data.ts
HISTORY_RANGE=5y SEC_YIELD="3:" ./scripts/update-data.ts
PERFORMANCE_1Y="15:" ./scripts/update-data.ts
```

## TypeScript and verification

The browser app is intentionally build-free: `index.html` carries the markup, styles and bootstrap, and `app.tsx` is TypeScript compiled in the browser with Babel standalone - no build step, no bundler, no `tsconfig.json` needed. Bun runs TypeScript out of the box.

Verification before every publish:

```bash
bun install --frozen-lockfile
bun test
bun build --target=bun scripts/update-data.ts --outfile=/dev/null
git diff --check
```

`bun test` (`scripts/update-data.test.ts`) also covers the config file, `--help`, README controls table and workflow shape.

## Brands table

| Brand | Where to get the data |
| --- | --- |
| **AAM** | [aamlive.com](https://www.aamlive.com/ETF) \| [AAM](https://daggerok.github.io/AAM/) |
| **abrdn (Aberdeen)** | [aberdeeninvestments.com](https://www.aberdeeninvestments.com/en-us/investor/funds/etfs) \| [aberdeen](https://daggerok.github.io/aberdeen/) |
| **Amplify** | [amplifyetfs.com](https://amplifyetfs.com/) \| [Amplify](https://daggerok.github.io/Amplify/) |
| **ARK Invest** | [ark-funds.com](https://www.ark-funds.com/our-etfs/) \| [ARK](https://daggerok.github.io/ARK/) |
| **Capital Group** | [capitalgroup.com](https://www.capitalgroup.com/advisor/investments/exchange-traded-funds.html) \| [Capital-Group](https://daggerok.github.io/Capital-Group/) |
| **Fidelity** | [fidelity.com](https://www.fidelity.com/etfs) \| [Fidelity](https://daggerok.github.io/Fidelity/) |
| **First Trust** | [ftportfolios.com](https://www.ftportfolios.com/Retail/etf/etflist.aspx) \| [First-Trust](https://daggerok.github.io/First-Trust/) |
| **Franklin Templeton** | [franklintempleton.com](https://www.franklintempleton.com/investments/options/exchange-traded-funds) \| [Franklin](https://daggerok.github.io/Franklin/) |
| **Global X** | [globalxetfs.com/explore](https://www.globalxetfs.com/explore) \| [Global-X](https://daggerok.github.io/Global-X/) |
| **Goldman Sachs** | [am.gs.com](https://am.gs.com/en-us/individual/funds?locale=en-us&audience=individual&sf=funds&filters=funds%7CETF&limit=100) \| [Goldman-Sachs](https://daggerok.github.io/Goldman-Sachs/) |
| **Invesco** | [invesco.com](https://www.invesco.com/us/en/financial-products/etfs.html) \| [Invesco](https://daggerok.github.io/Invesco/) |
| **iShares** | [ishares.com](https://www.ishares.com/) \| [iShares](https://daggerok.github.io/iShares/) |
| **JPMorgan** | [am.jpmorgan.com](https://am.jpmorgan.com/us/en/asset-management/adv/products/fund-explorer/etf) \| [JPMorgan](https://daggerok.github.io/JPMorgan/) |
| **NEOS** | [neosfunds.com](https://neosfunds.com/#explore-etfs) \| [Neos](https://daggerok.github.io/Neos/) |
| **Northern Trust** | [etfs.ntam.northerntrust.com](https://etfs.ntam.northerntrust.com/us/en/individual/funds) \| [Northern-Trust](https://daggerok.github.io/Northern-Trust/) |
| **Pacer ETFs** | [paceretfs.com](https://www.paceretfs.com/products/) \| [Pacer](https://daggerok.github.io/Pacer/) |
| **Parametric** | [eatonvance.com](https://www.eatonvance.com/products/etfs.html) \| [Parametric](https://daggerok.github.io/Parametric/) |
| **ProShares** | [proshares.com](https://www.proshares.com/our-etfs/find-proshares-etfs) \| [ProShares](https://daggerok.github.io/ProShares/) |
| **Schwab** | [schwabassetmanagement.com](https://www.schwabassetmanagement.com/products) \| [Schwab](https://daggerok.github.io/Schwab/) |
| **SP Funds** | [sp-funds.com](https://www.sp-funds.com/) \| [SP-Funds](https://daggerok.github.io/SP-Funds/) |
| **SPDR** | [ssga.com](https://www.ssga.com/us/en/intermediary/etfs/fund-finder) \| [SPDR](https://daggerok.github.io/SPDR/) |
| **Sprott ETFs** | [sprottetfs.com](https://sprottetfs.com/) \| [Sprott](https://daggerok.github.io/Sprott/) |
| **Tema ETFs** | [temaetfs.com](https://temaetfs.com/funds) \| [Tema](https://daggerok.github.io/Tema/) |
| **Themes ETFs** | [themesetfs.com/etfs](https://themesetfs.com/etfs) \| [Themes](https://daggerok.github.io/Themes/) |
| **VanEck** | [vaneck.com](https://www.vaneck.com/us/en/etf-mutual-fund-finder/) \| [VanEck](https://daggerok.github.io/VanEck/) |
| **Vanguard** | [investor.vanguard.com](https://investor.vanguard.com/etf/list) \| [Vanguard](https://daggerok.github.io/Vanguard/) |
| **VictoryShares** | [vcm.com VictoryShares ETFs](https://www.vcm.com/products/victoryshares-etfs/victoryshares-etfs-list) \| [VictoryShares](https://daggerok.github.io/VictoryShares/) |
| **WisdomTree** | [wisdomtree.com](https://www.wisdomtree.com/investments) \| [WisdomTree](https://daggerok.github.io/WisdomTree/) |
| **Xtrackers** | [etf.dws.com](https://etf.dws.com/en-us/etf-products/) \| [Xtrackers](https://daggerok.github.io/Xtrackers/) |

## Sibling applications

| Application | Data provider | Repository |
| --- | --- | --- |
| AAM | Official AAM catalog/detail HTML + full holdings XLS + SEC N-PORT holdings fallback + Yahoo market history/dividends | [AAM](https://github.com/daggerok/AAM) |
| abrdn (Aberdeen) | Official Aberdeen gateway + SEC N-PORT holdings fallback + Yahoo history/dividends | [aberdeen](https://github.com/daggerok/aberdeen) |
| Amplify | Amplify ETFs Firestore data feed + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [Amplify](https://github.com/daggerok/Amplify) |
| ARK Invest | ark-funds.com fund pages + overview/NAV-history/performance JSON + official daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance distributions/history fallback | [ARK](https://github.com/daggerok/ARK) |
| Capital Group | Official Capital Group fund data + SEC N-PORT holdings fallback + Yahoo history fallback | [Capital-Group](https://github.com/daggerok/Capital-Group) |
| Fidelity | SEC EDGAR N-PORT-P + Yahoo Finance | [Fidelity](https://github.com/daggerok/Fidelity) |
| First Trust | ftportfolios.com official ETF list + fund summary, holdings, distribution and price-history export pages + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history fallback | [First-Trust](https://github.com/daggerok/First-Trust) |
| Franklin Templeton | franklintempleton.com ETF listings + product pages + SEC EDGAR N-PORT-P | [Franklin](https://github.com/daggerok/Franklin) |
| Global X | globalxetfs.com Next.js catalog and fund pages + dated full-holdings CSV | [Global-X](https://github.com/daggerok/Global-X) |
| Goldman Sachs | am.gs.com fund finder + detail pages + SEC EDGAR N-PORT-P | [Goldman-Sachs](https://github.com/daggerok/Goldman-Sachs) |
| Invesco | invesco.com fund pages and sitemap + official Invesco fund API (monthly returns, NAV, AUM, yields, daily holdings, expense ratio) + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [Invesco](https://github.com/daggerok/Invesco) |
| iShares | iShares (BlackRock) product workbooks | [iShares](https://github.com/daggerok/iShares) |
| JPMorgan | am.jpmorgan.com fund explorer + product-data JSON | [JPMorgan](https://github.com/daggerok/JPMorgan) |
| NEOS | neosfunds.com lineup table + official fund pages + daily holdings CSV | [Neos](https://github.com/daggerok/Neos) |
| Northern Trust | etfs.ntam.northerntrust.com funds list + per-fund CSV/JSON downloads | [Northern-Trust](https://github.com/daggerok/Northern-Trust) |
| Pacer ETFs | paceretfs.com product catalog and fund pages (Cloudflare WAF; r.jina.ai proxy fallback) + SEC EDGAR N-PORT-P (Pacer Funds Trust) + Yahoo Finance history/dividends | [Pacer](https://github.com/daggerok/Pacer) |
| Parametric | eatonvance.com ETF catalog and Parametric product pages + SEC EDGAR N-PORT-P holdings + Yahoo Finance history/dividends | [Parametric](https://github.com/daggerok/Parametric) |
| ProShares | proshares.com ETF finder + fund pages + official data host | [ProShares](https://github.com/daggerok/ProShares) |
| Schwab | schwabassetmanagement.com product pages + CSV exports | [Schwab](https://github.com/daggerok/Schwab) |
| SP Funds | sp-funds.com homepage catalog, fund pages and daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [SP-Funds](https://github.com/daggerok/SP-Funds) |
| SPDR | SSGA / State Street public feeds | [SPDR](https://github.com/daggerok/SPDR) |
| Sprott ETFs | sprottetfs.com fund pages + SEC EDGAR N-PORT-P (Sprott Funds Trust) + Yahoo Finance history/dividends | [Sprott](https://github.com/daggerok/Sprott) |
| Tema ETFs | Tema official fund pages + dated daily holdings CSV; SEC EDGAR N-PORT-P holdings fallback only + Yahoo Finance price/history/dividend fallback | [Tema](https://github.com/daggerok/Tema) |
| Themes ETFs | themesetfs.com catalog + daily holdings CSV + Yahoo Finance history/dividends + SEC N-PORT-P holdings fallback | [Themes](https://github.com/daggerok/Themes) |
| VanEck | vaneck.com ETF finder + product pages | [VanEck](https://github.com/daggerok/VanEck) |
| Vanguard | Vanguard product pages + SEC EDGAR N-PORT-P | [Vanguard](https://github.com/daggerok/Vanguard) |
| VictoryShares | VCM VictoryShares catalog and product JSON + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance adjusted-market-price history | [VictoryShares](https://github.com/daggerok/VictoryShares) |
| WisdomTree | WisdomTree product table + SEC EDGAR N-PORT-P + Yahoo Finance | [WisdomTree](https://github.com/daggerok/WisdomTree) |
| Xtrackers | Official DWS catalog/US sitemap + PDP/XLSX + SEC N-PORT-P holdings fallback + Yahoo Finance daily prices/history/dividends | [Xtrackers](https://github.com/daggerok/Xtrackers) |

## License

[MIT - same as all sibling ETF repositories.](./LICENSE)

WisdomTree® and the fund names/tickers referenced here are trademarks of WisdomTree, Inc. This is an independent, unofficial tool; it is not affiliated with, endorsed by, or sponsored by WisdomTree. All data is reproduced from WisdomTree's own public product pages, public SEC EDGAR filings and Yahoo Finance for research purposes. All other trademarks, including index names, are the property of their respective owners.
