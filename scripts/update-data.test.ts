// Bun's test runner provides these globals at runtime.
// @ts-ignore the repository intentionally keeps runtime dependencies at zero.
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  annualizedToTotal,
  deriveMetrics,
  performanceAsOfDate,
  RETURNS_BASIS_OFFICIAL,
  RETURNS_BASIS_DERIVED,
  cleanHoldingTicker,
  inferDistributionFrequency,
  mergeDistributionRecords,
  nportUrlFor,
  normalizeHoldingName,
  parseAumRange,
  parseCatalogMarkdown,
  parseChart,
  parseEdgarAtomFilings,
  parseFundTickerMap,
  parseNport,
  parseOfficialDistributions,
  parseProductPageSummary,
  parseRange,
  priceReturns,
  parseRanges,
  hasConfiguredFilters,
  readConfig,
  toIsoDate,
  CONTROL_NAMES,
  HISTORY_RANGE_PATTERN,
  isinFromCusip,
  looksLikeProductPage,
  resolveControls,
  runtimeControls,
  yahooChartQuery,
  formatDate,
  isCertError,
  installSystemCa,
  readKnownRows,
  rowFromMeta,
  runUpdate,
  setApiRoot,
  writeIndex,
} from './update-data';

// main() sets process.exitCode = 1 when a run updated nothing from a live source; a test must never leak that into the runner's exit code.
afterEach(() => { process.exitCode = 0; });

describe('range parsers', () => {
  test('parseRange keeps inclusive numeric bounds', () => {
    expect(parseRange('', 'X')).toBeUndefined();
    expect(parseRange(':', 'X')).toBeUndefined();
    expect(parseRange('0.1%:0.5%', 'X')).toEqual({ min: 0.1, max: 0.5 });
    expect(parseRange('2:', 'X')).toEqual({ min: 2, max: undefined });
    expect(() => parseRange('5:1', 'X')).toThrow(/must not exceed/);
    expect(() => parseRange('5', 'X')).toThrow(/colon is required/);
  });

  test('parseAumRange supports dollar suffixes and sibling presets', () => {
    expect(parseAumRange('10M:2B')).toEqual({ min: 10_000_000, max: 2_000_000_000 });
    expect(parseAumRange('large')).toEqual({ min: 10_000_000_000, max: undefined });
    expect(parseAumRange('micro')).toEqual({ min: 10_000_000, max: 300_000_000 });
    expect(() => parseAumRange('42')).toThrow(/colon is required/);
  });
});

describe('WisdomTree catalog parser', () => {
  const fixture = [
    '# WisdomTree U.S. Products',
    '',
    'As of 9/15/2026',
    '| WisdomTree Fund | Fund Ticker | Asset Class | Category | Inception Date | Gross Expense Ratio | Net Expense Ratio | Assets Under Mgmt $(000) | TTM Yield | Average Daily Volume |',
    '| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: |',
    '| [WisdomTree Floating Rate Treasury Fund](https://www.wisdomtree.com/investments/etfs/fixed-income/usfr) | [$USFR](https://www.wisdomtree.com/investments/etfs/fixed-income/usfr) | Fixed Income | Treasury / Government | 12/11/2014 | 0.15% | 0.15% | $16,985,696.89 | 4.72% | $100,000,000 |',
    '| [WisdomTree Efficient Gold Plus Equity Strategy Fund](https://www.wisdomtree.com/investments/etfs/alternative/gde) | [$GDE](https://www.wisdomtree.com/investments/etfs/alternative/gde) | Alternative | Commodities | 06/05/2024 | 0.75% | 0.75% | $1,234.50 | — | $1,000,000 |',
  ].join('\n');

  test('reads rows, links, as-of date and AUM $(000)', () => {
    const funds = parseCatalogMarkdown(fixture);
    expect(funds.map((row) => row.ticker)).toEqual(['GDE', 'USFR']);
    const usfr = funds.find((row) => row.ticker === 'USFR')!;
    expect(usfr.netAssets).toBe(16_985_696_890);
    expect(usfr.dividendYield).toBe(4.72);
    expect(usfr.asOfDate).toBe('2026-09-15');
    expect(usfr.inception).toBe('2014-12-11');
    expect(usfr.fundPage).toBe('https://www.wisdomtree.com/us/products/fixed-income/usfr');
  });

  test('keeps null for unavailable yield and normalizes categories', () => {
    const gde = parseCatalogMarkdown(fixture).find((row) => row.ticker === 'GDE')!;
    expect(gde.dividendYield).toBeNull();
    expect(gde.category).toBe('Alternative');
    expect(gde.ter).toBe(0.75);
  });
});

describe('official WisdomTree product page parser', () => {
  // Verified live against wisdomtree.com/us/products/fixed-income/usfr: the
  // "Total Returns" table carries three rows per section, in this order —
  // Underlying Index Returns, NAV Returns, Market Price Returns.
  const page = `# USFR WisdomTree Floating Rate Treasury Fund\n\n### 3.68%\n\n30-day SEC yield\n\nAs of 9/15/2026\n\n| Product Overview | As of 9/16/2026 |\n| --- | --- |\n| Expense Ratio | 0.15% |\n| CUSIP | 97717Y527 |\n| Total Assets (000) | $19,560,180.26 |\n| SEC 30-day Yield | 3.68% |\n\n### Net Asset Value\n\n| Net Asset Value | As of 9/16/2026 |\n| --- | --- |\n| NAV | $50.476 |\n| Premium/Discount to NAV | 0.01% |\n\n### Closing Market Price\n\n| Closing Market Value | As of 9/15/2026 |\n| --- | --- |\n| Closing Market Price | $50.470 |\n\n### Total Returns\n\nMonth End Performance (8/31/2026)\n\n| Cumulative | 1 Month | 3 Month | YTD | Since Inception* | |\n| --- | --- | --- | --- | --- | --- |\n| Underlying Index Returns | 0.33% | 1.04% | 2.70% | 30.94% | |\n| NAV Returns | 0.32% | 1.00% | 2.57% | 28.21% | |\n| Market Price Returns | 0.32% | 1.02% | 2.59% | 28.05% | |\n| Average Annual | 1 Year | 3 Year | 5 Year | 10 Year | Since Inception* |\n| Underlying Index Returns | 4.18% | 4.84% | 4.04% | 2.67% | 2.17% |\n| NAV Returns | 3.98% | 4.66% | 3.86% | 2.49% | 2.00% |\n| Market Price Returns | 4.00% | 4.65% | 3.86% | 2.52% | 1.99% |\n\nQuarter End Performance (6/30/2026)\n\n| Cumulative | Since Inception* |  |  |  |  |\n| --- | --- | --- | --- | --- | --- |\n| Underlying Index Returns | 30.04% |  |  |  |  |\n| NAV Returns | 27.37% |  |  |  |  |\n| Market Price Returns | 27.19% |  |  |  |  |\n| Average Annual | 1 Year | 3 Year | 5 Year | 10 Year | Since Inception* |\n| Underlying Index Returns | 4.30% | 4.90% | 4.10% | 2.70% | 2.20% |\n| NAV Returns | 4.10% | 4.70% | 3.90% | 2.50% | 2.02% |\n| Market Price Returns | 4.12% | 4.69% | 3.90% | 2.53% | 2.01% |`;

  test('reads NAV, market price, SEC yield, CUSIP and month-end market-price returns', () => {
    const parsed = parseProductPageSummary(page);
    expect(parsed).toMatchObject({ name: 'WisdomTree Floating Rate Treasury Fund', cusip: '97717Y527', nav: 50.476, marketPrice: 50.47, premiumDiscount: 0.01, secYield: 3.68, totalAssets: 19560180260 });
    expect(parsed.navAsOfDate).toBe('2026-09-16');
    expect(parsed.officialReturns.monthEnd).toMatchObject({ asOfDate: '2026-08-31', ytd: 2.59, cagr3y: 4.65, siAnn: 1.99 });
  });

  test('captures NAV Returns and Underlying Index Returns rows alongside Market Price Returns, without overwriting it', () => {
    const parsed = parseProductPageSummary(page);
    const monthEnd = parsed.officialReturns.monthEnd!;
    // Market Price Returns (the primary row) is untouched.
    expect(monthEnd).toMatchObject({ mo1: 0.32, qtd: 1.02, ytd: 2.59, yr1: 4.00, cagr3y: 4.65, cagr5y: 3.86, cagr10y: 2.52, siAnn: 1.99 });
    // NAV Returns and Underlying Index Returns are distinct labeled rows.
    expect(monthEnd.navReturns).toMatchObject({ mo1: 0.32, qtd: 1.00, ytd: 2.57, yr1: 3.98, cagr3y: 4.66, cagr5y: 3.86, cagr10y: 2.49, siAnn: 2.00 });
    expect(monthEnd.indexReturns).toMatchObject({ mo1: 0.33, qtd: 1.04, ytd: 2.70, yr1: 4.18, cagr3y: 4.84, cagr5y: 4.04, cagr10y: 2.67, siAnn: 2.17 });
  });

  test('handles the Quarter End cumulative row, which the site renders with blank trailing cells', () => {
    // Verified live against wisdomtree.com/us/products/fixed-income/usfr:
    // the Quarter End "Cumulative" row only ever publishes Since Inception,
    // leaving the 1-month/3-month/YTD cells blank. Pre-existing indexing
    // (unchanged by this parser extension) reads that single value into the
    // same cumulative-row slot Month End uses for its 1-month figure; the
    // point of this test is that the blank cells parse cleanly to null on
    // the new nav/index rows too, instead of throwing or becoming NaN.
    const parsed = parseProductPageSummary(page);
    const quarterEnd = parsed.officialReturns.quarterEnd!;
    expect(quarterEnd.mo1).toBe(27.19);
    expect(quarterEnd.qtd).toBeNull();
    expect(quarterEnd.navReturns).toMatchObject({ mo1: 27.37, qtd: null, ytd: null, yr1: 4.10, cagr3y: 4.70, cagr5y: 3.90, cagr10y: 2.50, siAnn: 2.02 });
    expect(quarterEnd.indexReturns).toMatchObject({ mo1: 30.04, qtd: null, ytd: null, yr1: 4.30, cagr3y: 4.90, cagr5y: 4.10, cagr10y: 2.70, siAnn: 2.20 });
  });

  test('leaves navReturns/indexReturns null when the table only publishes Market Price Returns', () => {
    const marketOnly = `# GDE WisdomTree Efficient Gold Plus Equity Strategy Fund\n\n### Total Returns\n\nMonth End Performance (8/31/2026)\n\n| Cumulative | 1 Month | 3 Month | YTD | Since Inception* | |\n| --- | --- | --- | --- | --- | --- |\n| Market Price Returns | 1.00% | 2.00% | 3.00% | 4.00% | |`;
    const parsed = parseProductPageSummary(marketOnly);
    expect(parsed.officialReturns.monthEnd).toMatchObject({ mo1: 1.00, navReturns: null, indexReturns: null });
  });
});

