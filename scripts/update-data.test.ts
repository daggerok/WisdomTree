/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CONTROL_NAMES, HISTORY_RANGE_PATTERN, RETURNS_BASIS_DERIVED, RETURNS_BASIS_OFFICIAL,
  annualizedToTotal, cleanHoldingTicker, deriveMetrics, dividendYieldBasisFromKind, formatDate, hasConfiguredFilters, inferDistributionFrequency, installSystemCa,
  isCertError, isinFromCusip, looksLikeProductPage, mergeDistributionRecords, normalizeHoldingName, nportUrlFor, numberOrNull, parseAumRange,
  parseCatalogMarkdown, parseChart, parseEdgarAtomFilings, parseFundTickerMap, parseNport, parseOfficialDistributions,
  parseProductPageSummary, parseRange, parseRanges, performanceAsOfDate, priceReturns, readConfig, readKnownRows, resolveControls,
  rowFromMeta, runUpdate, runtimeControls, setApiRoot, toIsoDate, writeIndex, yahooChartQuery,
} from './update-data';

// ---------------------------------------------------------------------------
// Shared setup: clean environment, pinned TZ, restored fetch / exit code / console / api root
// ---------------------------------------------------------------------------
const scriptsDir = new URL('.', import.meta.url).pathname;
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const configFile = (): Record<string, string> => JSON.parse(read('scripts/update-data.config.json'));
const realFetch = globalThis.fetch;
const realExitCode = process.exitCode;
const realConsole = { log: console.log, warn: console.warn, error: console.error };
const realSetTimeout = globalThis.setTimeout;
const defaultRoot = new URL('../api/wisdomtree/', import.meta.url);
const savedEnv = { ...process.env };
const tempDirs: string[] = [];
const isControlVar = (key: string): boolean =>
  (CONTROL_NAMES as readonly string[]).includes(key) || key.startsWith('WISDOMTREE_') || key === 'HISTORICAL_PAGE_SIZE' || ['NODE_USE_SYSTEM_CA', 'ETF_UPDATER_SYSTEM_CA', 'GITHUB_STEP_SUMMARY'].includes(key);

beforeEach(() => {
  for (const key of Object.keys(process.env)) if (isControlVar(key)) delete process.env[key];
  process.env.TZ = 'UTC';
});
afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.setTimeout = realSetTimeout;
  process.exitCode = realExitCode ?? 0;
  Object.assign(console, realConsole);
  setApiRoot(defaultRoot);
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Small inline samples (tables as the r.jina.ai markdown rendering delivers them)
// ---------------------------------------------------------------------------
const catalogFixture = [
  '# WisdomTree U.S. Products', '', 'As of 9/15/2026',
  '| WisdomTree Fund | Fund Ticker | Asset Class | Category | Inception Date | Gross Expense Ratio | Net Expense Ratio | Assets Under Mgmt $(000) | TTM Yield | Average Daily Volume |',
  '| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: |',
  '| [WisdomTree Floating Rate Treasury Fund](https://www.wisdomtree.com/investments/etfs/fixed-income/usfr) | [$USFR](https://www.wisdomtree.com/investments/etfs/fixed-income/usfr) | Fixed Income | Treasury / Government | 12/11/2014 | 0.15% | 0.15% | $16,985,696.89 | 4.72% | $100,000,000 |',
  '| [WisdomTree Efficient Gold Plus Equity Strategy Fund](https://www.wisdomtree.com/investments/etfs/alternative/gde) | [$GDE](https://www.wisdomtree.com/investments/etfs/alternative/gde) | Alternative | Commodities | 06/05/2024 | 0.75% | 0.75% | $1,234.50 | — | $1,000,000 |',
].join('\n');
const usfrPage = `# USFR WisdomTree Floating Rate Treasury Fund\n\n### 3.68%\n\n30-day SEC yield\n\nAs of 9/15/2026\n\n| Product Overview | As of 9/16/2026 |\n| --- | --- |\n| Expense Ratio | 0.15% |\n| CUSIP | 97717Y527 |\n| Total Assets (000) | $19,560,180.26 |\n| SEC 30-day Yield | 3.68% |\n\n### Net Asset Value\n\n| Net Asset Value | As of 9/16/2026 |\n| --- | --- |\n| NAV | $50.476 |\n| Premium/Discount to NAV | 0.01% |\n\n### Closing Market Price\n\n| Closing Market Value | As of 9/15/2026 |\n| --- | --- |\n| Closing Market Price | $50.470 |\n\n### Total Returns\n\nMonth End Performance (8/31/2026)\n\n| Cumulative | 1 Month | 3 Month | YTD | Since Inception* | |\n| --- | --- | --- | --- | --- | --- |\n| Underlying Index Returns | 0.33% | 1.04% | 2.70% | 30.94% | |\n| NAV Returns | 0.32% | 1.00% | 2.57% | 28.21% | |\n| Market Price Returns | 0.32% | 1.02% | 2.59% | 28.05% | |\n| Average Annual | 1 Year | 3 Year | 5 Year | 10 Year | Since Inception* |\n| Underlying Index Returns | 4.18% | 4.84% | 4.04% | 2.67% | 2.17% |\n| NAV Returns | 3.98% | 4.66% | 3.86% | 2.49% | 2.00% |\n| Market Price Returns | 4.00% | 4.65% | 3.86% | 2.52% | 1.99% |\n\nQuarter End Performance (6/30/2026)\n\n| Cumulative | Since Inception* |  |  |  |  |\n| --- | --- | --- | --- | --- | --- |\n| Underlying Index Returns | 30.04% |  |  |  |  |\n| NAV Returns | 27.37% |  |  |  |  |\n| Market Price Returns | 27.19% |  |  |  |  |\n| Average Annual | 1 Year | 3 Year | 5 Year | 10 Year | Since Inception* |\n| Underlying Index Returns | 4.30% | 4.90% | 4.10% | 2.70% | 2.20% |\n| NAV Returns | 4.10% | 4.70% | 3.90% | 2.50% | 2.02% |\n| Market Price Returns | 4.12% | 4.69% | 3.90% | 2.53% | 2.01% |`;
const DIST_HEADER = '| Ex-Dividend Date | Record Date | Payable Date | Ordinary Income | Short Term Capital Gains | Long Term Capital Gains | Return of Capital | Total Distribution |\n| --- | --- | --- | --- | --- | --- | --- | --- |';
const distPage = (...rows: string[]) => `### Recent Distributions\n\n${DIST_HEADER}\n${rows.join('\n')}\n\n### Thought Leadership\n\n| Name | Ticker |\n| --- | --- |\n| unrelated | table |`;

