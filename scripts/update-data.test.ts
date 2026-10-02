// Bun's test runner provides these globals at runtime.
// @ts-ignore the repository intentionally keeps runtime dependencies at zero.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
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
  HISTORY_RANGES,
  resolveControls,
  runtimeControls,
  yahooChartQuery,
  isCertError,
  installSystemCa,
} from './update-data';

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
  test('max requests everything, any other range replaces period1/period2', () => {
    const full = yahooChartQuery('max', 1_000_000);
    expect(full.get('period1')).toBe('0');
    expect(full.get('period2')).toBe(String(1_000_000 + 86_400));
    expect(full.has('range')).toBe(false);
    const limited = yahooChartQuery('5y', 1_000_000);
    expect(limited.get('range')).toBe('5y');
    expect(limited.has('period1')).toBe(false);
    expect(limited.has('period2')).toBe(false);
    expect(limited.get('events')).toBe('div|split');
  });

  test('only Yahoo ranges are accepted, case-insensitively', () => {
    for (const range of HISTORY_RANGES) expect(readConfig(resolveControls({ HISTORY_RANGE: range })).historyRange).toBe(range);
    expect(readConfig(resolveControls({ HISTORY_RANGE: '5Y' })).historyRange).toBe('5y');
    expect(() => resolveControls({ HISTORY_RANGE: '7y' })).toThrow('HISTORY_RANGE');
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