describe('official WisdomTree distributions parser', () => {
  test('reads ex-date/record/payable dates and the full tax-character breakdown', () => {
    // Verified live against wisdomtree.com/us/products/equity/dgrw.
    const page = '### Recent Distributions\n\n| Ex-Dividend Date | Record Date | Payable Date | Ordinary Income | Short Term Capital Gains | Long Term Capital Gains | Return of Capital | Total Distribution |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| 9/25/2026 | 9/25/2026 | 9/29/2026 | $0.17000 | $0.00000 | $0.00000 | $0.00000 | $0.17000 |\n| 8/26/2026 | 8/26/2026 | 8/28/2026 | $0.05500 | $0.00000 | $0.00000 | $0.00000 | $0.05500 |\n\n### Thought Leadership\n\n| Name | Ticker |\n| --- | --- |\n| unrelated | table |';
    const rows = parseOfficialDistributions(page);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ exDate: '2026-09-25', recordDate: '2026-09-25', payableDate: '2026-09-29', ordinaryIncome: 0.17, shortTermCapitalGains: 0, longTermCapitalGains: 0, returnOfCapital: 0, total: 0.17 });
    expect(rows[1].exDate).toBe('2026-08-26');
  });

  test('tolerates missing/blank cells the site sometimes renders', () => {
    const page = '### Recent Distributions\n\n| Ex-Dividend Date | Record Date | Payable Date | Ordinary Income | Short Term Capital Gains | Long Term Capital Gains | Return of Capital | Total Distribution |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| 3/25/2020 | 3/25/2020 | 3/27/2020 | $0.05000 |  |  |  | $0.05000 |\n| 12/24/2019 | 12/24/2019 | 12/26/2019 | — | — | — | — | — |';
    const rows = parseOfficialDistributions(page);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ ordinaryIncome: 0.05, shortTermCapitalGains: null, longTermCapitalGains: null, returnOfCapital: null, total: 0.05 });
    expect(rows[1]).toMatchObject({ ordinaryIncome: null, shortTermCapitalGains: null, longTermCapitalGains: null, returnOfCapital: null, total: null });
  });

  test('returns an empty list when the page has no Recent Distributions section', () => {
    expect(parseOfficialDistributions('# GDE\n\n### Total Returns\n\nno distributions section here')).toEqual([]);
  });
});

describe('official-first distributions merge (house policy: official wins, Yahoo fills only what it does not cover)', () => {
  test('prefers the official row over an overlapping Yahoo dividend event', () => {
    const official = parseOfficialDistributions('### Recent Distributions\n\n| Ex-Dividend Date | Record Date | Payable Date | Ordinary Income | Short Term Capital Gains | Long Term Capital Gains | Return of Capital | Total Distribution |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| 9/25/2026 | 9/25/2026 | 9/29/2026 | $0.17000 | $0.00000 | $0.00000 | $0.00000 | $0.17000 |');
    const yahoo = [{ epoch: Date.UTC(2026, 8, 25) / 1000, amount: 0.169 }]; // Yahoo's own rounding for the same ex-date.
    const { rows, yahooOnlyCount } = mergeDistributionRecords(official, yahoo);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ total: 0.17, ordinaryIncome: 0.17 });
    expect(yahooOnlyCount).toBe(0);
  });

  test('falls back to Yahoo dividend events for older ex-dates the small official table does not cover', () => {
    const official = parseOfficialDistributions('### Recent Distributions\n\n| Ex-Dividend Date | Record Date | Payable Date | Ordinary Income | Short Term Capital Gains | Long Term Capital Gains | Return of Capital | Total Distribution |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| 9/25/2026 | 9/25/2026 | 9/29/2026 | $0.17000 | $0.00000 | $0.00000 | $0.00000 | $0.17000 |');
    const yahoo = [
      { epoch: Date.UTC(2013, 5, 20) / 1000, amount: 0.05 }, // an old, pre-tax-breakdown-era ex-date the official table no longer shows.
      { epoch: Date.UTC(2026, 8, 25) / 1000, amount: 0.169 },
    ];
    const { rows, yahooOnlyCount } = mergeDistributionRecords(official, yahoo);
    expect(rows).toHaveLength(2);
    expect(yahooOnlyCount).toBe(1);
    expect(rows[0]).toMatchObject({ exDate: '2013-06-20', total: 0.05, ordinaryIncome: null });
    expect(rows[1]).toMatchObject({ exDate: '2026-09-25', total: 0.17 });
  });

  test('is exercised end-to-end as the fallback path for a fund whose official page has no distributions table at all', () => {
    // Simulates a fund where productPageMarkdown fetched fine but carries no
    // Recent Distributions section (or the product-page fetch failed
    // entirely) — the same shape update-data.ts builds when
    // parseOfficialDistributions([]) short-circuits to [].
    const official = parseOfficialDistributions('# Some Fund\n\nno distributions section here');
    expect(official).toEqual([]);
    const yahoo = [{ epoch: Date.UTC(2026, 5, 25) / 1000, amount: 0.16 }, { epoch: Date.UTC(2026, 6, 28) / 1000, amount: 0.065 }];
    const { rows, yahooOnlyCount } = mergeDistributionRecords(official, yahoo);
    expect(yahooOnlyCount).toBe(2);
    expect(rows.map((row) => row.total)).toEqual([0.16, 0.065]);
    expect(rows.every((row) => row.ordinaryIncome === null)).toBe(true);
  });
});