// ===========================================================================
describe('controls', () => {
  test('precedence: file < advanced < nonblank input < env; blank input inherits, advanced and explicit-empty env clear', () => {
    const c = resolveControls({ CONCURRENCY: 2, TICKERS: 'DGRW' }, { CONCURRENCY: 3, TICKERS: 'USFR' }, { CONCURRENCY: '4', TICKERS: '' }, { CONCURRENCY: '5' });
    expect([c.CONCURRENCY, c.TICKERS]).toEqual(['5', 'USFR']);
    expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }).CONCURRENCY).toBe('4');
    expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }).CONCURRENCY).toBe('3');
    expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }).CONCURRENCY).toBe('2');
    expect(resolveControls({ TICKERS: 'DGRW' }, {}, { TICKERS: '' }).TICKERS).toBe('DGRW');
    expect(resolveControls({ TICKERS: 'DGRW' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
    expect(resolveControls({ TICKERS: 'DGRW' }, {}, {}, { TICKERS: '' }).TICKERS).toBe('');
    expect(resolveControls({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }).SKIP_YAHOO).toBe('false');
  });

  test('strict validation: bad ranges, HISTORY_RANGE, MAX_RETRIES < 1, unknown keys, non-scalars, booleans, CR/LF/NUL', () => {
    for (const value of [
      { UNKNOWN: 1 }, { SEC_UA: 'x\nEVIL=yes' }, { SEC_UA: 'x\rfoo' }, { SEC_UA: 'x\0bad' }, { CONCURRENCY: 0 }, { MAX_RETRIES: 0 }, { MAX_RETRIES: -1 },
      { MAX_FETCHES: 1.5 }, { REQUEST_SLEEP: '-1' }, { VERBOSE: 'maybe' }, { USE_SYSTEM_CA: 'maybe' }, { EDGAR_FALLBACK: 'maybe' }, { AUM: '1:2:3' },
      { TER: '5:1' }, { SEC_YIELD: '5' }, { PERFORMANCE_1Y: '5' }, { TICKERS: ['DGRW'] }, { TICKERS: { a: 1 } }, null, [],
    ]) {
      expect(() => resolveControls(value)).toThrow();
      if (value && !Array.isArray(value)) expect(() => resolveControls({}, value)).toThrow();
    }
    expect(() => resolveControls({}, {}, { TICKERS: 'A\nB' })).toThrow();
    expect(() => resolveControls({}, {}, {}, { MAX_RETRIES: '0' })).toThrow();
    expect(() => resolveControls({}, 'x')).toThrow();
    for (const [text, value] of [['n', false], ['no', false], ['off', false], ['0', false], ['false', false], ['y', true], ['on', true], ['1', true]] as const) {
      expect(readConfig(resolveControls({ EDGAR_FALLBACK: text })).edgarFallback).toBe(value);
    }
  });

  test('HISTORY_RANGE is max or whole years, case-insensitive, strictly validated', () => {
    for (const range of ['max', '1y', '5y', '10y']) expect(readConfig(resolveControls({ HISTORY_RANGE: range })).historyRange).toBe(range);
    expect(readConfig(resolveControls({ HISTORY_RANGE: '5Y' })).historyRange).toBe('5y');
    expect(HISTORY_RANGE_PATTERN.test('0y')).toBe(false);
    for (const bad of ['7d', 'ytd', '6mo', '0y', 'y', '5', '-1y', '1.5y']) expect(() => resolveControls({ HISTORY_RANGE: bad })).toThrow('HISTORY_RANGE');
  });

  test('brand env aliases (WISDOMTREE_<NAME>, HISTORICAL_PAGE_SIZE) sit in the env layer, the plain name wins, validation stays strict', () => {
    expect(resolveControls({}, {}, {}, { WISDOMTREE_CONCURRENCY: '7' }).CONCURRENCY).toBe('7');
    expect(resolveControls({}, {}, {}, { HISTORICAL_PAGE_SIZE: '500' }).HISTORY_PAGE_SIZE).toBe('500');
    expect(resolveControls({ TICKERS: 'DGRW' }, {}, { TICKERS: 'USFR' }, { WISDOMTREE_TICKERS: 'GDE' }).TICKERS).toBe('GDE');
    expect(resolveControls({}, {}, {}, { WISDOMTREE_CONCURRENCY: '7', CONCURRENCY: '2' }).CONCURRENCY).toBe('2');
    expect(resolveControls({}, {}, {}, { HISTORY_PAGE_SIZE: '300', HISTORICAL_PAGE_SIZE: '500' }).HISTORY_PAGE_SIZE).toBe('300');
    expect(resolveControls({ TICKERS: 'DGRW' }, {}, {}, { WISDOMTREE_TICKERS: '' }).TICKERS).toBe('');
    for (const env of [{ WISDOMTREE_CONCURRENCY: '0' }, { HISTORICAL_PAGE_SIZE: 'x' }, { WISDOMTREE_SEC_UA: 'a\nb' }, { WISDOMTREE_HISTORY_RANGE: 'weekly' }, { WISDOMTREE_MAX_RETRIES: '0' }]) {
      expect(() => resolveControls({}, {}, {}, env)).toThrow();
    }
  });

  test('config file: keys equal CONTROL_NAMES and --help, values are strings, the scheduled path equals the defaults', async () => {
    const file = configFile();
    expect(Object.keys(file).sort()).toEqual([...CONTROL_NAMES].sort());
    for (const value of Object.values(file)) expect(typeof value).toBe('string');
    expect(resolveControls(file, {}, {}, {})).toEqual(file);
    expect(await runtimeControls({})).toEqual(resolveControls(file));
    expect((await runtimeControls({ CONCURRENCY: '7' })).CONCURRENCY).toBe('7');
    const child = Bun.spawn([process.execPath, join(scriptsDir, 'update-data.ts'), '--help'], {
      cwd: tmpdir(), stdout: 'pipe', stderr: 'pipe', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
    });
    const help = await new Response(child.stdout).text();
    await child.exited;
    for (const name of CONTROL_NAMES) {
      const t = name.match(/^(PERFORMANCE|TOTAL_RETURN)_/);
      expect(help).toContain(t ? `${t[1]}_YTD|1Y|3Y|5Y|10Y` : `  ${name}=`);
    }
    const config = readConfig(resolveControls(file));
    expect([config.maxFetches, config.requestSleep, config.concurrency, config.maxRetries, config.tickers, config.historyRange]).toEqual([0, 2, 2, 2, null, 'max']);
    expect([config.edgarFallback, config.skipYahoo, config.skipWisdomTree, config.storeRawDownloads, config.aum, config.secYield]).toEqual([true, false, false, false, undefined, undefined]);
  });

  test('SEC_UA defaults to the daggerok contact (never example.com), a protected value wins', () => {
    expect(configFile().SEC_UA).toBe('daggerok ETF feed daggerok@gmail.com');
    expect(readConfig(resolveControls(configFile())).secUa).toBe(configFile().SEC_UA);
    expect(read('scripts/update-data.ts')).not.toMatch(/example\.com|admin@/);
    expect(resolveControls(configFile(), { SEC_UA: 'adv' }, { SEC_UA: 'in' }, { SEC_UA: 'protected' }).SEC_UA).toBe('protected');
  });

  test('range parsers keep inclusive bounds, AUM takes dollar suffixes and presets, colon defaults mean no filter', () => {
    expect([parseRange('', 'X'), parseRange(':', 'X'), parseRange('0.1%:0.5%', 'X'), parseRange('2:', 'X')]).toEqual([undefined, undefined, { min: 0.1, max: 0.5 }, { min: 2, max: undefined }]);
    expect(() => parseRange('5:1', 'X')).toThrow(/must not exceed/);
    expect(() => parseRange('5', 'X')).toThrow(/colon is required/);
    expect([parseAumRange('10M:2B'), parseAumRange('large'), parseAumRange('micro')]).toEqual([{ min: 10_000_000, max: 2_000_000_000 }, { min: 10_000_000_000, max: undefined }, { min: 10_000_000, max: 300_000_000 }]);
    expect(() => parseAumRange('42')).toThrow(/colon is required/);
    const none = readConfig({ AUM: ':', TER: ':', DIVIDEND_YIELD: ':', SEC_YIELD: ':', TICKERS: '', PERFORMANCE_YTD: ':', TOTAL_RETURN_10Y: ':' });
    expect([parseRanges({ PERFORMANCE_YTD: ':', PERFORMANCE_1Y: ':' }, 'PERFORMANCE'), hasConfiguredFilters(none)]).toEqual([{}, false]);
    const secYield = readConfig(resolveControls({ SEC_YIELD: '3:5' }));
    expect(secYield.secYield).toEqual(expect.objectContaining({ min: 3, max: 5 }));
    expect(hasConfiguredFilters(secYield)).toBe(true);
  });

  test('USE_SYSTEM_CA: auto by default, case-insensitive, restart only on certificate errors', async () => {
    expect(resolveControls(configFile()).USE_SYSTEM_CA).toBe('auto');
    for (const mode of ['auto', 'true', 'false', 'TRUE', 'Auto']) expect(resolveControls(configFile(), {}, {}, { USE_SYSTEM_CA: mode }).USE_SYSTEM_CA).toBe(mode.toLowerCase());
    expect(isCertError({ code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' })).toBe(true);
    expect(isCertError(new Error('fetch failed', { cause: new Error('unable to get local issuer certificate') }))).toBe(true);
    expect([isCertError({ code: 'ECONNRESET' }), isCertError(new Error('HTTP 403 for https://example.test'))]).toEqual([false, false]);
    console.error = () => {};
    let calls = 0;
    const reexec = (() => { calls += 1; throw new Error('reexec'); }) as () => never;
    installSystemCa('false', reexec, false);
    installSystemCa('auto', reexec, true);
    expect(globalThis.fetch).toBe(realFetch);
    expect(() => installSystemCa('true', reexec, false)).toThrow('reexec');
    globalThis.fetch = (async () => { throw new Error('connection reset'); }) as unknown as typeof fetch;
    installSystemCa('auto', reexec, false);
    await expect(fetch('https://x.test')).rejects.toThrow('connection reset');
    expect(calls).toBe(1);
    globalThis.fetch = (async () => { throw Object.assign(new Error('x'), { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' }); }) as unknown as typeof fetch;
    installSystemCa('auto', reexec, false);
    await expect(fetch('https://x.test')).rejects.toThrow('reexec');
    expect(calls).toBe(2);
  });
});

// ===========================================================================
describe('parsing', () => {
  test('catalog table: rows, links, as-of date and AUM $(000); unavailable yield stays null; a table without fund rows is rejected', () => {
    const funds = parseCatalogMarkdown(catalogFixture);
    expect(funds.map((row) => row.ticker)).toEqual(['GDE', 'USFR']);
    const usfr = funds.find((row) => row.ticker === 'USFR')!;
    expect([usfr.netAssets, usfr.dividendYield, usfr.asOfDate, usfr.inception, usfr.fundPage]).toEqual([16_985_696_890, 4.72, '2026-09-15', '2014-12-11', 'https://www.wisdomtree.com/us/products/fixed-income/usfr']);
    const gde = funds.find((row) => row.ticker === 'GDE')!;
    expect([gde.dividendYield, gde.category, gde.ter]).toEqual([null, 'Alternative', 0.75]);
    expect(() => parseCatalogMarkdown('| WisdomTree Fund | Fund Ticker | a | b | c | d | e | f | g | h |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n')).toThrow('no fund rows found');
  });

  test('product page: NAV, market price, SEC yield, CUSIP; NAV and index rows sit beside the primary Market Price Returns row', () => {
    const parsed = parseProductPageSummary(usfrPage);
    expect(parsed).toMatchObject({ name: 'WisdomTree Floating Rate Treasury Fund', cusip: '97717Y527', nav: 50.476, marketPrice: 50.47, premiumDiscount: 0.01, secYield: 3.68, totalAssets: 19560180260 });
    expect(parsed.navAsOfDate).toBe('2026-09-16');
    const monthEnd = parsed.officialReturns.monthEnd!;
    expect(monthEnd).toMatchObject({ asOfDate: '2026-08-31', mo1: 0.32, qtd: 1.02, ytd: 2.59, yr1: 4.00, cagr3y: 4.65, cagr5y: 3.86, cagr10y: 2.52, siAnn: 1.99 });
    expect(monthEnd.navReturns).toMatchObject({ mo1: 0.32, qtd: 1.00, ytd: 2.57, yr1: 3.98, cagr3y: 4.66, siAnn: 2.00 });
    expect(monthEnd.indexReturns).toMatchObject({ mo1: 0.33, qtd: 1.04, ytd: 2.70, yr1: 4.18, cagr3y: 4.84, siAnn: 2.17 });
  });

  test('the quarter-end cumulative row with blank trailing cells parses to null, never NaN or 0; market-price-only tables leave NAV and index rows null', () => {
    const quarterEnd = parseProductPageSummary(usfrPage).officialReturns.quarterEnd!;
    expect([quarterEnd.mo1, quarterEnd.qtd]).toEqual([27.19, null]);
    expect(quarterEnd.navReturns).toMatchObject({ mo1: 27.37, qtd: null, ytd: null, yr1: 4.10, cagr3y: 4.70, siAnn: 2.02 });
    expect(quarterEnd.indexReturns).toMatchObject({ mo1: 30.04, qtd: null, ytd: null, yr1: 4.30, cagr3y: 4.90, siAnn: 2.20 });
    const marketOnly = '# GDE WisdomTree Efficient Gold Plus Equity Strategy Fund\n\n### Total Returns\n\nMonth End Performance (8/31/2026)\n\n| Cumulative | 1 Month | 3 Month | YTD | Since Inception* | |\n| --- | --- | --- | --- | --- | --- |\n| Market Price Returns | 1.00% | 2.00% | 3.00% | 4.00% | |';
    expect(parseProductPageSummary(marketOnly).officialReturns.monthEnd).toMatchObject({ mo1: 1.00, navReturns: null, indexReturns: null });
  });

  test('official distributions: dates and the full tax-character breakdown, blank cells are null, no section is an empty list', () => {
    const rows = parseOfficialDistributions(distPage('| 9/25/2026 | 9/25/2026 | 9/29/2026 | $0.17000 | $0.00000 | $0.00000 | $0.00000 | $0.17000 |', '| 8/26/2026 | 8/26/2026 | 8/28/2026 | $0.05500 | $0.00000 | $0.00000 | $0.00000 | $0.05500 |'));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ exDate: '2026-09-25', recordDate: '2026-09-25', payableDate: '2026-09-29', ordinaryIncome: 0.17, shortTermCapitalGains: 0, longTermCapitalGains: 0, returnOfCapital: 0, total: 0.17 });
    expect(rows[1].exDate).toBe('2026-08-26');
    const sparse = parseOfficialDistributions(distPage('| 3/25/2020 | 3/25/2020 | 3/27/2020 | $0.05000 |  |  |  | $0.05000 |', '| 12/24/2019 | 12/24/2019 | 12/26/2019 | — | — | — | — | — |'));
    expect(sparse[0]).toMatchObject({ ordinaryIncome: 0.05, shortTermCapitalGains: null, longTermCapitalGains: null, returnOfCapital: null, total: 0.05 });
    expect(sparse[1]).toMatchObject({ ordinaryIncome: null, shortTermCapitalGains: null, longTermCapitalGains: null, returnOfCapital: null, total: null });
    expect(parseOfficialDistributions('# GDE\n\n### Total Returns\n\nno distributions section here')).toEqual([]);
  });

  test('official-first distributions merge: the official row wins, Yahoo only fills older ex-dates and funds without an official table', () => {
    const official = parseOfficialDistributions(distPage('| 9/25/2026 | 9/25/2026 | 9/29/2026 | $0.17000 | $0.00000 | $0.00000 | $0.00000 | $0.17000 |'));
    const overlap = mergeDistributionRecords(official, [{ epoch: Date.UTC(2026, 8, 25) / 1000, amount: 0.169 }]);
    expect([overlap.rows.length, overlap.yahooOnlyCount, overlap.rows[0]]).toEqual([1, 0, expect.objectContaining({ total: 0.17, ordinaryIncome: 0.17 })]);
    const older = mergeDistributionRecords(official, [{ epoch: Date.UTC(2013, 5, 20) / 1000, amount: 0.05 }, { epoch: Date.UTC(2026, 8, 25) / 1000, amount: 0.169 }]);
    expect([older.rows.length, older.yahooOnlyCount]).toEqual([2, 1]);
    expect(older.rows[0]).toMatchObject({ exDate: '2013-06-20', total: 0.05, ordinaryIncome: null });
    expect(older.rows[1]).toMatchObject({ exDate: '2026-09-25', total: 0.17 });
    const none = mergeDistributionRecords([], [{ epoch: Date.UTC(2026, 5, 25) / 1000, amount: 0.16 }, { epoch: Date.UTC(2026, 6, 28) / 1000, amount: 0.065 }]);
    expect([none.yahooOnlyCount, none.rows.map((row) => row.total), none.rows.every((row) => row.ordinaryIncome === null)]).toEqual([2, [0.16, 0.065], true]);
  });

  test('SEC: compact mutual-fund ticker schema, raw submission XML (not the EDGAR header), Atom keeps N-PORT-P without amendments', () => {
    const map = parseFundTickerMap({ fields: ['cik', 'seriesId', 'classId', 'symbol'], data: [['1350487', 'S000043966', 'C000136444', 'USFR']] });
    expect(map.get('USFR')).toEqual({ cik: '0001350487', seriesId: 'S000043966', classId: 'C000136444' });
    expect(nportUrlFor('0001350487', '0000940400-26-028883')).toContain('/1350487/000094040026028883/0000940400-26-028883.txt');
    const parsed = parseNport(`<edgarSubmission><genInfo><regName>WisdomTree Trust</regName><regCik>0001350487</regCik><repPdDate>2026-05-31</repPdDate><seriesName>WisdomTree Floating Rate Treasury Fund</seriesName><seriesId>S000043966</seriesId></genInfo><fundInfo><netAssets>16985696887.65</netAssets></fundInfo><invstOrSecs><invstOrSec><name>UNITED STATES OF AMERICA</name><cusip>91282CPX3</cusip><pctVal>27.91</pctVal><valUSD>4740918723.73</valUSD><balance>4739107200</balance><assetCat>DBT</assetCat><debtSec><annualizedRt>3.694</annualizedRt><maturityDt>2028-01-31</maturityDt></debtSec></invstOrSec></invstOrSecs></edgarSubmission>`);
    expect([parsed.seriesId, parsed.repPdDate, parsed.netAssets, parsed.holdings.length]).toEqual(['S000043966', '2026-05-31', 16985696887.65, 1]);
    expect(parsed.holdings[0]).toMatchObject({ Identifier: '91282CPX3', Weight: '27.91', Coupon: '3.694', Maturity: '2028-01-31' });
    const atom = `<feed><entry><filing-type>NPORT-P</filing-type><accession-number>0000000000-26-000001</accession-number><filing-date>2026-07-30</filing-date><filing-href>https://www.sec.gov/Archives/edgar/data/1350487/000000000026000001/x.txt</filing-href></entry><entry><filing-type>NPORT-P</filing-type><amend> </amend><accession-number>bad</accession-number></entry><entry><filing-type>NPORT-N</filing-type><accession-number>ignored</accession-number></entry></feed>`;
    expect(parseEdgarAtomFilings(atom)).toHaveLength(1);
    expect(parseEdgarAtomFilings(atom)[0].url).toContain('0000000000-26-000001.txt');
  });

  test('Yahoo chart: close, adjusted close and dividends', () => {
    const parsed = parseChart({ chart: { result: [{ timestamp: [Date.UTC(2025, 0, 2) / 1000, Date.UTC(2025, 0, 3) / 1000], indicators: { quote: [{ close: [10, 11], volume: [100, 200] }], adjclose: [{ adjclose: [9, 10] }] }, events: { dividends: { '1735776000': { amount: 0.25 } } }, meta: { regularMarketPrice: 11, exchangeName: 'NYSEArca' } }] } });
    expect(parsed.days[1]).toMatchObject({ date: '2025-01-03', close: 11, adjClose: 10, volume: 200 });
    expect([parsed.dividends[0].amount, parsed.exchangeName]).toEqual([0.25, 'NYSEArca']);
  });

  test('dates and names normalize: UTC dates in any zone, issuer names, ISIN from the CUSIP check digit', () => {
    for (const zone of ['Pacific/Auckland', 'America/Los_Angeles', 'UTC']) {
      process.env.TZ = zone;
      expect([toIsoDate('Sep 25 2026'), toIsoDate('August 31, 2026'), toIsoDate('09/15/2026'), formatDate('2026-06-04')]).toEqual(['2026-09-25', '2026-08-31', '2026-09-15', 'Jun 04 2026']);
    }
    expect(['abc', '', '—', 'n/a', null, undefined].map((value) => numberOrNull(value))).toEqual([null, null, null, null, null, null]);
    expect([numberOrNull('0'), numberOrNull('(1.5%)'), numberOrNull('$1,234.50')]).toEqual([0, -1.5, 1234.5]);
    expect(normalizeHoldingName('Apple Inc. Class A')).toContain('APPLE');
    expect(normalizeHoldingName("McDonald's Corp.")).toBe('MCDONALDS');
    expect([cleanHoldingTicker('n/a'), cleanHoldingTicker(' MSFT ')]).toEqual(['', 'MSFT']);
    expect([isinFromCusip('037833100'), isinFromCusip('594918104'), isinFromCusip('bad')]).toEqual(['US0378331005', 'US5949181045', null]);
  });

  test('a Cloudflare verification page served with HTTP 200 is not a product page', () => {
    expect(looksLikeProductPage('Title: Just a moment...\n\n## Performing security verification')).toBe(false);
    expect(looksLikeProductPage(usfrPage)).toBe(true);
  });
});

// ===========================================================================
describe('metrics', () => {
  const day = (date: string, close: number, adjClose = close) => ({ date, close, adjClose, volume: 1 });

  test('returns use adjusted closes, annualized values convert to cumulative', () => {
    const result = priceReturns([day('2024-01-02', 100), day('2025-01-02', 110, 115), day('2026-01-02', 121, 132.25)], new Date('2026-01-03T00:00:00Z'));
    expect(result.yr1).toBe(32.25);
    expect(annualizedToTotal(10, 3)).toBe(33.1);
  });

  test('siAnn needs at least one year of history (null, never 0), a flat young fund keeps null horizons', () => {
    expect(priceReturns([day('2026-06-01', 100), day('2026-09-25', 110)]).siAnn).toBeNull();
    expect(priceReturns([day('2024-09-25', 100), day('2026-09-25', 121)]).siAnn).toBeCloseTo(10, 0);
    const young = priceReturns([day('2026-06-01', 100), day('2026-09-25', 110)], new Date('2026-09-26T00:00:00Z'));
    expect([young.yr1, young.cagr3y, young.cagr5y, young.cagr10y]).toEqual([null, null, null, null]);
  });

  test('metrics end with returnsBasis then performanceAsOf, official and derived bases travel with their own date', () => {
    const days = [day('2025-01-02', 100), day('2026-01-02', 110)];
    const fund = { dividendYield: null, secYield: null } as any;
    const derived = priceReturns(days, new Date('2026-01-03T00:00:00Z'));
    const estimated = deriveMetrics(derived, fund, [], { paymentsPerYear: null }, 110);
    expect([estimated.returnsBasis, estimated.performanceAsOf]).toEqual([RETURNS_BASIS_DERIVED, '2026-01-02']);
    expect(Object.keys(estimated).slice(-2)).toEqual(['returnsBasis', 'performanceAsOf']);
    const official = deriveMetrics({ ...derived, asOfDate: '2025-12-31' }, fund, [], { paymentsPerYear: null }, 110, true);
    expect([official.returnsBasis, official.performanceAsOf]).toEqual([RETURNS_BASIS_OFFICIAL, '2025-12-31']);
    expect(performanceAsOfDate({ ...derived, asOfDate: '' })).toBeNull();
    expect(estimated.ytd).not.toBe(0);
  });

  test('dividendYieldBasis maps each yield source to a code and is null with a null yield', () => {
    const derived = priceReturns([day('2025-01-02', 100), day('2026-01-02', 110)], new Date('2026-01-03T00:00:00Z'));
    const dividends = [0, 1, 2].map((month) => ({ epoch: Date.UTC(2026, month, 15) / 1000, amount: 0.1 }));
    const basis = (fund: any, rows = dividends) => deriveMetrics(derived, { secYield: null, ...fund }, rows, { paymentsPerYear: rows.length ? 12 : null }, 100).dividendYieldBasis;
    expect(basis({ dividendYield: 4.72 })).toBe('official-trailing-12m');
    expect(basis({ dividendYield: 0 })).toBe('official-trailing-12m');
    expect(basis({ dividendYield: null })).toBe('indicated');
    expect(basis({ dividendYield: null }, [])).toBeNull();
    expect(basis({ dividendYield: 3, dividendYieldBasis: 'indicated' })).toBe('indicated');
    expect(dividendYieldBasisFromKind('official-trailing-12m', 1)).toBe('official-trailing-12m');
    expect(dividendYieldBasisFromKind('whatever', 1)).toBe('indicated');
    expect(dividendYieldBasisFromKind('official-trailing-12m', null)).toBeNull();
  });

  test('dividendYieldBasis is on rebuilt rows too (code follows the stored kind, null with a null yield)', () => {
    const meta = (yields: any) => ({ ticker: 'AAA', name: 'A', yields, aum: {}, returns: {}, distributions: { rows: [] }, holdings: {}, history: {} });
    expect(rowFromMeta(meta({ dividendYield: 2, dividendYieldKind: 'trailing 12-month, published by WisdomTree catalog (a published 0.00% is kept as published)' })).metrics.dividendYieldBasis).toBe('official-trailing-12m');
    expect(rowFromMeta(meta({ dividendYield: 2, dividendYieldBasis: 'indicated' })).metrics.dividendYieldBasis).toBe('indicated');
    const none = rowFromMeta(meta({ dividendYield: null }));
    expect([none.metrics.dividendYield, none.metrics.dividendYieldBasis]).toEqual([null, null]);
  });

  test('distribution frequency is inferred like in every sibling updater', () => {
    const monthly = [0, 1, 2, 3].map((month) => ({ epoch: Date.UTC(2026, month, 15) / 1000, amount: 0.1 }));
    expect(inferDistributionFrequency(monthly)).toEqual({ frequency: 'Monthly', paymentsPerYear: 12 });
    expect(inferDistributionFrequency([])).toEqual({ frequency: 'None', paymentsPerYear: null });
  });

  test('rowFromMeta rebuilds the shared row shape, unknown metrics stay null (never 0), the basis follows the source', () => {
    const metaFor = (official: boolean) => ({
      ticker: 'AAA', name: 'Fund AAA', category: 'Domestic Equity', source: { fundPage: 'https://www.wisdomtree.com/us/products/equity/aaa' },
      identifiers: { cusip: '123456789', isin: null }, expenseRatio: { value: 0.28 }, nav: { value: 50 }, marketPrice: { value: 50.5 }, premiumDiscount: { value: 0.1 },
      aum: { value: 1_000_000_000, asOfDate: 'Sep 23 2026' }, yields: { dividendYield: null, secYield: null },
      returns: {
        derivedFrom: official ? 'WisdomTree product-page Market Price Returns' : 'adjusted market-price closes (Yahoo chart API)',
        monthEnd: { asOfDate: 'Aug 31 2026', ytd: 11.49, yr1: 14.75, yr3: null, yr5: null, yr10: null, sinceInception: null },
      },
      distributions: { frequency: 'Monthly', paymentsPerYear: 12, rows: [['06/24/2026', '—', '—', '0.1'], ['07/22/2026', '—', '—', '0.2']] },
      holdings: { pages: [], totalRows: 7 }, history: { pages: [], totalRows: 9 },
    });
    const official = rowFromMeta(metaFor(true));
    expect([official.dataFile, official.metrics.returnsBasis, official.metrics.performanceAsOf]).toEqual(['./funds/AAA/meta.json', RETURNS_BASIS_OFFICIAL, '2026-08-31']);
    expect([official.metrics.cagr3y, official.metrics.tr3y, official.metrics.secYield, official.metrics.dividendYield, official.holdings, official.distributions.exDate]).toEqual([null, null, null, 4.75, 7, '07/22/2026']);
    expect(rowFromMeta(metaFor(false)).metrics.returnsBasis).toBe(RETURNS_BASIS_DERIVED);
    const noDate = rowFromMeta({ ...metaFor(false), returns: { derivedFrom: 'x', monthEnd: { asOfDate: '—' } } });
    expect([noDate.metrics.performanceAsOf, noDate.metrics.ytd]).toEqual([null, null]);
  });
});

// ===========================================================================
// Pipeline: the real runUpdate against a mocked network (wisdomtree.com blocked, r.jina.ai proxy, Yahoo, SEC)
// ===========================================================================
type Call = { url: string; ua: string; at: number };

const productPage = (ticker: string, ytd = '2.59%'): string => [
  `# ${ticker} WisdomTree ${ticker} Fund`, '',
  '| Product Overview | As of 9/16/2026 |', '| --- | --- |', '| Expense Ratio | 0.15% |', '| CUSIP | 037833100 |', '| Total Assets (000) | $19,560,180.26 |', '| SEC 30-day Yield | 3.68% |', '',
  '### Net Asset Value', '', '| Net Asset Value | As of 9/16/2026 |', '| --- | --- |', '| NAV | $50.476 |', '| Premium/Discount to NAV | 0.01% |', '',
  '### Closing Market Price', '', '| Closing Market Value | As of 9/15/2026 |', '| --- | --- |', '| Closing Market Price | $50.470 |', '',
  '### Total Returns', '', 'Month End Performance (8/31/2026)', '',
  '| Cumulative | 1 Month | 3 Month | YTD | Since Inception* | |', '| --- | --- | --- | --- | --- | --- |', `| Market Price Returns | 0.32% | 1.02% | ${ytd} | 28.05% | |`,
  '| Average Annual | 1 Year | 3 Year | 5 Year | 10 Year | Since Inception* |', '| Market Price Returns | 4.00% | 4.65% | 3.86% | 2.52% | 1.99% |', '',
  'Quarter End Performance (6/30/2026)', '',
  '| Cumulative | Since Inception* | | | | |', '| --- | --- | --- | --- | --- | --- |', '| Market Price Returns | 27.19% | | | | |',
  '| Average Annual | 1 Year | 3 Year | 5 Year | 10 Year | Since Inception* |', '| Market Price Returns | 4.12% | 4.69% | 3.90% | 2.53% | 2.01% |', '',
  '### Recent Distributions', '', DIST_HEADER, '| 9/25/2026 | 9/25/2026 | 9/29/2026 | 0.17 | 0 | 0 | 0 | 0.17 |',
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
  return { chart: { result: [{ timestamp: timestamps, indicators: { quote: [{ close, volume: close.map(() => 1000) }], adjclose: [{ adjclose: close }] }, events: { dividends: {} }, meta: { exchangeName: 'NGM', regularMarketPrice: 140, regularMarketTime: Math.floor(last / 1000) } }] } };
}

/** SEC world shared by every EDGAR test (the updater caches the ticker table for the whole process, so it must never differ between tests). */
function secResponse(url: string, nportAsOf: string): Response | null {
  if (!url.includes('sec.gov')) return null;
  if (url.includes('company_tickers_mf')) return new Response(JSON.stringify({ fields: ['cik', 'seriesId', 'classId', 'symbol'], data: [['1350487', 'S000043966', 'C000136444', 'AAA']] }));
  if (url.includes('company_tickers')) return new Response('{}');
  if (url.includes('browse-edgar')) return new Response('<feed><entry><filing-type>NPORT-P</filing-type><accession-number>0000940400-26-000001</accession-number><filing-date>2026-07-30</filing-date></entry></feed>');
  if (url.includes('/Archives/edgar/')) return new Response(`<edgarSubmission><genInfo><regCik>0001350487</regCik><repPdDate>${nportAsOf}</repPdDate><seriesName>Fund AAA</seriesName><seriesId>S000043966</seriesId></genInfo><fundInfo><netAssets>1000000</netAssets></fundInfo><invstOrSecs><invstOrSec><name>NPORT CO ${nportAsOf}</name><cusip>999999999</cusip><pctVal>5</pctVal><valUSD>50</valUSD><balance>1</balance><assetCat>EC</assetCat></invstOrSec></invstOrSecs></edgarSubmission>`);
  return new Response('nope', { status: 404 });
}

class Scenario {
  dir = mkdtempSync(join(tmpdir(), 'wt-scn-'));
  root = pathToFileURL(`${this.dir}/api/wisdomtree/`);
  calls: Call[] = [];
  nportAsOf = '2026-05-31';
  constructor(public tickers: string[] = ['AAA', 'BBB', 'CCC']) { tempDirs.push(this.dir); mkdirSync(join(this.dir, 'api/wisdomtree'), { recursive: true }); }
  /** Default world: direct wisdomtree.com is Cloudflare-blocked, the proxy serves the catalog and product pages, Yahoo serves a chart, SEC serves AAA. */
  handler = (url: string, _init?: any): Response | Promise<Response> => {
    const sec = secResponse(url, this.nportAsOf);
    if (sec) return sec;
    if (url.startsWith('https://r.jina.ai/')) return url.endsWith('/us/products') ? new Response(catalogFor(this.tickers)) : new Response(productPage(url.split('/').pop()!.toUpperCase()));
    if (url.includes('wisdomtree.com')) return new Response('blocked', { status: 403 });
    if (url.includes('finance.yahoo.com')) return new Response(JSON.stringify(chartPayload()));
    return new Response('nope', { status: 404 });
  };
  async run(env: Record<string, string> = {}, overrides: Record<string, unknown> = {}, deadlineMs?: number): Promise<void> {
    globalThis.fetch = (async (input: any, init: any) => {
      const url = String(input?.url ?? input);
      this.calls.push({ url, ua: String(init?.headers?.['User-Agent'] ?? ''), at: Date.now() });
      return this.handler(url, init);
    }) as unknown as typeof fetch;
    console.log = console.warn = console.error = () => {};
    setApiRoot(this.root);
    try {
      const config = { ...readConfig(resolveControls({ REQUEST_SLEEP: '0', MAX_RETRIES: '1', EDGAR_FALLBACK: 'false', CONCURRENCY: '1', ...env })), proxyGapMs: 0, retryDelayMs: 0, ...overrides } as any;
      await runUpdate(config, deadlineMs);
    } finally {
      Object.assign(console, realConsole);
    }
  }
  index(): any { return JSON.parse(readFileSync(new URL('index.json', this.root), 'utf8')); }
  meta(ticker: string): any { return JSON.parse(readFileSync(new URL(`funds/${ticker}/meta.json`, this.root), 'utf8')); }
  state(): any { return JSON.parse(readFileSync(new URL('update-state.json', this.root), 'utf8')); }
  files(): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => { for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const path = join(dir, entry.name); if (entry.isDirectory()) walk(path); else out.push(path); } };
    walk(join(this.dir, 'api/wisdomtree'));
    return out;
  }
  backdate(): void { for (const path of this.files()) utimesSync(path, 1_000_000_000, 1_000_000_000); }
  touched(): string[] { return this.files().filter((path) => statSync(path).mtimeMs !== 1_000_000_000_000); }
}

describe('pipeline', () => {
  test('published rows: TER net and gross, derived ISIN, official basis, one metrics key set, dataFile', async () => {
    const s = new Scenario();
    await s.run();
    const [row, ...rest] = s.index().funds;
    expect([row.terValue, row.terGrossValue, row.isin, row.cusip, row.dataFile]).toEqual([0.15, 0.4, 'US0378331005', '037833100', './funds/AAA/meta.json']);
    expect(s.meta('AAA').expenseRatio).toMatchObject({ value: 0.15, grossValue: 0.4 });
    expect(row.metrics.returnsBasis).toBe(RETURNS_BASIS_OFFICIAL);
    for (const other of rest) expect(Object.keys(other.metrics)).toEqual(Object.keys(row.metrics));
    for (const f of [row, ...rest]) expect([f.metrics.dividendYield, f.metrics.dividendYieldBasis]).toEqual([4.72, 'official-trailing-12m']);
    expect(s.meta('AAA').yields.dividendYieldBasis).toBe(row.metrics.dividendYieldBasis);
  });

  test('a one-ticker run keeps every row: unreadable catalog, a catalog listing only that fund, an unfiltered failing run, MAX_FETCHES', async () => {
    const published = async (tickers: string[], metaOnly: string[]): Promise<Scenario> => {
      const s = new Scenario([...tickers, ...metaOnly]);
      await s.run();
      const index = s.index();
      index.funds = index.funds.filter((row: any) => tickers.includes(row.ticker));
      writeFileSync(new URL('index.json', s.root), JSON.stringify(index));
      return s;
    };
    const blocked = () => new Response('blocked', { status: 404 });
    const unreadable = await published(['AAA'], ['BBB', 'CCC']);
    unreadable.handler = blocked;
    await unreadable.run({ TICKERS: 'AAA' });
    expect(unreadable.index().funds.map((row: any) => row.ticker)).toEqual(['AAA', 'BBB', 'CCC']);
    const onlyAaa = await published(['AAA', 'BBB'], ['CCC']);
    onlyAaa.tickers = ['AAA'];
    await onlyAaa.run({ TICKERS: 'AAA' });
    expect(onlyAaa.index().funds.map((row: any) => row.ticker)).toEqual(['AAA', 'BBB', 'CCC']);
    const failing = await published(['AAA'], ['BBB']);
    failing.handler = blocked;
    await failing.run();
    expect(failing.index().counts.funds).toBe(2);
    const bounded = await published(['AAA', 'BBB'], ['CCC']);
    bounded.handler = blocked;
    await bounded.run({ MAX_FETCHES: '1' });
    expect(bounded.index().counts.funds).toBe(3);
  });

  test('readKnownRows is the union of the published index and funds/*/meta.json', async () => {
    const s = new Scenario(['AAA', 'BBB', 'CCC']);
    await s.run();
    const index = s.index();
    index.funds = index.funds.filter((row: any) => row.ticker === 'AAA').map((row: any) => ({ ...row, name: 'Published AAA' }));
    writeFileSync(new URL('index.json', s.root), JSON.stringify(index));
    setApiRoot(s.root);
    const known = await readKnownRows();
    expect([...known.keys()].sort()).toEqual(['AAA', 'BBB', 'CCC']);
    expect(known.get('AAA')!.name).toBe('Published AAA');
    await writeIndex([...known.values()]);
    expect(s.index().counts.funds).toBe(3);
  });

  test('a second identical run changes no file and no modification time', async () => {
    const s = new Scenario();
    await s.run();
    s.backdate();
    const before = s.files().map((path) => readFileSync(path, 'utf8'));
    await s.run();
    expect(s.touched()).toEqual([]);
    expect(s.files().map((path) => readFileSync(path, 'utf8'))).toEqual(before);
    expect(s.files().some((path) => path.includes('.tmp-'))).toBe(false);
  });

  test('a failed product page keeps the previous official data as one unit (returns, quarter end, distributions, NAV, price, premium)', async () => {
    const s = new Scenario();
    await s.run();
    const before = s.meta('AAA');
    expect(s.index().funds[0].metrics.returnsBasis).toBe(RETURNS_BASIS_OFFICIAL);
    const base = s.handler;
    // the proxy answers a verification page (HTTP 200) for the product pages, Yahoo is fine
    s.handler = (url, init) => (url.startsWith('https://r.jina.ai/') && !url.endsWith('/us/products') ? new Response('Title: Just a moment...') : base(url, init));
    await s.run({ TICKERS: 'AAA' });
    const after = s.meta('AAA');
    expect(after.returns).toEqual(before.returns);
    expect(after.returns.quarterEnd.asOfDate).toBe('Jun 30 2026');
    expect(after.distributions).toEqual(before.distributions);
    expect(after.distributions.rows[0][3]).toBe('0.17');
    expect([after.nav, after.marketPrice, after.premiumDiscount]).toEqual([before.nav, before.marketPrice, before.premiumDiscount]);
    expect(after.source.productPageStatus).toContain('retained');
    const row = s.index().funds.find((f: any) => f.ticker === 'AAA');
    expect([row.metrics.returnsBasis, row.metrics.performanceAsOf, row.metrics.secYield]).toEqual([RETURNS_BASIS_OFFICIAL, '2026-08-31', 3.68]);
    expect([row.metrics.dividendYield, row.metrics.dividendYieldBasis]).toEqual([4.72, 'official-trailing-12m']);
  });

  test('a partial product page (proxy dropped sections) keeps the published official sections; a full page missing a field is an honest null', async () => {
    const s = new Scenario();
    await s.run();
    const before = s.meta('AAA');
    const base = s.handler;
    const serve = (page: (t: string) => string) => { s.handler = (url, init) => (url.startsWith('https://r.jina.ai/') && !url.endsWith('/us/products') ? new Response(page(url.split('/').pop()!.toUpperCase())) : base(url, init)); };
    // 1. pricing present, performance and distributions dropped: zero diff
    serve((t) => productPage(t).split('### Total Returns')[0]);
    s.backdate();
    const files = s.files().map((path) => readFileSync(path, 'utf8'));
    await s.run();
    expect(s.touched()).toEqual([]);
    expect(s.files().map((path) => readFileSync(path, 'utf8'))).toEqual(files);
    // 2. performance present with a new YTD, pricing dropped: returns refresh, NAV/price/premium stay as published
    serve((t) => productPage(t, '9.99%').replace(/### Net Asset Value[\s\S]*?### Total Returns/, '### Total Returns'));
    await s.run({ TICKERS: 'AAA' });
    const mixed = s.meta('AAA');
    expect(mixed.returns.monthEnd.ytd).toBe(9.99);
    expect([mixed.nav, mixed.marketPrice, mixed.premiumDiscount]).toEqual([before.nav, before.marketPrice, before.premiumDiscount]);
    expect(s.index().funds.find((f: any) => f.ticker === 'AAA').metrics.returnsBasis).toBe(RETURNS_BASIS_OFFICIAL);
    // 3. a fully loaded page that lacks one field: null, nothing is refilled from the previous run
    serve((t) => productPage(t).replace('| SEC 30-day Yield | 3.68% |\n', ''));
    await s.run({ TICKERS: 'AAA' });
    expect(s.index().funds.find((f: any) => f.ticker === 'AAA').metrics.secYield).toBeNull();
    expect(s.meta('AAA').nav.value).toBe(50.476);
  });

  test('an honest page without a quarter-end table does not get a fabricated quarter-end date', async () => {
    const s = new Scenario();
    const base = s.handler;
    s.handler = (url, init) => (url.startsWith('https://r.jina.ai/') && !url.endsWith('/us/products') ? new Response(productPage('AAA').replace(/Quarter End Performance[\s\S]*?\n\n### Recent/, '### Recent')) : base(url, init));
    await s.run({ TICKERS: 'AAA' });
    expect(s.meta('AAA').returns.quarterEnd).toMatchObject({ asOfDate: '—', yr1: null, sinceInception: null });
  });

  test('a published row whose meta.json vanished has dataFile null and keeps the full metrics shape', async () => {
    const s = new Scenario();
    await s.run();
    rmSync(new URL('funds/BBB/meta.json', s.root));
    await s.run({ TICKERS: 'AAA' });
    const orphan = s.index().funds.find((f: any) => f.ticker === 'BBB');
    expect(orphan.dataFile).toBeNull();
    expect(Object.keys(orphan.metrics)).toEqual(Object.keys(s.index().funds[0].metrics));
    expect([orphan.metrics.dividendYield, orphan.metrics.dividendYieldBasis]).toEqual([4.72, 'official-trailing-12m']);
  });

  test('the cursor advances past skipped funds and wraps; a TICKERS run leaves it alone; filters that pass nothing count nothing', async () => {
    const s = new Scenario(['AAA', 'BBB', 'CCC']);
    await s.run({ MAX_FETCHES: '1', TOTAL_RETURN_1Y: '1000:' });
    expect(s.state().cursor).toBe('AAA');
    await s.run({ MAX_FETCHES: '1', TOTAL_RETURN_1Y: '1000:' });
    expect(s.state().cursor).toBe('BBB');
    await s.run({ MAX_FETCHES: '2', TOTAL_RETURN_1Y: '1000:' });
    expect(s.state().cursor).toBe('AAA');
    const stateBefore = readFileSync(new URL('update-state.json', s.root), 'utf8');
    await s.run({ TICKERS: 'BBB', MAX_FETCHES: '1' });
    expect(readFileSync(new URL('update-state.json', s.root), 'utf8')).toBe(stateBefore);
    await s.run({ AUM: '1T:' });
    expect(s.state().cursor).toBeNull();
  });

  test('return filters exclude funds whose bounded value is unavailable; an unknown ticker is an error', async () => {
    const s = new Scenario();
    const base = s.handler;
    s.handler = (url, init) => (url.startsWith('https://r.jina.ai/') && !url.endsWith('/us/products') ? new Response(productPage('AAA').replace('| 2.52% |', '| — |')) : base(url, init));
    await s.run({ PERFORMANCE_10Y: '0:', SKIP_YAHOO: 'true' });
    expect(['AAA', 'BBB', 'CCC'].map((t) => existsSync(new URL(`funds/${t}/meta.json`, s.root)))).toEqual([false, false, false]);
    await expect(new Scenario().run({ TICKERS: 'AAA ZZZ' })).rejects.toThrow('unknown ticker ZZZ');
  });

  test('a run where every fund failed to get live data exits non-zero', async () => {
    const s = new Scenario();
    await s.run();
    s.handler = () => new Response('down', { status: 500 });
    process.exitCode = 0;
    await s.run();
    expect(process.exitCode).toBe(1);
  });

  test('stale page files are removed once the new meta.json is written; the soft deadline still writes the index', async () => {
    const s = new Scenario();
    await s.run({ HISTORY_PAGE_SIZE: '100' });
    expect(readdirSync(new URL('funds/AAA/history/', s.root))).toContain('004.json');
    await s.run({ HISTORY_PAGE_SIZE: '1000' });
    expect(readdirSync(new URL('funds/AAA/history/', s.root))).toEqual(['001.json']);
    expect(s.meta('AAA').history.pages).toEqual(['history/001.json']);
    const late = new Scenario(['AAA', 'BBB']);
    await late.run({}, {}, 0);
    expect(existsSync(new URL('index.json', late.root))).toBe(true);
  });

  test('catalog changes: a new fund is picked up, a delisted fund keeps its data in the index; raw downloads stay outside api/', async () => {
    const s = new Scenario();
    await s.run({ STORE_RAW_DOWNLOADS: 'true' });
    expect(readdirSync(join(s.dir, 'data/raw')).some((name) => name.startsWith('product-table-'))).toBe(true);
    expect(existsSync(join(s.dir, 'api/wisdomtree/raw'))).toBe(false);
    s.tickers = ['AAA', 'BBB', 'DDD'];
    await s.run({ TICKERS: 'AAA' });
    expect(s.index().funds.map((f: any) => f.ticker)).toContain('CCC');
  });

  test('N-PORT freshness: a filing older than the published holdings never replaces them, a newer one does', async () => {
    const s = new Scenario(['AAA']);
    await s.run({ EDGAR_FALLBACK: 'true' });
    expect(s.meta('AAA').holdings.asOfDate).toBe('2026-05-31');
    const published = JSON.stringify(s.meta('AAA').holdings);
    s.nportAsOf = '2026-03-31';
    await s.run({ EDGAR_FALLBACK: 'true' });
    expect(JSON.stringify(s.meta('AAA').holdings)).toBe(published);
    s.nportAsOf = '2026-08-31';
    await s.run({ EDGAR_FALLBACK: 'true' });
    expect(s.meta('AAA').holdings.asOfDate).toBe('2026-08-31');
  });
});

// ===========================================================================
describe('network', () => {
  test('a blocked direct request latches, proxy starts are the configured gap apart and a failing page is retried once', async () => {
    const s = new Scenario();
    const base = s.handler;
    s.handler = (url, init) => (url.endsWith('/ccc') && url.startsWith('https://r.jina.ai/') ? new Response('boom', { status: 502 }) : base(url, init));
    await s.run({ CONCURRENCY: '3', MAX_RETRIES: '5' }, { proxyGapMs: 120 });
    const direct = s.calls.filter((c) => c.url.includes('wisdomtree.com') && !c.url.startsWith('https://r.jina.ai/'));
    expect(direct).toHaveLength(1);
    const proxy = s.calls.filter((c) => c.url.startsWith('https://r.jina.ai/'));
    expect(proxy.filter((c) => c.url.endsWith('/ccc'))).toHaveLength(2);
    expect(proxy).toHaveLength(1 + 1 + 1 + 2);
    for (let i = 1; i < proxy.length; i += 1) expect(proxy[i].at - proxy[i - 1].at).toBeGreaterThanOrEqual(100); // lower bound only, real timers never fire early by 20 ms
  });

  test('a reachable direct page is used and the proxy is never called', async () => {
    const s = new Scenario();
    s.handler = (url) => secResponse(url, s.nportAsOf) ?? (url.startsWith('https://r.jina.ai/') ? new Response('should not be used', { status: 500 }) : url.includes('wisdomtree.com') ? new Response(url.endsWith('/us/products') ? catalogFor(s.tickers) : productPage(url.split('/').pop()!.toUpperCase())) : url.includes('yahoo') ? new Response(JSON.stringify(chartPayload())) : new Response('no', { status: 404 }));
    await s.run();
    expect(s.calls.some((c) => c.url.startsWith('https://r.jina.ai/'))).toBe(false);
    expect(s.meta('AAA').source.productPageStatus).toContain('directly');
  });

  test('requests carry a timeout signal that aborts a hanging response and a stalled body', async () => {
    let withoutSignal = 0;
    const armed = (init: any): AbortSignal | null => {
      if (init?.signal instanceof AbortSignal) return init.signal;
      withoutSignal += 1;
      return null;
    };
    const hanging = new Scenario();
    hanging.handler = (_url, init) => {
      const signal = armed(init);
      return signal ? new Promise<Response>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) : Promise.reject(new Error('no timeout signal'));
    };
    await expect(hanging.run({}, { fetchTimeoutMs: 30 })).rejects.toThrow('No catalog rows');
    const stalled = new Scenario();
    stalled.handler = (_url, init) => {
      const signal = armed(init);
      return new Response(new ReadableStream({ start(controller) { if (signal) signal.addEventListener('abort', () => controller.error(new Error('aborted'))); else controller.error(new Error('no timeout signal')); } }));
    };
    await expect(stalled.run({}, { fetchTimeoutMs: 30 })).rejects.toThrow('No catalog rows');
    expect([hanging.calls.length > 0, stalled.calls.length > 0, withoutSignal]).toEqual([true, true, 0]);
  });

  test('only the SEC receives the SEC contact as User-Agent', async () => {
    const s = new Scenario();
    await s.run({ EDGAR_FALLBACK: 'true' });
    const sec = s.calls.filter((c) => c.url.includes('sec.gov'));
    expect(sec.length).toBeGreaterThan(0);
    expect(sec.every((c) => c.ua.includes('daggerok'))).toBe(true);
    const others = s.calls.filter((c) => !c.url.includes('sec.gov'));
    expect(others.length).toBeGreaterThan(3);
    expect(others.every((c) => c.ua !== '' && !c.ua.includes('daggerok'))).toBe(true);
  });

  test('peak in-flight requests is 1 at CONCURRENCY=1 and N at N', async () => {
    const peak = async (concurrency: number): Promise<number> => {
      let inFlight = 0, max = 0;
      const s = new Scenario(['AAA', 'BBB', 'CCC', 'DDD']);
      const base = s.handler;
      s.handler = async (url, init) => {
        if (!url.includes('finance.yahoo.com')) return base(url, init);
        inFlight += 1; max = Math.max(max, inFlight);
        await new Promise((resolve) => realSetTimeout(resolve, 40));
        inFlight -= 1;
        return base(url, init);
      };
      await s.run({ CONCURRENCY: String(concurrency) });
      return max;
    };
    expect(await peak(1)).toBe(1);
    expect(await peak(3)).toBe(3);
  });

  test('HISTORY_RANGE reaches the Yahoo URL as explicit period1/period2, max starts at 0, range is never sent', async () => {
    const now = 2_000_000_000;
    const full = yahooChartQuery('max', now);
    expect([full.get('period1'), full.get('period2'), full.has('range')]).toEqual(['0', String(now + 86_400), false]);
    const limited = yahooChartQuery('5y', now);
    expect([limited.has('range'), Number(limited.get('period1')), limited.get('period2'), limited.get('events')]).toEqual([false, Math.floor(now - 5 * 365.25 * 86_400), String(now + 86_400), 'div|split']);
    const s = new Scenario();
    await s.run({ HISTORY_RANGE: '1y' });
    const query = new URL(s.calls.find((c) => c.url.includes('finance.yahoo.com'))!.url).searchParams;
    expect(Number(query.get('period1'))).toBeGreaterThan(Date.now() / 1000 - 2 * 365 * 86_400);
    expect(query.has('range')).toBe(false);
  });
});
