// Bun's test runner provides these globals at runtime.
// @ts-ignore the repository intentionally keeps runtime dependencies at zero.
import { describe, expect, test } from 'bun:test';
import {
  annualizedToTotal,
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
  toIsoDate,
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