describe('SEC mapping and N-PORT', () => {
  test('maps the compact SEC mutual-fund ticker schema', () => {
    const map = parseFundTickerMap({ fields: ['cik', 'seriesId', 'classId', 'symbol'], data: [['1350487', 'S000043966', 'C000136444', 'USFR']] });
    expect(map.get('USFR')).toEqual({ cik: '0001350487', seriesId: 'S000043966', classId: 'C000136444' });
    expect(nportUrlFor('0001350487', '0000940400-26-028883')).toContain('/1350487/000094040026028883/0000940400-26-028883.txt');
  });

  test('parses the raw submission XML section, not the EDGAR header', () => {
    const xml = `<edgarSubmission><genInfo><regName>WisdomTree Trust</regName><regCik>0001350487</regCik><repPdDate>2026-05-31</repPdDate><seriesName>WisdomTree Floating Rate Treasury Fund</seriesName><seriesId>S000043966</seriesId></genInfo><fundInfo><netAssets>16985696887.65</netAssets></fundInfo><invstOrSecs><invstOrSec><name>UNITED STATES OF AMERICA</name><cusip>91282CPX3</cusip><pctVal>27.91</pctVal><valUSD>4740918723.73</valUSD><balance>4739107200</balance><assetCat>DBT</assetCat><debtSec><annualizedRt>3.694</annualizedRt><maturityDt>2028-01-31</maturityDt></debtSec></invstOrSec></invstOrSecs></edgarSubmission>`;
    const parsed = parseNport(xml);
    expect(parsed.seriesId).toBe('S000043966');
    expect(parsed.repPdDate).toBe('2026-05-31');
    expect(parsed.netAssets).toBe(16985696887.65);
    expect(parsed.holdings).toHaveLength(1);
    expect(parsed.holdings[0]).toMatchObject({ Identifier: '91282CPX3', Weight: '27.91', Coupon: '3.694', Maturity: '2028-01-31' });
  });

  test('selects NPORT-P Atom entries and ignores amendments', () => {
    const atom = `<feed><entry><filing-type>NPORT-P</filing-type><accession-number>0000000000-26-000001</accession-number><filing-date>2026-07-30</filing-date><filing-href>https://www.sec.gov/Archives/edgar/data/1350487/000000000026000001/x.txt</filing-href></entry><entry><filing-type>NPORT-P</filing-type><amend> </amend><accession-number>bad</accession-number></entry><entry><filing-type>NPORT-N</filing-type><accession-number>ignored</accession-number></entry></feed>`;
    expect(parseEdgarAtomFilings(atom)).toHaveLength(1);
    expect(parseEdgarAtomFilings(atom)[0].url).toContain('0000000000-26-000001.txt');
  });
});

describe('Yahoo chart and derived metrics', () => {
  test('parses close, adjusted close and dividends', () => {
    const parsed = parseChart({ chart: { result: [{ timestamp: [Date.UTC(2025, 0, 2) / 1000, Date.UTC(2025, 0, 3) / 1000], indicators: { quote: [{ close: [10, 11], volume: [100, 200] }], adjclose: [{ adjclose: [9, 10] }] }, events: { dividends: { '1735776000': { amount: 0.25 } } }, meta: { regularMarketPrice: 11, exchangeName: 'NYSEArca' } }] } });
    expect(parsed.days[1]).toMatchObject({ date: '2025-01-03', close: 11, adjClose: 10, volume: 200 });
    expect(parsed.dividends[0].amount).toBe(0.25);
    expect(parsed.exchangeName).toBe('NYSEArca');
  });

  test('returns use adjusted closes and annualized values can be converted', () => {
    const days = [
      { date: '2024-01-02', close: 100, adjClose: 100, volume: 1 },
      { date: '2025-01-02', close: 110, adjClose: 115, volume: 1 },
      { date: '2026-01-02', close: 121, adjClose: 132.25, volume: 1 },
    ];
    const result = priceReturns(days, new Date('2026-01-03T00:00:00Z'));
    expect(result.yr1).toBe(32.25);
    expect(annualizedToTotal(10, 3)).toBe(33.1);
  });

  test('metrics end with returnsBasis then performanceAsOf', () => {
    const days = [
      { date: '2025-01-02', close: 100, adjClose: 100, volume: 1 },
      { date: '2026-01-02', close: 110, adjClose: 110, volume: 1 },
    ];
    const fund = { dividendYield: null, secYield: null } as any;
    const derived = priceReturns(days, new Date('2026-01-03T00:00:00Z'));
    const estimated = deriveMetrics(derived, fund, [], { paymentsPerYear: null }, 110);
    expect(estimated.returnsBasis).toBe(RETURNS_BASIS_DERIVED);
    expect(estimated.performanceAsOf).toBe('2026-01-02');
    expect(Object.keys(estimated).slice(-2)).toEqual(['returnsBasis', 'performanceAsOf']);
    const official = deriveMetrics({ ...derived, asOfDate: '2025-12-31' }, fund, [], { paymentsPerYear: null }, 110, true);
    expect(official.returnsBasis).toBe(RETURNS_BASIS_OFFICIAL);
    expect(official.performanceAsOf).toBe('2025-12-31');
    expect(performanceAsOfDate({ ...derived, asOfDate: '' })).toBeNull();
    expect(estimated.ytd).not.toBe(0);
  });

  test('frequency inference follows the shared ETF updater convention', () => {
    const monthly = [0, 1, 2, 3].map((month) => ({ epoch: Date.UTC(2026, month, 15) / 1000, amount: 0.1 }));
    expect(inferDistributionFrequency(monthly)).toEqual({ frequency: 'Monthly', paymentsPerYear: 12 });
    expect(inferDistributionFrequency([])).toEqual({ frequency: 'None', paymentsPerYear: null });
  });
});

describe('small normalization helpers', () => {
  test('normalizes dates and issuer names', () => {
    expect(toIsoDate('09/15/2026')).toBe('2026-09-15');
    expect(normalizeHoldingName('Apple Inc. Class A')).toContain('APPLE');
    expect(normalizeHoldingName("McDonald's Corp.")).toBe('MCDONALDS');
    expect(cleanHoldingTicker('n/a')).toBe('');
    expect(cleanHoldingTicker(' MSFT ')).toBe('MSFT');
  });
});

describe('configured filter semantics', () => {
  test('colon range defaults mean no filter and partial batches retain the full universe', () => {
    const config = readConfig({
      AUM: ':', TER: ':', DIVIDEND_YIELD: ':', SEC_YIELD: ':', TICKERS: '',
      PERFORMANCE_YTD: ':', PERFORMANCE_1Y: ':', PERFORMANCE_3Y: ':', PERFORMANCE_5Y: ':', PERFORMANCE_10Y: ':',
      TOTAL_RETURN_YTD: ':', TOTAL_RETURN_1Y: ':', TOTAL_RETURN_3Y: ':', TOTAL_RETURN_5Y: ':', TOTAL_RETURN_10Y: ':',
    });
    expect(parseRanges({ PERFORMANCE_YTD: ':', PERFORMANCE_1Y: ':' }, 'PERFORMANCE')).toEqual({});
    expect(hasConfiguredFilters(config)).toBe(false);
  });

  test('SEC_YIELD is a real filter', () => {
    const config = readConfig(resolveControls({ SEC_YIELD: '3:5' }));
    expect(config.secYield).toEqual(expect.objectContaining({ min: 3, max: 5 }));
    expect(hasConfiguredFilters(config)).toBe(true);
  });
});

describe('HISTORY_RANGE limits the Yahoo request window', () => {
  test('max starts at 0, Ny starts N years before now; range is never sent', () => {
    const now = 2_000_000_000;
    const full = yahooChartQuery('max', now);
    expect(full.get('period1')).toBe('0');
    expect(full.get('period2')).toBe(String(now + 86_400));
    expect(full.has('range')).toBe(false);
    const limited = yahooChartQuery('5y', now);
    expect(limited.has('range')).toBe(false);
    expect(Number(limited.get('period1'))).toBe(Math.floor(now - 5 * 365.25 * 86_400));
    expect(limited.get('period2')).toBe(String(now + 86_400));
    expect(limited.get('events')).toBe('div|split');
  });

  test('only max and whole years are accepted, case-insensitively', () => {
    for (const range of ['max', '1y', '5y', '10y']) expect(readConfig(resolveControls({ HISTORY_RANGE: range })).historyRange).toBe(range);
    expect(readConfig(resolveControls({ HISTORY_RANGE: '5Y' })).historyRange).toBe('5y');
    expect(HISTORY_RANGE_PATTERN.test('0y')).toBe(false);
    for (const bad of ['7d', 'ytd', '6mo', '0y', 'y', '5', '-1y', '1.5y']) expect(() => resolveControls({ HISTORY_RANGE: bad })).toThrow('HISTORY_RANGE');
  });
});

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const configFile = () => JSON.parse(read('scripts/update-data.config.json'));
const workflow = () => read('.github/workflows/update-data.yml');
const tenor = (name: string) => name.match(/^(PERFORMANCE|TOTAL_RETURN)_(1Y|3Y|5Y|10Y)$/);

