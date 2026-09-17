# WisdomTree static ETF data plan

## Scope

Build a reproducible static feed for the 94 U.S.-listed rows in the official WisdomTree product table at <https://www.wisdomtree.com/us/products>. The browser site must not depend on a live provider API: `index.html` reads `api/wisdomtree/index.json`, `funds/{TICKER}/meta.json`, and paginated sheet files.

The checked-in catalog snapshot was rendered from the official product page on September 15, 2026. The table contains ticker, product name, asset class/category, inception date, gross and net expense ratio, AUM in `$(000)`, TTM yield, volume and related display fields. AUM is multiplied by 1,000 and the source/as-of date remains in metadata.

## Source resolution

### Catalog

1. Request `https://www.wisdomtree.com/us/products` directly.
2. If Cloudflare blocks the non-browser request, request the read-only rendering of that same official URL at `https://r.jina.ai/http://www.wisdomtree.com/us/products`.
3. Parse the Markdown product table by header, not by a fixed row number.
4. Keep the official product URL, category path and source date on every catalog row.

Direct WisdomTree API routes and guessed downloads were not used: they are Cloudflare-protected and/or disallowed by `robots.txt`. The Jina URL is only a rendering fallback for the official catalog page, not a third-party holdings source.

### Per-fund product page

Each catalog row links to an official WisdomTree product page. The updater reads the page's rendered product overview for the full fund name, CUSIP, net expense ratio, current NAV, closing market price, premium/discount, distribution yield, 30-day SEC yield and the official month-end/quarter-end Market Price Returns table. The page's individual as-of dates are kept in `meta.json`. If a product page is temporarily unavailable, the catalog and Yahoo/SEC values remain usable.

### Holdings

WisdomTree Trust uses registrant CIK `1350487`. The SEC mutual-fund/ETF map at <https://www.sec.gov/files/company_tickers_mf.json> currently maps 93 of the 94 catalog symbols to exact `seriesId` and `classId` values. `BTCW` is not represented in that map.

For each mapped ticker:

1. request the exact series Atom feed with `CIK=S{seriesId}&type=NPORT-P`;
2. select the newest non-amendment `NPORT-P` entry;
3. construct the archive URL from its accession;
4. download the raw accession text at:

   `https://www.sec.gov/Archives/edgar/data/{numeric-cik}/{accession-without-dashes}/{accession}.txt`

The raw `.txt` is important. For the sampled USFR filing, the archive root `primary_doc.xml` contained only an EDGAR submission header, while the raw submission held the structured `<genInfo>`, `<fundInfo>`, `<invstOrSecs>` and `<invstOrSec>` XML sections.

The parser stores name, ticker when SEC issuer-name matching resolves one, CUSIP/ISIN identifier, percentage value, market value, balance, asset category, and debt coupon/maturity when present. It records the accession and report period in `holdings.source`, and does not label periodic N-PORT data as current intraday holdings.

For BTCW, the updater reads the official WisdomTree product page through the same read-only renderer and stores the displayed holdings table as an explicitly labeled issuer top-holdings fallback. It does not invent a full N-PORT portfolio.

### Market data

Yahoo Finance's public chart endpoint supplies daily raw close, adjusted close, volume, listing date, exchange name and dividend events. The updater uses official WisdomTree Market Price Returns when the product page publishes them, then fills missing periods with Yahoo adjusted market-price closes. It derives cumulative multi-year returns from annualized values. Metadata explicitly distinguishes this market-price basis from official WisdomTree NAV total returns.

## Generated layout

```text
api/wisdomtree/
  index.json
  update-state.json
  funds/
    USFR/
      meta.json
      holdings/001.json
      history/001.json
      ...
```

`meta.json` keeps source URLs, identifiers, TER, market price, AUM, yield kind, returns, distributions and pagination manifests. Each sheet page includes `ticker`, page number, page size, total rows, a stable `headers` array and row objects. The app loads detail pages lazily and aggregates selected funds by ticker or identifier.

## Coverage decisions

- Catalog: 94 rows from WisdomTree.
- SEC exact series mappings: 93 rows.
- BTCW: issuer top-holdings fallback because no SEC mutual-fund map row exists.
- CUSIP/ISIN and tickers: sourced from N-PORT where present; exchange ticker matching uses SEC `company_tickers.json`; non-ticker instruments retain identifiers and `Ticker: "-"`.
- SEC yield: taken from the official product page when published; otherwise rendered as `—` with an explanation rather than guessed from a third-party site.
- AUM: catalog `$(000)` values multiplied by 1,000; SEC net assets remain available in the fund-level source context when relevant.
- Failure behavior: a temporary request failure can retain the previous static rows, but the updater logs the failure and does not relabel old data as fresh.

## Validation

The updater test suite covers:

- strict `min:max` and AUM preset parsing;
- Markdown catalog extraction, links, date parsing and `$(000)` conversion;
- SEC compact ticker mapping and accession URL construction;
- raw N-PORT sections, debt fields and Atom amendment filtering;
- Yahoo chart close/adjusted-close/dividend parsing;
- return derivation and distribution frequency inference.

Before committing a feed update:

```bash
bun test scripts/update-data.test.ts
bunx tsc --noEmit
bun ./scripts/update-data.ts
```
