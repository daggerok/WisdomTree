# WisdomTree

WisdomTree ETF holdings to Watchlist. A single-file client-side tool reading the generated `./api/wisdomtree` static feed (WisdomTree product pages — including official Market Price/NAV/Underlying Index returns and the official tax-character distributions table, SEC EDGAR N-PORT-P holdings, Yahoo Finance history with a narrow distributions/returns fallback) into a searchable ETF/asset-class catalog with per-fund tabs, watchlist, N-PORT upload, CSV/TXT export — the same look, feel, columns and business logic as the sibling applications.

## Using Bun

```bash
bunx degit daggerok/WisdomTree#main ./12345 && cd $_
bunx serve . -p 1234
open http://0:1234
```

The published application is available at <https://daggerok.github.io/WisdomTree/>.

## Updating the static WisdomTree data

Run the updater with Bun:

```bash
bun test scripts/update-data.test.ts
./scripts/update-data.ts
```

Run `./scripts/update-data.ts -h` (or `--help`) to print every configuration variable with its default and usage examples.

The **Update WisdomTree ETF data** GitHub Actions workflow exposes the same settings as manual inputs. All supplied filters use **AND** logic.

### Data sources

| Block | Source |
| --- | --- |
| Catalog (all US WisdomTree ETFs) | `https://www.wisdomtree.com/investments` (WisdomTree product table) |
| Holdings per fund | SEC EDGAR N-PORT-P `primary_doc.xml` (WisdomTree Trust CIK 0001350487) |
| Per-fund returns, distributions | WisdomTree product page's "Total Returns" table (Market Price/NAV/Underlying Index rows) and "Recent Distributions" table (ex/record/payable date + Ordinary Income/ST/LT Cap Gains/Return of Capital) — the primary source for both |
| Daily history; returns/distributions fallback | Yahoo Finance chart API for daily history unconditionally, and as fallback for Market Price Returns tenors and distribution ex-dates the official page doesn't cover |
| Fallback | WisdomTree product pages for NAV, expense ratio, yields |

Each fund carries a derived `metrics` object that powers the catalog columns shared with the sibling sites:

- `ytd` / `tr1y` — official YTD and 1-year returns → *YTD Return*, *TR 1Y*
- `cagr3y` / `cagr5y` / `cagr10y` — published annualized 3Y/5Y/10Y figures → *CAGR 3Y/5Y/10Y*
- `tr3y` / `tr5y` / `tr10y` — cumulative 3Y/5Y/10Y figures `(1 + CAGR)^n - 1` → *TR 3Y/5Y/10Y*
- `siAnn` — since-inception annualized → *SI Ann.*
- `dividendYield` — 12-month trailing yield or indicated yield (latest distribution × frequency ÷ price)
- `secYield` — 30-day SEC yield when published; `—` otherwise

### Update controls

| Environment variable | Default | Meaning |
| --- | --: | --- |
| `MAX_FETCHES` | all | Batch size: with a positive value the updater continues after the committed cursor in `api/wisdomtree/update-state.json`; empty or `0` is a full pass — every fund is refreshed in one run. |
| `REQUEST_SLEEP` | `1` | Minimum delay in seconds between outgoing request starts, including retries. |
| `CONCURRENCY` | `2` | Number of parallel fund update workers. Request starts are still globally spaced by `REQUEST_SLEEP`. |
| `AUM` | `:` | Net Assets range. Each bound may be a USD amount or `K`/`M`/`B`/`T`, or one of `nano`, `micro`, `small`, `mid`, `large`. |
| `TER` | `:` | Expense ratio range in % (strict `min:max`). |
| `DIVIDEND_YIELD` | `:` | Dividend-yield percentage range. |
| `TICKERS` | all | Space-, comma- or semicolon-separated ticker allowlist, e.g. `DGRW USFR WCLD`. |
| `HOLDINGS_PAGE_SIZE` | `250` | Rows in each generated current-holdings JSON page. |
| `HISTORY_PAGE_SIZE` | `1000` | Rows in each generated daily-history JSON page. |
| `MAX_RETRIES` | `2` | Retries after the initial request. Only network errors and HTTP 408/425/429/5xx are retried with exponential backoff. |
| `SEC_UA` | declared UA | Override the SEC User-Agent. SEC policy requires automated tools to declare a contact. |
| `SKIP_YAHOO` | off | Skip Yahoo Finance history updates. |

`TICKERS` combines with AUM, TER, yield filters using AND logic; it does not override them. Funds not selected for a successful update keep their prior published metadata and data files.

### Examples

```bash
MAX_FETCHES=10 ./scripts/update-data.ts
TICKERS="DGRW USFR WCLD" ./scripts/update-data.ts
AUM="1B:" TER=":0.5" ./scripts/update-data.ts
PERFORMANCE_1Y="15:" ./scripts/update-data.ts
```

## TypeScript

The browser app is intentionally build-free: `index.html` carries the markup, styles and bootstrap, and `app.tsx` is TypeScript compiled in the browser with Babel standalone — no build step, no bundler, no `tsconfig.json` needed. Bun runs TypeScript out of the box.