describe('control resolver', () => {
  test('precedence: file < advanced < nonblank input < environment', () => {
    const c = resolveControls({ CONCURRENCY: 2, TICKERS: 'DGRW' }, { CONCURRENCY: 3, TICKERS: 'USFR' }, { CONCURRENCY: '4', TICKERS: '' }, { CONCURRENCY: '5' });
    expect(c.CONCURRENCY).toBe('5');
    expect(c.TICKERS).toBe('USFR');
    expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }).CONCURRENCY).toBe('4');
    expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }).CONCURRENCY).toBe('3');
  });

  test('blank input inherits the file value; advanced and an explicitly set env var can blank a key', () => {
    expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }).CONCURRENCY).toBe('2');
    expect(resolveControls({ TICKERS: 'DGRW' }, {}, { TICKERS: '' }).TICKERS).toBe('DGRW');
    expect(resolveControls({ TICKERS: 'DGRW' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
    expect(resolveControls({ TICKERS: 'DGRW' }, {}, {}, { TICKERS: '' }).TICKERS).toBe('');
    expect(resolveControls({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }).SKIP_YAHOO).toBe('false');
  });

  test('scheduled path (empty inputs and advanced) equals config defaults', () => {
    const file = configFile();
    expect(resolveControls(file, {}, {}, {})).toEqual(Object.fromEntries(Object.entries(file).map(([k, v]) => [k, String(v)])));
  });

  test('provider-specific defaults and the SEC contact', () => {
    const file = configFile();
    expect(file).toMatchObject({ MAX_FETCHES: '0', REQUEST_SLEEP: '2', CONCURRENCY: '2', HOLDINGS_PAGE_SIZE: '250', HISTORY_PAGE_SIZE: '1000', MAX_RETRIES: '2', HISTORY_RANGE: 'max', EDGAR_FALLBACK: 'true', SKIP_YAHOO: 'false', SKIP_WISDOMTREE: 'false', STORE_RAW_DOWNLOADS: 'false', AUM: ':', TER: ':', DIVIDEND_YIELD: ':', SEC_YIELD: ':', TICKERS: '' });
    expect(file.SEC_UA).toBe('daggerok ETF feed daggerok@gmail.com');
    const config = readConfig(resolveControls(file));
    expect(config.secUa).toBe(file.SEC_UA);
    expect(config.maxFetches).toBe(0);
    expect(config.requestSleep).toBe(2);
    expect(config.concurrency).toBe(2);
    expect(config.maxRetries).toBe(2);
    expect(config.tickers).toBeNull();
    expect(config.edgarFallback).toBe(true);
    expect(config.skipYahoo).toBe(false);
    expect(config.skipWisdomTree).toBe(false);
    expect(config.storeRawDownloads).toBe(false);
    expect(config.historyRange).toBe('max');
    expect(config.aum).toBeUndefined();
    expect(config.secYield).toBeUndefined();
    expect(read('scripts/update-data.ts')).not.toMatch(/example\.com|admin@/);
  });

  test('rejects unknown keys, invalid values and newline injection', () => {
    for (const value of [{ UNKNOWN: 1 }, { SEC_UA: 'x\nEVIL=yes' }, { CONCURRENCY: 0 }, { MAX_RETRIES: 0 }, { MAX_RETRIES: -1 }, { MAX_FETCHES: 1.5 }, { REQUEST_SLEEP: '-1' }, { VERBOSE: 'maybe' }, { USE_SYSTEM_CA: 'maybe' }, { EDGAR_FALLBACK: 'maybe' }, { AUM: '1:2:3' }, { TER: '5:1' }, { SEC_YIELD: '5' }, { PERFORMANCE_1Y: '5' }, { TICKERS: ['DGRW'] }, null, []]) {
      expect(() => resolveControls(value)).toThrow();
    }
    expect(() => resolveControls({}, { SEC_UA: 'x\rfoo' })).toThrow();
    expect(() => resolveControls({}, {}, {}, { SEC_UA: 'x\0bad' })).toThrow();
    expect(() => resolveControls({}, 'x')).toThrow();
    expect(() => resolveControls({}, { UNKNOWN: 'x' })).toThrow();
    expect(() => resolveControls({}, {}, { TICKERS: { a: 1 } })).toThrow();
    expect(() => resolveControls({}, {}, { TICKERS: 'A\nB' })).toThrow();
    expect(() => resolveControls({}, {}, {}, { MAX_RETRIES: '0' })).toThrow();
    expect(() => JSON.parse('{bad')).toThrow();
  });

  test('boolean spellings agree between validation and parsing', () => {
    for (const [text, value] of [['n', false], ['no', false], ['off', false], ['0', false], ['false', false], ['y', true], ['on', true], ['1', true]] as const) {
      expect(readConfig(resolveControls({ EDGAR_FALLBACK: text })).edgarFallback).toBe(value);
    }
  });

  test('runtimeControls reads the config file and lets the environment win', async () => {
    expect(await runtimeControls({})).toEqual(resolveControls(configFile()));
    expect((await runtimeControls({ CONCURRENCY: '7' })).CONCURRENCY).toBe('7');
  });
});

describe('configuration documentation parity', () => {
  test('config keys, CONTROL_NAMES, --help text and README rows are in sync', () => {
    expect(Object.keys(configFile()).sort()).toEqual([...CONTROL_NAMES].sort());
    const doc = read('README.md');
    // README lists the five tenors of PERFORMANCE_* / TOTAL_RETURN_* on one row: `PREFIX_YTD` / `_1Y` / ...
    for (const name of CONTROL_NAMES) {
      const t = tenor(name);
      expect(doc).toContain(t ? '`_' + t[2] + '`' : '`' + name + '`');
      if (t) expect(doc).toContain('`' + t[1] + '_YTD`');
    }
    expect(doc).toContain('scripts/update-data.config.json');
    const usage = read('scripts/update-data.ts');
    for (const name of CONTROL_NAMES) {
      const t = name.match(/^(PERFORMANCE|TOTAL_RETURN)_/);
      expect(usage).toContain(t ? `${t[1]}_YTD|1Y|3Y|5Y|10Y` : `  ${name}=`);
    }
  });

  test('README keeps the required structure and verification commands only', () => {
    const doc = read('README.md');
    const headings = [...doc.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1]);
    expect(headings.slice(0, 8)).toEqual(['Using Bun', 'Updating the static WisdomTree data', 'Data sources', 'Metrics and caveats', 'Update controls', 'Examples', 'TypeScript and verification', 'Brands table']);
    for (const command of ['bun install --frozen-lockfile', 'bun test', 'bun build --target=bun scripts/update-data.ts --outfile=/dev/null', 'git diff --check']) expect(doc).toContain(command);
    expect(doc).not.toMatch(/worklog|\.prompt|evidence\/|fixtures|config-docs\.test/i);
  });
});

describe('workflow', () => {
  test('<= 25 inputs, advanced default, every input is a control, fixed output, no inputs.* interpolation', () => {
    const actual = workflow();
    const names = [...actual.slice(actual.indexOf('    inputs:'), actual.indexOf('\npermissions:')).matchAll(/^      (\w+):$/gm)].map((m) => m[1]);
    expect(names.length).toBeLessThanOrEqual(25);
    expect(names).toContain('advanced');
    expect(actual).toContain("default: '{}'");
    for (const name of names.filter((n) => n !== 'advanced')) expect(CONTROL_NAMES).toContain(name.toUpperCase() as never);
    expect(names).not.toContain('sec_ua');
    expect(actual).toContain("cron: '0 0 * * 0'");
    expect(actual).not.toMatch(/^  push:/m);
    expect(actual).toContain('toJSON(inputs)');
    expect(actual).toContain('resolveControls(file, advanced, individual, protectedVars)');
    expect(actual).not.toMatch(/\$\{\{\s*inputs\./);
    expect(actual).not.toMatch(/OUTPUT_DIR|output_dir/i);
    expect(actual).toContain('PROTECTED_SEC_UA: ${{ vars.SEC_UA }}');
    expect(actual.match(/git add (\S+)/g)).toEqual(['git add api/wisdomtree']);
    expect(actual.match(/api\/[\w-]+/g)!.every((p) => p === 'api/wisdomtree')).toBe(true);
    expect(actual).toContain('timeout-minutes: 30');
    expect(actual).toContain('persist-credentials: false');
    expect(actual).toContain('if: ${{ !cancelled() }}');
  });

  test('every control stays reachable: individually or through advanced', () => {
    const actual = workflow();
    const individual = new Set([...actual.matchAll(/^      (\w+):$/gm)].map((m) => m[1].toUpperCase()));
    const viaAdvanced = CONTROL_NAMES.filter((n) => !individual.has(n));
    expect(viaAdvanced).toEqual(['HOLDINGS_PAGE_SIZE', 'STORE_RAW_DOWNLOADS', 'SEC_UA', 'VERBOSE', 'USE_SYSTEM_CA']);
    expect(() => resolveControls(configFile(), Object.fromEntries(viaAdvanced.map((n) => [n, configFile()[n]])))).not.toThrow();
  });
});

describe('catalog table without fund rows', () => {
  test('is rejected by the parser so the fetch can fall back to the next source', () => {
    expect(() => parseCatalogMarkdown('| WisdomTree Fund | Fund Ticker | a | b | c | d | e | f | g | h |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n')).toThrow('no fund rows found');
  });
});

describe('system CA support', () => {
  test('USE_SYSTEM_CA resolver: default auto, case-insensitive, strict', () => {
    expect(resolveControls(configFile()).USE_SYSTEM_CA).toBe('auto');
    for (const mode of ['auto', 'true', 'false', 'TRUE', 'Auto']) expect(resolveControls(configFile(), {}, {}, { USE_SYSTEM_CA: mode }).USE_SYSTEM_CA).toBe(mode.toLowerCase());
    expect(() => resolveControls(configFile(), {}, {}, { USE_SYSTEM_CA: 'maybe' })).toThrow('USE_SYSTEM_CA');
  });

  test('isCertError recognizes untrusted-certificate failures only', () => {
    expect(isCertError({ code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' })).toBe(true);
    expect(isCertError(new Error('unable to get local issuer certificate'))).toBe(true);
    expect(isCertError(new Error('fetch failed', { cause: new Error('unable to get local issuer certificate') }))).toBe(true);
    expect(isCertError({ code: 'ECONNRESET' })).toBe(false);
    expect(isCertError(new Error('HTTP 403 for https://example.test'))).toBe(false);
  });

  test('installSystemCa modes', async () => {
    const original = globalThis.fetch;
    const reexec = (calls: { n: number }) => (() => { calls.n += 1; throw new Error('reexec'); }) as () => never;
    try {
      let calls = { n: 0 };
      installSystemCa('false', reexec(calls), false);
      expect(globalThis.fetch).toBe(original);
      installSystemCa('auto', reexec(calls), true);
      expect(globalThis.fetch).toBe(original);
      expect(() => installSystemCa('true', reexec(calls), false)).toThrow('reexec');
      expect(calls.n).toBe(1);

      calls = { n: 0 };
      globalThis.fetch = (async () => new Response('ok')) as unknown as typeof fetch;
      const ok = globalThis.fetch;
      installSystemCa('auto', reexec(calls), false);
      expect(globalThis.fetch).not.toBe(ok);
      expect(await (await fetch('https://x.test')).text()).toBe('ok');
      expect(calls.n).toBe(0);

      globalThis.fetch = (async () => { throw new Error('connection reset'); }) as unknown as typeof fetch;
      installSystemCa('auto', reexec(calls), false);
      await expect(fetch('https://x.test')).rejects.toThrow('connection reset');
      expect(calls.n).toBe(0);

      globalThis.fetch = (async () => { throw Object.assign(new Error('x'), { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' }); }) as unknown as typeof fetch;
      installSystemCa('auto', reexec(calls), false);
      await expect(fetch('https://x.test')).rejects.toThrow('reexec');
      expect(calls.n).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('filtered and catalog-less runs never shrink the feed', () => {
  const metaFor = (ticker: string, official: boolean) => ({
    ticker, name: `Fund ${ticker}`, category: 'Domestic Equity',
    source: { fundPage: `https://www.wisdomtree.com/us/products/equity/${ticker.toLowerCase()}` },
    identifiers: { cusip: '123456789', isin: null },
    expenseRatio: { value: 0.28 }, nav: { value: 50 }, marketPrice: { value: 50.5 }, premiumDiscount: { value: 0.1 },
    aum: { value: 1_000_000_000, asOfDate: 'Sep 23 2026' }, yields: { dividendYield: null, secYield: null },
    returns: {
      derivedFrom: official ? 'WisdomTree product-page Market Price Returns' : 'adjusted market-price closes (Yahoo chart API)',
      monthEnd: { asOfDate: 'Aug 31 2026', ytd: 11.49, yr1: 14.75, yr3: null, yr5: null, yr10: null, sinceInception: null },
    },
    distributions: { frequency: 'Monthly', paymentsPerYear: 12, rows: [['06/24/2026', '—', '—', '0.1'], ['07/22/2026', '—', '—', '0.2']] },
    holdings: { pages: [], totalRows: 7 }, history: { pages: [], totalRows: 9 },
  });

  function setup(published: string[], metaOnly: string[]): URL {
    const dir = mkdtempSync(join(tmpdir(), 'wt-feed-'));
    const root = pathToFileURL(`${dir}/`);
    const rows = published.map((ticker) => ({ ...rowFromMeta(metaFor(ticker, true)), name: `Published ${ticker}` }));
    writeFileSync(join(dir, 'index.json'), JSON.stringify({ funds: rows }));
    for (const ticker of [...published, ...metaOnly]) {
      mkdirSync(join(dir, 'funds', ticker), { recursive: true });
      writeFileSync(join(dir, 'funds', ticker, 'meta.json'), JSON.stringify(metaFor(ticker, ticker !== 'AAA')));
    }
    return root;
  }

  async function withMockedRun(root: URL, env: Record<string, string>, handler: (url: string) => Response): Promise<{ funds: any[]; counts: any }> {
    const original = globalThis.fetch;
    const originalRoot = new URL('../api/wisdomtree/', import.meta.url);
    globalThis.fetch = (async (input: any) => handler(String(input?.url ?? input))) as unknown as typeof fetch;
    setApiRoot(root);
    try {
      const config = { ...readConfig(resolveControls({ REQUEST_SLEEP: '0', MAX_RETRIES: '1', SKIP_YAHOO: 'true', EDGAR_FALLBACK: 'false', ...env })), proxyGapMs: 0, retryDelayMs: 0 };
      await runUpdate(config);
      return JSON.parse(readFileSync(new URL('index.json', root), 'utf8'));
    } finally {
      globalThis.fetch = original;
      setApiRoot(originalRoot);
      rmSync(root, { recursive: true, force: true });
    }
  }

  test('rowFromMeta rebuilds the shared row shape; unknown metrics stay null, never 0', () => {
    const official = rowFromMeta(metaFor('AAA', true));
    expect(official.dataFile).toBe('./funds/AAA/meta.json');
    expect(official.metrics.returnsBasis).toBe(RETURNS_BASIS_OFFICIAL);
    expect(official.metrics.performanceAsOf).toBe('2026-08-31');
    expect(official.metrics.cagr3y).toBeNull();
    expect(official.metrics.tr3y).toBeNull();
    expect(official.metrics.secYield).toBeNull();
    expect(official.metrics.dividendYield).toBe(4.75);
    expect(official.holdings).toBe(7);
    expect(official.distributions.exDate).toBe('07/22/2026');
    const derived = rowFromMeta(metaFor('AAA', false));
    expect(derived.metrics.returnsBasis).toBe(RETURNS_BASIS_DERIVED);
    const noDate = rowFromMeta({ ...metaFor('AAA', false), returns: { derivedFrom: 'x', monthEnd: { asOfDate: '—' } } });
    expect(noDate.metrics.performanceAsOf).toBeNull();
    expect(noDate.metrics.ytd).toBeNull();
  });

  test('readKnownRows is the union of the published index and funds/*/meta.json', async () => {
    const root = setup(['AAA'], ['BBB', 'CCC']);
    setApiRoot(root);
    try {
      const known = await readKnownRows();
      expect([...known.keys()].sort()).toEqual(['AAA', 'BBB', 'CCC']);
      expect(known.get('AAA')!.name).toBe('Published AAA');
      await writeIndex([...known.values()]);
      expect(JSON.parse(readFileSync(new URL('index.json', root), 'utf8')).counts.funds).toBe(3);
    } finally {
      setApiRoot(new URL('../api/wisdomtree/', import.meta.url));
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a one-ticker run with an unreadable catalog keeps every row', async () => {
    const root = setup(['AAA'], ['BBB', 'CCC']);
    const index = await withMockedRun(root, { TICKERS: 'AAA' }, () => new Response('blocked', { status: 404 }));
    expect(index.funds.map((row) => row.ticker)).toEqual(['AAA', 'BBB', 'CCC']);
    expect(index.counts.funds).toBe(3);
  });

  test('a one-ticker run with a catalog that lists only that fund keeps the same row count', async () => {
    const root = setup(['AAA', 'BBB'], ['CCC']);
    const catalog = [
      'As of 9/15/2026',
      '| WisdomTree Fund | Fund Ticker | Asset Class | Category | Inception Date | Gross Expense Ratio | Net Expense Ratio | Assets Under Mgmt $(000) | TTM Yield | Average Daily Volume |',
      '| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: |',
      '| [Fund AAA](https://www.wisdomtree.com/investments/etfs/equity/aaa) | [$AAA](https://www.wisdomtree.com/investments/etfs/equity/aaa) | Equity | Core | 12/11/2014 | 0.15% | 0.15% | $16,985,696.89 | 4.72% | $100,000,000 |',
    ].join('\n');
    const index = await withMockedRun(root, { TICKERS: 'AAA' }, (url) => url.includes('/us/products') && !url.includes('/equity/') ? new Response(catalog) : new Response('nope', { status: 404 }));
    expect(index.funds.map((row) => row.ticker)).toEqual(['AAA', 'BBB', 'CCC']);
    expect(index.funds.find((row) => row.ticker === 'BBB').name).toBe('Published BBB');
  });

  test('an unfiltered run whose catalog failed also keeps every row', async () => {
    const root = setup(['AAA'], ['BBB']);
    const index = await withMockedRun(root, {}, () => new Response('blocked', { status: 404 }));
    expect(index.counts.funds).toBe(2);
  });

  test('MAX_FETCHES-bounded runs keep unselected rows', async () => {
    const root = setup(['AAA', 'BBB'], ['CCC']);
    const index = await withMockedRun(root, { MAX_FETCHES: '1' }, () => new Response('blocked', { status: 404 }));
    expect(index.counts.funds).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Mocked end-to-end scenarios: wisdomtree.com is blocked, the r.jina.ai proxy serves markdown, Yahoo serves a chart.
// ---------------------------------------------------------------------------

type Call = { url: string; ua: string; at: number };

const productPage = (ticker: string, ytd = '2.59%'): string => [
  `# ${ticker} WisdomTree ${ticker} Fund`,
  '',
  '| Product Overview | As of 9/16/2026 |', '| --- | --- |', '| Expense Ratio | 0.15% |', '| CUSIP | 037833100 |', '| Total Assets (000) | $19,560,180.26 |', '| SEC 30-day Yield | 3.68% |',
  '',
  '### Net Asset Value', '', '| Net Asset Value | As of 9/16/2026 |', '| --- | --- |', '| NAV | $50.476 |', '| Premium/Discount to NAV | 0.01% |',
  '',
  '### Closing Market Price', '', '| Closing Market Value | As of 9/15/2026 |', '| --- | --- |', '| Closing Market Price | $50.470 |',
  '',
  '### Total Returns', '', 'Month End Performance (8/31/2026)', '',
  '| Cumulative | 1 Month | 3 Month | YTD | Since Inception* | |', '| --- | --- | --- | --- | --- | --- |', `| Market Price Returns | 0.32% | 1.02% | ${ytd} | 28.05% | |`,
  '| Average Annual | 1 Year | 3 Year | 5 Year | 10 Year | Since Inception* |', '| Market Price Returns | 4.00% | 4.65% | 3.86% | 2.52% | 1.99% |',
  '',
  'Quarter End Performance (6/30/2026)', '',
  '| Cumulative | Since Inception* | | | | |', '| --- | --- | --- | --- | --- | --- |', '| Market Price Returns | 27.19% | | | | |',
  '| Average Annual | 1 Year | 3 Year | 5 Year | 10 Year | Since Inception* |', '| Market Price Returns | 4.12% | 4.69% | 3.90% | 2.53% | 2.01% |',
  '',
  '### Recent Distributions', '',
  '| Ex-Dividend Date | Record Date | Payable Date | Ordinary Income | Short Term Capital Gains | Long Term Capital Gains | Return of Capital | Total Distribution |', '| --- | --- | --- | --- | --- | --- | --- | --- |',
  '| 9/25/2026 | 9/25/2026 | 9/29/2026 | 0.17 | 0 | 0 | 0 | 0.17 |',
].join('\n');

const catalogFor = (tickers: string[]): string => [
  'As of 9/15/2026',
  '| WisdomTree Fund | Fund Ticker | Asset Class | Category | Inception Date | Gross Expense Ratio | Net Expense Ratio | Assets Under Mgmt $(000) | TTM Yield | Average Daily Volume |',
  '| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: |',
  ...tickers.map((t) => `| [Fund ${t}](https://www.wisdomtree.com/investments/etfs/equity/${t.toLowerCase()}) | [$${t}](https://www.wisdomtree.com/investments/etfs/equity/${t.toLowerCase()}) | Equity | Core | 06/04/2014 | 0.40% | 0.15% | $16,985,696.89 | 4.72% | $100,000,000 |`),
].join('\n');

function chartPayload(days = 400, last = Date.UTC(2026, 8, 25)): any {
  const timestamps = Array.from({ length: days }, (_, i) => Math.floor((last - (days - 1 - i) * 86_400_000) / 1000));
  const close = timestamps.map((_, i) => 100 + i * 0.1);
  return { chart: { result: [{ timestamp: timestamps, indicators: { quote: [{ close, volume: close.map(() => 1000) }], adjclose: [{ adjclose: close }] }, events: { dividends: {} }, meta: { exchangeName: 'NGM', regularMarketPrice: 140, regularMarketTime: Math.floor(last / 1000) } } ] } };
}

class Scenario {
  dir = mkdtempSync(join(tmpdir(), 'wt-scn-'));
  root = pathToFileURL(`${this.dir}/api/wisdomtree/`);
  calls: Call[] = [];
  logs: string[] = [];
  constructor(public tickers: string[] = ['AAA', 'BBB', 'CCC']) { mkdirSync(join(this.dir, 'api/wisdomtree'), { recursive: true }); }
  /** Default world: direct wisdomtree.com is Cloudflare-blocked, the proxy serves the catalog and product pages, Yahoo serves a chart, SEC is empty. */
  handler = (url: string, _init?: any): Response | Promise<Response> => {
    if (url.startsWith('https://r.jina.ai/')) return url.endsWith('/us/products') ? new Response(catalogFor(this.tickers)) : new Response(productPage(url.split('/').pop()!.toUpperCase()));
    if (url.includes('wisdomtree.com')) return new Response('blocked', { status: 403 });
    if (url.includes('finance.yahoo.com')) return new Response(JSON.stringify(chartPayload()));
    return new Response('nope', { status: 404 });
  };
  async run(env: Record<string, string> = {}, overrides: Record<string, unknown> = {}, deadlineMs?: number): Promise<void> {
    const original = globalThis.fetch;
    const originalLog = console.log;
    globalThis.fetch = (async (input: any, init: any) => {
      const url = String(input?.url ?? input);
      this.calls.push({ url, ua: String(init?.headers?.['User-Agent'] ?? ''), at: Date.now() });
      return this.handler(url, init);
    }) as unknown as typeof fetch;
    console.log = (...args: unknown[]) => { this.logs.push(args.join(' ')); };
    setApiRoot(this.root);
    try {
      const config = { ...readConfig(resolveControls({ REQUEST_SLEEP: '0', MAX_RETRIES: '1', EDGAR_FALLBACK: 'false', CONCURRENCY: '1', ...env })), proxyGapMs: 0, retryDelayMs: 0, ...overrides } as any;
      await runUpdate(config, deadlineMs);
    } finally {
      globalThis.fetch = original;
      console.log = originalLog;
      setApiRoot(new URL('../api/wisdomtree/', import.meta.url));
    }
  }
  index(): any { return JSON.parse(readFileSync(new URL('index.json', this.root), 'utf8')); }
  meta(ticker: string): any { return JSON.parse(readFileSync(new URL(`funds/${ticker}/meta.json`, this.root), 'utf8')); }
  state(): any { return JSON.parse(readFileSync(new URL('update-state.json', this.root), 'utf8')); }
  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    const walk = (dir: string): void => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) walk(path); else out[path] = statSync(path).mtimeMs; } };
    walk(join(this.dir, 'api/wisdomtree'));
    return out;
  }
  cleanup(): void { rmSync(this.dir, { recursive: true, force: true }); }
}

async function withScenario(fn: (s: Scenario) => Promise<void>, tickers?: string[]): Promise<void> {
  const s = new Scenario(tickers);
  try { await fn(s); } finally { s.cleanup(); }
}

describe('product pages: direct first, proxy as the gated fallback', () => {
  test('a blocked direct request latches; proxy starts are >= the gap apart and a failing page is retried once', async () => {
    await withScenario(async (s) => {
      const base = s.handler;
      s.handler = (url, init) => (url.endsWith('/ccc') && url.startsWith('https://r.jina.ai/') ? new Response('boom', { status: 502 }) : base(url));
      await s.run({ CONCURRENCY: '3', MAX_RETRIES: '5' }, { proxyGapMs: 40 });
      const direct = s.calls.filter((c) => c.url.includes('wisdomtree.com') && !c.url.startsWith('https://r.jina.ai/'));
      expect(direct).toHaveLength(1); // the first (catalog) request got a 403; the block latched for every product page
      const proxy = s.calls.filter((c) => c.url.startsWith('https://r.jina.ai/'));
      expect(proxy.filter((c) => c.url.endsWith('/ccc'))).toHaveLength(2); // one retry, not MAX_RETRIES
      expect(proxy).toHaveLength(1 + 1 + 1 + 2); // catalog + AAA + BBB + CCC twice
      for (let i = 1; i < proxy.length; i += 1) expect(proxy[i].at - proxy[i - 1].at).toBeGreaterThanOrEqual(35);
    });
  });

  test('a reachable direct page is used and the proxy is never called', async () => {
    await withScenario(async (s) => {
      s.handler = (url, init) => url.startsWith('https://r.jina.ai/') ? new Response('should not be used', { status: 500 }) : url.includes('wisdomtree.com') ? new Response(url.endsWith('/us/products') ? catalogFor(s.tickers) : productPage(url.split('/').pop()!.toUpperCase())) : url.includes('yahoo') ? new Response(JSON.stringify(chartPayload())) : new Response('no', { status: 404 });
      await s.run();
      expect(s.calls.some((c) => c.url.startsWith('https://r.jina.ai/'))).toBe(false);
      expect(s.meta('AAA').source.productPageStatus).toContain('directly');
    });
  });

  test('a Cloudflare verification page served with HTTP 200 is a failure, not an empty product page', () => {
    expect(looksLikeProductPage('Title: Just a moment...\n\n## Performing security verification')).toBe(false);
    expect(looksLikeProductPage(productPage('AAA'))).toBe(true);
  });

  test('requests carry a timeout that aborts a hanging response', async () => {
    await withScenario(async (s) => {
      s.handler = (_url, init) => new Promise<Response>((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
      const started = Date.now();
      await expect(s.run({}, { fetchTimeoutMs: 30 })).rejects.toThrow('No catalog rows'); // no hang: every attempt was aborted by its signal
      expect(Date.now() - started).toBeLessThan(2_000);
    });
  });
});

describe('only the SEC receives the SEC contact as User-Agent', () => {
  test('proxy, wisdomtree.com and Yahoo get a generic agent', async () => {
    await withScenario(async (s) => {
      const base = s.handler;
      s.handler = (url, init) => (url.includes('sec.gov') ? new Response(JSON.stringify({ fields: ['cik', 'seriesId', 'classId', 'symbol'], data: [] })) : base(url));
      await s.run({ EDGAR_FALLBACK: 'true' });
      const sec = s.calls.filter((c) => c.url.includes('sec.gov'));
      expect(sec.length).toBeGreaterThan(0);
      expect(sec.every((c) => c.ua.includes('daggerok'))).toBe(true);
      const others = s.calls.filter((c) => !c.url.includes('sec.gov'));
      expect(others.length).toBeGreaterThan(3);
      expect(others.every((c) => c.ua !== '' && !c.ua.includes('daggerok'))).toBe(true);
    });
  });
});

describe('a failed product page keeps the previous official data as one unit', () => {
  test('returns, quarter-end, distributions, NAV, price and premium all stay official and dated as before', async () => {
    await withScenario(async (s) => {
      await s.run(); // run 1: everything fetched
      const before = s.meta('AAA');
      expect(s.index().funds[0].metrics.returnsBasis).toBe(RETURNS_BASIS_OFFICIAL);
      const base = s.handler;
      // run 2: the proxy answers a verification page for the product pages (HTTP 200), Yahoo is fine and fresher
      s.handler = (url, init) => (url.startsWith('https://r.jina.ai/') && !url.endsWith('/us/products') ? new Response('Title: Just a moment...') : base(url));
      await s.run({ TICKERS: 'AAA' });
      const after = s.meta('AAA');
      expect(after.returns).toEqual(before.returns);
      expect(after.returns.quarterEnd.asOfDate).toBe('Jun 30 2026');
      expect(after.distributions).toEqual(before.distributions);
      expect(after.distributions.rows[0][3]).toBe('0.17'); // tax-character breakdown survives
      expect([after.nav, after.marketPrice, after.premiumDiscount]).toEqual([before.nav, before.marketPrice, before.premiumDiscount]);
      expect(after.source.productPageStatus).toContain('retained');
      const row = s.index().funds.find((f: any) => f.ticker === 'AAA');
      expect(row.metrics.returnsBasis).toBe(RETURNS_BASIS_OFFICIAL);
      expect(row.metrics.performanceAsOf).toBe('2026-08-31');
      expect(row.metrics.secYield).toBe(3.68);
    });
  });

  test('an honest page without a quarter-end table does not get a fabricated quarter-end date', async () => {
    await withScenario(async (s) => {
      const base = s.handler;
      s.handler = (url, init) => (url.startsWith('https://r.jina.ai/') && !url.endsWith('/us/products') ? new Response(productPage('AAA').replace(/Quarter End Performance[\s\S]*?\n\n### Recent/, '### Recent')) : base(url));
      await s.run({ TICKERS: 'AAA' });
      expect(s.meta('AAA').returns.quarterEnd).toMatchObject({ asOfDate: '—', yr1: null, sinceInception: null });
    });
  });
});

describe('bounded runs, cursor and filters', () => {
  test('the cursor advances past skipped funds so a batch can never loop on itself', async () => {
    await withScenario(async (s) => {
      // TOTAL_RETURN_1Y=1000: nothing passes after the fetch, so every fund is skipped
      await s.run({ MAX_FETCHES: '1', TOTAL_RETURN_1Y: '1000:' });
      expect(s.state().cursor).toBe('AAA');
      await s.run({ MAX_FETCHES: '1', TOTAL_RETURN_1Y: '1000:' });
      expect(s.state().cursor).toBe('BBB');
      await s.run({ MAX_FETCHES: '2', TOTAL_RETURN_1Y: '1000:' });
      expect(s.state().cursor).toBe('AAA'); // CCC, then wrapped to AAA
    }, ['AAA', 'BBB', 'CCC']);
  });

  test('batches wrap around and count only funds that pass the catalog filters; a TICKERS run leaves the cursor alone', async () => {
    await withScenario(async (s) => {
      await s.run({ MAX_FETCHES: '2' });
      expect(s.state().cursor).toBe('BBB');
      await s.run({ MAX_FETCHES: '2' });
      expect(s.state().cursor).toBe('AAA'); // CCC then wrapped to AAA
      const stateBefore = readFileSync(new URL('update-state.json', s.root), 'utf8');
      await s.run({ TICKERS: 'BBB', MAX_FETCHES: '1' });
      expect(readFileSync(new URL('update-state.json', s.root), 'utf8')).toBe(stateBefore);
      await s.run({ AUM: '1T:' }); // nothing passes the catalog filter; no fund counts against MAX_FETCHES
      expect(s.state().cursor).toBeNull();
    });
  });

  test('return filters exclude funds whose value for a bounded range is unavailable', async () => {
    await withScenario(async (s) => {
      const base = s.handler;
      // the page publishes no 10-year figure, so the 10-year CAGR is null for every fund
      s.handler = (url, init) => (url.startsWith('https://r.jina.ai/') && !url.endsWith('/us/products') ? new Response(productPage('AAA').replace('| 2.52% |', '| — |')) : base(url, init));
      await s.run({ PERFORMANCE_10Y: '0:', SKIP_YAHOO: 'true' });
      expect(s.logs.filter((l) => l.includes('skipped')).length).toBe(3);
    });
  });

  test('unknown TICKERS is an error', async () => {
    await withScenario(async (s) => {
      await expect(s.run({ TICKERS: 'AAA ZZZ' })).rejects.toThrow('unknown ticker ZZZ');
    });
  });

  test('a run where every fund failed to get live data exits non-zero', async () => {
    await withScenario(async (s) => {
      await s.run();
      s.handler = (url, init) => new Response('down', { status: 500 });
      process.exitCode = 0;
      await s.run();
      expect(process.exitCode).toBe(1);
    });
  });
});

describe('write only on change, atomically, in order', () => {
  test('a rerun with identical upstream data rewrites nothing', async () => {
    await withScenario(async (s) => {
      await s.run();
      const first = s.snapshot();
      await new Promise((resolve) => setTimeout(resolve, 20));
      await s.run();
      expect(s.snapshot()).toEqual(first);
      expect(Object.keys(first).some((path) => path.includes('.tmp-'))).toBe(false);
    });
  });

  test('stale page files are removed once the new meta.json is written', async () => {
    await withScenario(async (s) => {
      await s.run({ HISTORY_PAGE_SIZE: '100' });
      const pages = readdirSync(new URL('funds/AAA/history/', s.root));
      expect(pages).toContain('004.json');
      await s.run({ HISTORY_PAGE_SIZE: '1000' });
      expect(readdirSync(new URL('funds/AAA/history/', s.root))).toEqual(['001.json']);
      expect(s.meta('AAA').history.pages).toEqual(['history/001.json']);
    });
  });

  test('the run stops taking new funds at the soft deadline and still writes the index', async () => {
    await withScenario(async (s) => {
      await s.run({}, {}, 0);
      expect(existsSync(new URL('index.json', s.root).pathname.replace('file://', ''))).toBe(true);
    }, ['AAA', 'BBB']);
  });
});

describe('index.json contract', () => {
  test('rows get a full metrics key set, TER net and gross, a derived ISIN and dataFile null without meta.json', async () => {
    await withScenario(async (s) => {
      await s.run();
      const row = s.index().funds[0];
      expect(row.terValue).toBe(0.15);
      expect(row.terGrossValue).toBe(0.4);
      expect(row.isin).toBe('US0378331005');
      expect(row.cusip).toBe('037833100');
      expect(row.dataFile).toBe('./funds/AAA/meta.json');
      expect(s.meta('AAA').expenseRatio).toMatchObject({ value: 0.15, grossValue: 0.4 });
      // a published row whose meta.json vanished loses its dataFile but keeps the shape
      rmSync(new URL('funds/BBB/meta.json', s.root));
      await s.run({ TICKERS: 'AAA' });
      const orphan = s.index().funds.find((f: any) => f.ticker === 'BBB');
      expect(orphan.dataFile).toBeNull();
      expect(Object.keys(orphan.metrics)).toEqual(expect.arrayContaining(['ytd', 'tr1y', 'tr3y', 'tr5y', 'tr10y', 'cagr3y', 'cagr5y', 'cagr10y', 'siAnn', 'dividendYield', 'dividendYieldText', 'secYield', 'secYieldText', 'returnsBasis', 'performanceAsOf']));
    });
  });

  test('isinFromCusip follows the ISO 6166 check digit', () => {
    expect(isinFromCusip('037833100')).toBe('US0378331005'); // Apple
    expect(isinFromCusip('594918104')).toBe('US5949181045'); // Microsoft
    expect(isinFromCusip('bad')).toBeNull();
  });

  test('siAnn needs at least one year of history', () => {
    const day = (date: string, close: number) => ({ date, close, adjClose: close, volume: 1 });
    expect(priceReturns([day('2026-06-01', 100), day('2026-09-25', 110)]).siAnn).toBeNull();
    expect(priceReturns([day('2024-09-25', 100), day('2026-09-25', 121)]).siAnn).toBeCloseTo(10, 0);
  });

  test('HISTORY_RANGE reaches the Yahoo URL as explicit period1/period2', async () => {
    await withScenario(async (s) => {
      await s.run({ HISTORY_RANGE: '1y' });
      const yahoo = s.calls.find((c) => c.url.includes('finance.yahoo.com'))!;
      const query = new URL(yahoo.url).searchParams;
      expect(Number(query.get('period1'))).toBeGreaterThan(Date.now() / 1000 - 2 * 365 * 86_400);
      expect(query.has('range')).toBe(false);
    });
  });
});

describe('dates are UTC and zero-padded', () => {
  test('toIsoDate and formatDate do not depend on the machine time zone', () => {
    const original = process.env.TZ;
    try {
      for (const zone of ['Pacific/Auckland', 'America/Los_Angeles', 'UTC']) {
        process.env.TZ = zone;
        expect(toIsoDate('Sep 25 2026')).toBe('2026-09-25');
        expect(toIsoDate('August 31, 2026')).toBe('2026-08-31');
        expect(formatDate('2026-06-04')).toBe('Jun 04 2026');
      }
    } finally {
      if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
    }
  });
});

describe('catalog changes are reported', () => {
  test('NEW FUNDS and DROPPED FUNDS are printed and written to the step summary', async () => {
    await withScenario(async (s) => {
      await s.run();
      s.tickers = ['AAA', 'BBB', 'DDD'];
      const summary = join(s.dir, 'summary.md');
      const original = process.env.GITHUB_STEP_SUMMARY;
      process.env.GITHUB_STEP_SUMMARY = summary;
      try { await s.run({ TICKERS: 'AAA' }); } finally { if (original === undefined) delete process.env.GITHUB_STEP_SUMMARY; else process.env.GITHUB_STEP_SUMMARY = original; }
      expect(s.logs.some((l) => l.includes('NEW FUNDS: DDD'))).toBe(true);
      expect(s.logs.some((l) => l.includes('DROPPED FUNDS: CCC'))).toBe(true);
      expect(readFileSync(summary, 'utf8')).toContain('NEW FUNDS: DDD');
      expect(s.index().funds.map((f: any) => f.ticker)).toContain('CCC'); // the delisted fund's data is kept
    });
  });

  test('STORE_RAW_DOWNLOADS writes outside the committed api folder', async () => {
    await withScenario(async (s) => {
      await s.run({ STORE_RAW_DOWNLOADS: 'true' });
      expect(readdirSync(join(s.dir, 'data/raw')).some((name) => name.startsWith('product-table-'))).toBe(true);
      expect(existsSync(join(s.dir, 'api/wisdomtree/raw'))).toBe(false);
    });
  });
});

describe('concurrency is real', () => {
  async function peak(concurrency: number): Promise<number> {
    let inFlight = 0;
    let max = 0;
    const s = new Scenario(['AAA', 'BBB', 'CCC', 'DDD']);
    try {
      const base = s.handler;
      s.handler = async (url) => {
        if (!url.includes('finance.yahoo.com')) return base(url);
        inFlight += 1; max = Math.max(max, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 40));
        inFlight -= 1;
        return base(url);
      };
      await s.run({ CONCURRENCY: String(concurrency) });
    } finally { s.cleanup(); }
    return max;
  }
  test('peak in-flight requests is 1 at CONCURRENCY=1 and N at N', async () => {
    expect(await peak(1)).toBe(1);
    expect(await peak(3)).toBe(3);
  });
});