Verification before every publish: `bun install --frozen-lockfile`, `bun test`, and `git diff --check`.

## Brands table

| Brand | Where to get the data |
| --- | --- |
| **VanEck** | [vaneck.com](https://www.vaneck.com/us/en/etf-mutual-fund-finder/) \| [VanEck](https://daggerok.github.io/VanEck/) |
| **JPMorgan** | [am.jpmorgan.com](https://am.jpmorgan.com/us/en/asset-management/adv/products/fund-explorer/etf) \| [JPMorgan](https://daggerok.github.io/JPMorgan/) |
| **Schwab** | [schwabassetmanagement.com](https://www.schwabassetmanagement.com/products) \| [Schwab](https://daggerok.github.io/Schwab/) |
| **Invesco** | [invesco.com](https://www.invesco.com/us/en/financial-products/etfs.html) \| [Invesco](https://daggerok.github.io/Invesco/) |
| **iShares** | [ishares.com](https://www.ishares.com/) \| [iShares](https://daggerok.github.io/iShares/) |
| **Fidelity** | [fidelity.com](https://www.fidelity.com/etfs) \| [Fidelity](https://daggerok.github.io/Fidelity/) |
| **Amplify** | [amplifyetfs.com](https://amplifyetfs.com/) \| [Amplify](https://daggerok.github.io/Amplify/) |
| **Vanguard** | [investor.vanguard.com](https://investor.vanguard.com/etf/list) \| [Vanguard](https://daggerok.github.io/Vanguard/) |
| **SPDR** | [ssga.com](https://www.ssga.com/us/en/intermediary/etfs/fund-finder) \| [SPDR](https://daggerok.github.io/SPDR/) |
| **WisdomTree** | [wisdomtree.com](https://www.wisdomtree.com/investments) \| [WisdomTree](https://daggerok.github.io/WisdomTree/) |
| **Goldman Sachs** | [am.gs.com](https://am.gs.com/en-us/individual/funds?locale=en-us&audience=individual&sf=funds&filters=funds%7CETF&limit=100) \| [Goldman-Sachs](https://daggerok.github.io/Goldman-Sachs/) |
| **NEOS** | [neosfunds.com](https://neosfunds.com/#explore-etfs) \| [Neos](https://daggerok.github.io/Neos/) |
| **ProShares** | [proshares.com](https://www.proshares.com/our-etfs/find-proshares-etfs) \| [ProShares](https://daggerok.github.io/ProShares/) |
| **Franklin Templeton** | [franklintempleton.com](https://www.franklintempleton.com/investments/options/exchange-traded-funds) \| [Franklin](https://daggerok.github.io/Franklin/) |

## Sibling applications

| Application | Data provider | Repository |
| --- | --- | --- |
| VanEck | vaneck.com ETF finder + product pages | [VanEck](https://github.com/daggerok/VanEck) |
| JPMorgan | am.jpmorgan.com fund explorer + product-data JSON | [JPMorgan](https://github.com/daggerok/JPMorgan) |
| Schwab | schwabassetmanagement.com product pages + CSV exports | [Schwab](https://github.com/daggerok/Schwab) |
| Invesco | invesco.com CSV downloads + Yahoo Finance | [Invesco](https://github.com/daggerok/Invesco) |
| iShares | iShares (BlackRock) product workbooks | [iShares](https://github.com/daggerok/iShares) |
| Fidelity | SEC EDGAR N-PORT-P + Yahoo Finance | [Fidelity](https://github.com/daggerok/Fidelity) |
| Amplify | Amplify ETFs (Firestore data feed) | [Amplify](https://github.com/daggerok/Amplify) |
| Vanguard | Vanguard product pages + SEC EDGAR N-PORT-P | [Vanguard](https://github.com/daggerok/Vanguard) |
| SPDR | SSGA / State Street public feeds | [SPDR](https://github.com/daggerok/SPDR) |
| WisdomTree | WisdomTree product table + SEC EDGAR N-PORT-P + Yahoo Finance | [WisdomTree](https://github.com/daggerok/WisdomTree) |
| Goldman Sachs | am.gs.com fund finder + detail pages + SEC EDGAR N-PORT-P | [Goldman-Sachs](https://github.com/daggerok/Goldman-Sachs) |
| NEOS | neosfunds.com lineup table + official fund pages + daily holdings CSV | [Neos](https://github.com/daggerok/Neos) |
| ProShares | proshares.com ETF finder + fund pages + official data host | [ProShares](https://github.com/daggerok/ProShares) |
| Franklin Templeton | franklintempleton.com ETF listings + product pages + SEC EDGAR N-PORT-P | [Franklin](https://github.com/daggerok/Franklin) |

## License

[MIT — same as all sibling ETF repositories.](./LICENSE)

WisdomTree® and the fund names/tickers referenced here are trademarks of WisdomTree, Inc. This is an independent, unofficial tool; it is not affiliated with, endorsed by, or sponsored by WisdomTree. All data is reproduced from WisdomTree's own public product pages, public SEC EDGAR filings and Yahoo Finance for research purposes. All other trademarks, including index names, are the property of their respective owners.
