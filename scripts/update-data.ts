#!/usr/bin/env bun
// Bun provides Node-compatible fs/promises; node types are intentionally not required at runtime.
/// <reference types="bun" />
import { readFile as outputReadFile, readdir as outputReadDir } from 'node:fs/promises';
import { createHash as outputCreateHash } from 'node:crypto';
import { join as outputJoin } from 'node:path';
import { fileURLToPath as outputFileURLToPath } from 'node:url';

// Console presentation; no changes to provider requests or persisted data.
/** Presentation only: no requests, writes, filtering, or changes to updater state. */

const outputClean = (value: unknown): string => String(value ?? 'null').replace(/[\r\n\t]+/g, ' ');
/** Presentation only: per-fund retry and fallback notices are printed when VERBOSE is enabled. */
const outputVerbose = (): boolean => /^(1|true|yes|on)$/i.test((globalThis as any).process?.env?.VERBOSE ?? '');
function outputNote(message: string): void { if (outputVerbose()) console.warn(message); }
/** Names are the canonical environment knobs, not internal parser properties. */
function outputConfigEntries(config: Record<string, any>): [string, string][] {
  const values = new Map<string, string>();
  const aliases: Record<string, string> = {
    requestSleepSeconds: 'REQUEST_SLEEP', categories: 'CATEGORY',
    aumRange: 'AUM', terRange: 'TER', dividendYieldRange: 'DIVIDEND_YIELD', secYieldRange: 'SEC_YIELD',
    performanceRanges: 'PERFORMANCE', totalReturnRanges: 'TOTAL_RETURN',
    skipVanEck: 'SKIP_VANECK', skipProShares: 'SKIP_PROSHARES',
    skipWisdomTree: 'SKIP_WISDOMTREE', skipGoldmanSachs: 'SKIP_GOLDMANSACHS',
    skipGlobalX: 'SKIP_GLOBALX', skipNorthernTrust: 'SKIP_NORTHERNTRUST',
  };
  const range = (v: any): string => typeof v === 'string' ? v : v?.source ?? `${Number.isFinite(v?.min) ? v.min : ''}:${Number.isFinite(v?.max) ? v.max : ''}`;
  for (const [key, value] of Object.entries(config)) {
    if (['proxyGapMs', 'fetchTimeoutMs', 'retryDelayMs'].includes(key)) continue;
    const name = aliases[key] ?? (/^[A-Z0-9_]+$/.test(key) ? key : key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase());
    if (name === 'PERFORMANCE' || name === 'TOTAL_RETURN') {
      for (const period of ['YTD', '1Y', '3Y', '5Y', '10Y']) values.set(`${name}_${period}`, range(value?.[period]));
    } else if (['AUM', 'TER', 'DIVIDEND_YIELD', 'SEC_YIELD'].includes(name)) {
      values.set(name, range(value));
    } else {
      values.set(name, value instanceof Set ? [...value].join(',') || 'all' : Array.isArray(value) ? value.join(',') || 'all' : outputClean(value));
    }
  }
  const first = ['MAX_FETCHES', 'REQUEST_SLEEP', 'CONCURRENCY'];
  return [...values].sort(([a], [b]) => {
    const ai = first.indexOf(a), bi = first.indexOf(b);
    return (ai < 0 ? first.length : ai) - (bi < 0 ? first.length : bi) || a.localeCompare(b);
  });
}
function outputConfigValue(key: string, value: string): string {
  if (/TOKEN|PASSWORD|SECRET|COOKIE|SEC_UA/i.test(key)) return '<redacted>';
  if (key === 'TICKERS' && ['', 'null', 'undefined'].includes(value)) return 'all';
  return outputClean(value);
}
function outputPrintConfig(brand: string, config: Record<string, any>): void {
  const entries: [string, string][] = [...outputConfigEntries(config), ['VERBOSE', String(outputVerbose())]];
  console.log(`[ config   ] ${brand} updater:\n${entries.map(([key, value]) => `              ${key}=${outputConfigValue(key, value)}`).join('\n')}`);
}
function outputHasOutputFilters(config: Record<string, any>): boolean {
  return outputConfigEntries(config).some(([name, value]) =>
    /^(CATEGORY|AUM|TER|DIVIDEND_YIELD|SEC_YIELD|PERFORMANCE_|TOTAL_RETURN_)/.test(name) &&
    !['', ':', 'null', 'all'].includes(value));
}
function outputPrintFilter(selected: number, total: number, deferred = false): void {
  console.log(`[ filter   ] ${selected} of ${total} funds ${deferred ? 'selected for evaluation (data-dependent filters applied per fund)' : 'pass filters'}`);
}
function outputStable(value: any): any {
  if (Array.isArray(value)) return value.map(outputStable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => !['generatedAt', 'catalogReadAt'].includes(key)).map(key => [key, outputStable(value[key])]));
  return value;
}
function outputContentKey(value: unknown): string { return JSON.stringify(outputStable(value)) ?? 'null'; }
async function outputInspectFund(root: URL | string, ticker: string): Promise<{ digest: string; meta: any }> {
  const dir = outputJoin(root instanceof URL ? outputFileURLToPath(root) : root, 'funds', ticker);
  const hash = outputCreateHash('sha256');
  async function visit(path: string): Promise<void> {
    const entries = await outputReadDir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) await visit(outputJoin(path, entry.name));
      else if (entry.name.endsWith('.json')) {
        const text = await outputReadFile(outputJoin(path, entry.name), 'utf8').catch(() => '');
        hash.update(outputJoin(path.slice(dir.length), entry.name));
        try { hash.update(outputContentKey(JSON.parse(text))); } catch { hash.update(text); }
      }
    }
  }
  await visit(dir);
  const meta = await outputReadFile(outputJoin(dir, 'meta.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  return { digest: hash.digest('hex'), meta };
}
const outputCount = (value: any): unknown => typeof value === 'number' ? value : Array.isArray(value) ? value.length : value?.totalRows ?? value?.rows?.length ?? null;
const outputScalar = (value: any): any => value && typeof value === 'object' ? value.display ?? value.value ?? null : value;
const outputUnits: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12, THOUSAND: 1e3, MILLION: 1e6, BILLION: 1e9, TRILLION: 1e12 };
function outputMoney(value: any): string {
  const raw = value && typeof value === 'object' && typeof value.value === 'number' && Number.isFinite(value.value) ? value.value : outputScalar(value);
  if (raw === null || raw === undefined || raw === '—' || raw === '--') return 'null';
  const text = String(raw).replace(/[$,\s]/g, '');
  const match = text.match(/^([+-]?[\d.]+)(K|M|B|T|Thousand|Million|Billion|Trillion)?$/i);
  if (!match) return outputClean(raw);
  const number = Number(match[1]) * (outputUnits[match[2]?.toUpperCase() ?? ''] ?? 1);
  if (!Number.isFinite(number)) return 'null';
  for (const [unit, scale] of [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]] as const) {
    if (Math.abs(number) >= scale) return `$${(number / scale).toFixed(1)}${unit}`;
  }
  return `$${number.toFixed(2)}`;
}
/** Yields: rounded to 2 decimals without trailing zeros; placeholders are omitted like null. */
function outputPercent(value: any): unknown {
  const raw = outputScalar(value);
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? Number(raw.toFixed(2)) : null;
  const text = String(raw).trim().replace(/%$/, '').trim();
  if (['', '-', '—', '--', 'n/a'].includes(text.toLowerCase())) return null;
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) ? Number(number.toFixed(2)) : outputClean(raw);
}
function outputFundLine(index: number, total: number, ticker: string, status: string, data: any = {}, reason?: unknown): string {
  const width = Math.max(2, String(total).length);
  const metrics = data.metrics ?? {};
  // Presentation only. Keep valid zero/false values; omit unavailable fields.
  // outputMoney returns the string 'null' for an unavailable monetary value.
  const field = (key: string, value: unknown): string =>
    value === null || value === undefined || value === 'null' ? '' : `${key}=${outputClean(value)}`;
  const sources = [
    field('official', data.officialHistoryCount),
    field('yahoo', data.yahooHistoryCount),
  ].filter(part => part !== '').join(' ');
  const detail = [
    field('port', data.portId ?? data.portfolioId),
    field('history', outputCount(data.history ?? data.historyCount)),
    sources ? `(${sources})` : '',
    field('holdings', outputCount(data.holdings ?? data.holdingsCount)),
    field('divs', outputCount(data.worksheets?.Distributions ?? data.distributions)),
    field('netAssets', outputMoney(data.netAssets ?? data.aum)),
    field('total', outputMoney(data.totalFundNetAssets ?? data.totalNetAssets)),
    field('div', outputPercent(data.trailingYield ?? data.yields?.effectiveYield ?? data.yields?.dividendYield ?? data.dividendYield ?? metrics.dividendYield)),
    field('sec', outputPercent(data.secYield ?? data.yields?.secYield ?? metrics.secYield)),
    field('wp', data.workplaceRaw),
  ].filter(part => part !== '').join(' ');
  return `[ ${`${String(index).padStart(width)}/${total}`.padEnd(8)} ] ${outputClean(ticker).padEnd(5)} ${status.padEnd(9)}${detail ? ` ${detail}` : ''}${reason ? ` reason=${outputClean(reason)}` : ''}`;
}
function outputCreateReporter(root: URL | string, total: number) {
  let completed = 0;
  const tally = new Map<string, number>();
  return {
    before: (ticker: string) => outputInspectFund(root, ticker),
    async result(ticker: string, before: { digest: string }, status?: string, reason?: unknown, extra: any = {}) {
      const after = await outputInspectFund(root, ticker);
      const final = status ?? (before.digest === after.digest ? 'unchanged' : 'updated');
      tally.set(final, (tally.get(final) ?? 0) + 1);
      console.log(outputFundLine(++completed, total, ticker, final, { ...after.meta, ...extra }, reason));
    },
    /** First [ done ] line: the statuses of every fund line this reporter printed. */
    summary(startedAt: number): string {
      const order = ['updated', 'unchanged', 'kept', 'skipped', 'failed'];
      const statuses = [...order, ...[...tally.keys()].filter(status => !order.includes(status))];
      return `[ done     ] ${completed} fund${completed === 1 ? '' : 's'}: ${statuses.map(status => `${tally.get(status) ?? 0} ${status}`).join(', ')} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
    },
  };
}
/** Second [ done ] line: published totals. */
function outputCounts(funds: number, holdings: number, history: number): string {
  return `[ done     ] counts: ${funds.toLocaleString('en-US')} funds / ${holdings.toLocaleString('en-US')} holdings rows / ${history.toLocaleString('en-US')} history rows`;
}


// WisdomTree U.S.-listed ETF static data updater.
//
// The browser application is deliberately static. This script builds the feed
// under api/wisdomtree/** from public, issuer/SEC/market-data sources:
//
//   catalog   WisdomTree's U.S. fund list (the JSON behind the product table
//             on https://www.wisdomtree.com/us/products), the rendered
//             product table as the fallback, and per-fund product pages
//   holdings  SEC EDGAR Form N-PORT-P for the exact ETF series (full reported
//             portfolio; the issuer page is used as a small fallback)
//   returns   The per-fund product page's official "Total Returns" table
//             (Market Price, NAV and Underlying Index Returns rows)
//   distributions  The per-fund product page's official "Recent
//             Distributions" table (ex-date plus the Ordinary Income /
//             Short-Term / Long-Term Capital Gains / Return of Capital
//             breakdown); Yahoo Finance dividend events fill in only the
//             older ex-dates that small official table doesn't cover
//   history   Yahoo Finance's public chart endpoint (daily close, adjusted
//             close and volume)
//
// WisdomTree currently protects some HTML/API routes with Cloudflare. The
// catalog fetch first tries the official fund list and then uses the read-only
// r.jina.ai rendering of that same official URL. No user data or credentials
// are sent to the proxy. SEC and Yahoo requests stay direct.
//
// Usage: bun ./scripts/update-data.ts [--help]

import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';

type JsonRecord = Record<string, any>;
type Range = { min?: number; max?: number };
type ReturnPeriod = 'YTD' | '1Y' | '3Y' | '5Y' | '10Y';
type RangeMap = Partial<Record<ReturnPeriod, Range>>;

const WISDOMTREE_SITE = 'https://www.wisdomtree.com';
const WISDOMTREE_CATALOG_URL = `${WISDOMTREE_SITE}/us/products`;
const WISDOMTREE_CATALOG_PROXY_URL = `https://r.jina.ai/http://www.wisdomtree.com/us/products`;
// Since the 2026-10 site rebuild the product table is a client-side widget (fundlisting.wisdomtree.com) that loads this JSON;
// the server-rendered page and its rendering only show "No results found".
const WISDOMTREE_FUND_LIST_URL = 'https://dataspanapi.wisdomtree.com/fundlist/data?divisionId=1&wtRegion=US&isoCode=en-US&isFP=false';
const WISDOMTREE_FUND_LIST_PROXY_URL = `https://r.jina.ai/${WISDOMTREE_FUND_LIST_URL}`;
const WISDOMTREE_PRODUCT_PROXY_PREFIX = 'https://r.jina.ai/http://www.wisdomtree.com';
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const SEC_DATA_HOST = 'https://data.sec.gov';
const SEC_SITE = 'https://www.sec.gov';
const SEC_FUND_TICKERS_URL = `${SEC_SITE}/files/company_tickers_mf.json`;
const SEC_COMPANY_TICKERS_URL = `${SEC_SITE}/files/company_tickers.json`;
const DEFAULT_SEC_UA = 'daggerok ETF feed daggerok@gmail.com';
// The SEC contact is sent to sec.gov only; every other host (wisdomtree.com, r.jina.ai, Yahoo) gets a generic agent.
const GENERIC_UA = 'Mozilla/5.0 (compatible; etf-feed-updater)';
const FETCH_TIMEOUT_MS = 45_000;
const RETRY_DELAY_MS = 800;
// r.jina.ai is rate-limited: one global gate, at least 3.2 s between request starts, one retry at most.
const PROXY_GAP_MS = 3_200;
// The run stops taking new funds after this long and still writes the index (the workflow times out at 30 minutes).
const SOFT_DEADLINE_MS = 25 * 60_000;
// Replaced from the resolved SEC_UA control in main(); the protected SEC_UA Actions variable overrides the default.
let SEC_UA = DEFAULT_SEC_UA;

let API_ROOT = new URL('../api/wisdomtree/', import.meta.url);
let INDEX_FILE = new URL('index.json', API_ROOT);
let STATE_FILE = new URL('update-state.json', API_ROOT);

/** Points the updater at another output folder (offline tests only; the CLI always writes api/wisdomtree). */
export function setApiRoot(root: URL): void {
  API_ROOT = root;
  INDEX_FILE = new URL('index.json', root);
  STATE_FILE = new URL('update-state.json', root);
}

const HOLDINGS_HEADERS = ['Name', 'Ticker', 'Identifier', 'Weight', 'Market Value', 'Shares Held', 'Asset Category'];
/** Funds whose holdings legitimately fail a holdingsGuard check (geared, futures, look-through, top-N lists): ticker, or '*' for every fund -> relaxed checks. */
export const HOLDINGS_GUARD_RELAX: Record<string, string[]> = {
  WSPC: ['sum'], // no N-PORT filing yet: the product page lists only its top 10 holdings (about 47% of the fund)
};
/** Funds the issuer closed, each confirmed from an SEC filing or the issuer notice (`source`): never fetched or guarded, last published data kept, index row marked closed. */
export const CLOSED_FUNDS: ClosedFund[] = [];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TRUTHY = new Set(['1', 'true', 'yes', 'y', 'on']);
const AUM_BOUNDS = { nano: [0, 10_000_000], micro: [10_000_000, 300_000_000], small: [300_000_000, 2_000_000_000], mid: [2_000_000_000, 10_000_000_000], large: [10_000_000_000, undefined] } as const;

export type CatalogReturns = {
  ytd: number | null;
  yr1: number | null;
  yr3: number | null;
  yr5: number | null;
  yr10: number | null;
  sinceInception: number | null;
};

export type CatalogFund = {
  ticker: string;
  name: string;
  category: string;
  categoryPath: string;
  inception: string | null;
  exchange: string;
  cusip: string;
  isin: string;
  benchmark: string;
  ter: number | null;
  grossTer: number | null;
  nav: number | null;
  close: number | null;
  premiumDiscount: number | null;
  netAssets: number | null;
  dividendYield: number | null;
  dividendYieldBasis?: DividendYieldBasis | null;
  secYield: number | null;
  asOfDate: string | null;
  returns: CatalogReturns;
  fundPage: string;
  source: 'wisdomtree' | 'previous index' | 'seed';
};

export type ChartDay = { date: string; close: number; adjClose: number; volume: number };
export type ParsedChart = {
  days: ChartDay[];
  dividends: Array<{ epoch: number; amount: number }>;
  exchangeName: string;
  regularMarketPrice: number | null;
  regularMarketTime: number | null;
  firstTradeDate: number | null;
};

export type PriceReturns = {
  asOfDate: string;
  mo1: number | null;
  qtd: number | null;
  ytd: number | null;
  yr1: number | null;
  cagr3y: number | null;
  cagr5y: number | null;
  cagr10y: number | null;
  siAnn: number | null;
};

// A single labeled row from the official product page's "Total Returns"
// table (Market Price Returns, NAV Returns or Underlying Index Returns),
// holding the same cumulative/annualized tenors as the primary row below but
// with no asOfDate of its own (it shares the section's asOfDate).
export type OfficialReturnRow = {
  mo1: number | null;
  qtd: number | null;
  ytd: number | null;
  yr1: number | null;
  cagr3y: number | null;
  cagr5y: number | null;
  cagr10y: number | null;
  siAnn: number | null;
};

export type OfficialProductReturns = PriceReturns & {
  qtd: number | null;
  ytd: number | null;
  yr1: number | null;
  cagr3y: number | null;
  cagr5y: number | null;
  cagr10y: number | null;
  siAnn: number | null;
  // The primary fields above are the table's "Market Price Returns" row
  // (kept for backward compatibility with the merge-with-Yahoo path below).
  // These are the same official table's "NAV Returns" and "Underlying Index
  // Returns" (benchmark) rows, kept alongside rather than overwriting them.
  navReturns: OfficialReturnRow | null;
  indexReturns: OfficialReturnRow | null;
};

export type ProductPageSummary = {
  name: string | null;
  cusip: string;
  nav: number | null;
  navAsOfDate: string | null;
  marketPrice: number | null;
  marketPriceAsOfDate: string | null;
  premiumDiscount: number | null;
  distributionYield: number | null;
  secYield: number | null;
  netExpenseRatio: number | null;
  totalAssets: number | null;
  productAsOfDate: string | null;
  officialReturns: { monthEnd: OfficialProductReturns | null; quarterEnd: OfficialProductReturns | null };
  /** Which sections of the page are present at all (a heading or table), whether or not their values parsed. */
  sections: ProductPageSections;
  /** True only when the pricing tables AND the Total Returns section are present; anything less is a partial rendering. */
  loadedFully: boolean;
};

export type ProductPageSections = { pricing: boolean; returns: boolean; distributions: boolean };

export type UpdaterConfig = {
  maxFetches: number;
  requestSleep: number;
  aum?: Range;
  ter?: Range;
  dividendYield?: Range;
  secYield?: Range;
  performance: RangeMap;
  totalReturn: RangeMap;
  concurrency: number;
  holdingsPageSize: number;
  historyPageSize: number;
  storeRawDownloads: boolean;
  maxRetries: number;
  tickers: Set<string> | null;
  historyRange: string;
  edgarFallback: boolean;
  skipWisdomTree: boolean;
  skipYahoo: boolean;
  secUa: string;
  // Timing knobs, not user controls: tests shrink them, production uses the defaults.
  proxyGapMs: number;
  fetchTimeoutMs: number;
  retryDelayMs: number;
};

const EMPTY_RETURNS: CatalogReturns = { ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null };
const EMPTY_PRICE_RETURNS: PriceReturns = { asOfDate: '', mo1: null, qtd: null, ytd: null, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null };

// One pacing lane per concurrent worker (sized from config.concurrency in
// main()). A single shared gate capped total throughput at one request per
// requestSleepSeconds no matter how high CONCURRENCY was set; CONCURRENCY
// workers now each get their own paced lane, so concurrency actually
// multiplies throughput as documented instead of only overlapping wait time.
let requestGates: number[] = [0];
let requestSleepSeconds = 1.5;
/** One run's SEC state: the two SEC ticker tables (each loaded once) and the N-PORT reader cache (submissions and documents). */
let secState: { funds: Promise<Map<string, NportSeriesRef>> | null; names: Promise<Map<string, string>> | null; reader: Map<string, unknown> } = { funds: null, names: null, reader: new Map() };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function cleanText(value: unknown): string {
  return String(value ?? '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ndash;|&mdash;/gi, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeTicker(value: unknown): string {
  return cleanText(value).replace(/[^A-Za-z0-9.-]/g, '').toUpperCase();
}

export function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = cleanText(value);
  if (!raw || ['-', '--', '—', 'n/a', 'na', 'null', 'none'].includes(raw.toLowerCase())) return null;
  const negative = /^\(.*\)$/.test(raw);
  const normalized = raw.replace(/[($,%\s]/g, '').replace(/[)]/g, '').replace(/,/g, '');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

export function toIsoDate(value: unknown): string {
  const raw = cleanText(value);
  if (!raw) return '';
  // ISO, U.S. and month-name dates: pure calendar text, the same day in every time zone (shared calendar-dates block)
  return calendarIso(raw) ?? raw;
}

export function formatDate(value: string | null | undefined): string {
  const iso = toIsoDate(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso || '—';
  return `${MONTHS[Number(match[2]) - 1]} ${match[3]} ${match[1]}`;
}

function formatUsDate(epoch: number): string {
  const date = new Date(epoch * 1000);
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/${date.getUTCFullYear()}`;
}

function isoToUsDate(iso: string | null): string {
  const match = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  return match ? `${match[2]}/${match[3]}/${match[1]}` : '—';
}

function isoDateEpoch(iso: string): number | null {
  const parsed = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

function formatAumDisplay(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1e12) return `$${(value / 1e12).toFixed(2)} T`;
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)} B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)} M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(2)} K`;
  return `$${value.toFixed(2)}`;
}

function parseBoolean(value: string | undefined): boolean {
  return TRUTHY.has(String(value ?? '').trim().toLowerCase());
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseDecimal(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function parseRange(value: string, name = 'range'): Range | undefined {
  const raw = String(value ?? '').trim();
  if (!raw || raw === ':') return undefined;
  if ((raw.match(/:/g) || []).length !== 1) throw new Error(`${name}: colon is required exactly once (use min:max)`);
  const [left, right] = raw.split(':').map((part) => part.trim().replace(/[$%]/g, ''));
  const min = left === '' ? undefined : Number(left);
  const max = right === '' ? undefined : Number(right);
  if ((min !== undefined && !Number.isFinite(min)) || (max !== undefined && !Number.isFinite(max))) throw new Error(`${name}: bounds must be numbers`);
  if (min !== undefined && max !== undefined && min > max) throw new Error(`${name}: minimum must not exceed maximum`);
  return { min, max };
}

function parseAumBound(value: string): number | undefined {
  const raw = value.trim().toLowerCase();
  if (!raw) return undefined;
  if (raw in AUM_BOUNDS) return AUM_BOUNDS[raw as keyof typeof AUM_BOUNDS][0];
  const match = /^\$?([0-9]+(?:\.[0-9]+)?)([kmbt]?)$/i.exec(raw);
  if (!match) throw new Error(`AUM: invalid bound "${value}"`);
  const multiplier: Record<string, number> = { '': 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
  return Number(match[1]) * multiplier[match[2].toLowerCase()];
}

export function parseAumRange(value: string): Range | undefined {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw || raw === ':') return undefined;
  if (!raw.includes(':') && raw in AUM_BOUNDS) {
    const [min, max] = AUM_BOUNDS[raw as keyof typeof AUM_BOUNDS];
    return { min, max };
  }
  if ((raw.match(/:/g) || []).length !== 1) throw new Error('AUM: colon is required exactly once (or use a size preset)');
  const [left, right] = raw.split(':');
  const min = left ? parseAumBound(left) : undefined;
  let max = right ? parseAumBound(right) : undefined;
  // Presets on the right are exclusive upper bounds; the UI contract uses the
  // same convention as iShares/SPDR/Fidelity.
  if (right && right in AUM_BOUNDS) max = AUM_BOUNDS[right as keyof typeof AUM_BOUNDS][1];
  if (min !== undefined && max !== undefined && min > max) throw new Error('AUM: minimum must not exceed maximum');
  return { min, max };
}

export function parseRanges(env: Record<string, string | undefined>, prefix: 'PERFORMANCE' | 'TOTAL_RETURN'): RangeMap {
  const result: RangeMap = {};
  for (const period of ['YTD', '1Y', '3Y', '5Y', '10Y'] as ReturnPeriod[]) {
    const value = env[`${prefix}_${period}`];
    if (value !== undefined && value.trim() !== '') {
      const parsed = parseRange(value, `${prefix}_${period}`);
      if (parsed) result[period] = parsed;
    }
  }
  return result;
}

function readTickerSet(value: string | undefined): Set<string> | null {
  const tickers = String(value ?? '').split(/[\s,;]+/).map(sanitizeTicker).filter(Boolean);
  return tickers.length ? new Set(tickers) : null;
}

export function hasConfiguredFilters(config: UpdaterConfig): boolean {
  return Boolean(config.aum || config.ter || config.dividendYield || config.secYield || config.tickers || Object.keys(config.performance).length || Object.keys(config.totalReturn).length);
}

export function readConfig(env: Record<string, string | undefined> = process.env): UpdaterConfig {
  return {
    maxFetches: parsePositiveInt(env.MAX_FETCHES, 0),
    requestSleep: parseDecimal(env.REQUEST_SLEEP, 1.5),
    aum: parseAumRange(env.AUM ?? ':'),
    ter: parseRange(env.TER ?? ':', 'TER'),
    dividendYield: parseRange(env.DIVIDEND_YIELD ?? ':', 'DIVIDEND_YIELD'),
    secYield: parseRange(env.SEC_YIELD ?? ':', 'SEC_YIELD'),
    performance: parseRanges(env, 'PERFORMANCE'),
    totalReturn: parseRanges(env, 'TOTAL_RETURN'),
    concurrency: Math.max(1, parsePositiveInt(env.CONCURRENCY, 3)),
    holdingsPageSize: Math.max(1, parsePositiveInt(env.HOLDINGS_PAGE_SIZE, 250)),
    historyPageSize: Math.max(1, parsePositiveInt(env.HISTORY_PAGE_SIZE, 1000)),
    storeRawDownloads: parseBoolean(env.STORE_RAW_DOWNLOADS),
    maxRetries: Math.max(1, parsePositiveInt(env.MAX_RETRIES, 2)),
    tickers: readTickerSet(env.TICKERS),
    historyRange: env.HISTORY_RANGE?.trim().toLowerCase() || 'max',
    edgarFallback: String(env.EDGAR_FALLBACK ?? '').trim() === '' ? true : parseBoolean(env.EDGAR_FALLBACK),
    skipWisdomTree: parseBoolean(env.SKIP_WISDOMTREE),
    skipYahoo: parseBoolean(env.SKIP_YAHOO),
    secUa: env.SEC_UA?.trim() || DEFAULT_SEC_UA,
    proxyGapMs: PROXY_GAP_MS,
    fetchTimeoutMs: FETCH_TIMEOUT_MS,
    retryDelayMs: RETRY_DELAY_MS,
  };
}

function rangeMatches(value: number | null | undefined, range?: Range): boolean {
  if (!range) return true;
  if (value === null || value === undefined || !Number.isFinite(value)) return false;
  return (range.min === undefined || value >= range.min) && (range.max === undefined || value <= range.max);
}

function annualizedToTotal(value: number | null | undefined, years: number): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || years <= 0) return null;
  return round(((1 + value / 100) ** years - 1) * 100, 2);
}

export { annualizedToTotal };

function parseMarkdownCell(value: string): string {
  const markdown = value.trim();
  const link = /^\[([\s\S]*?)\]\(([^)]+)\)$/.exec(markdown);
  return cleanText(link ? link[1] : markdown);
}

function linkUrl(value: string): string {
  const link = /^\[([\s\S]*?)\]\(([^)]+)\)$/.exec(value.trim());
  if (!link) return '';
  return link[2].trim();
}

function canonicalFundPage(raw: string, ticker: string): string {
  if (!raw) return `${WISDOMTREE_SITE}/us/products/etf/${ticker.toLowerCase()}`;
  const absolute = raw.startsWith('http') ? raw : `${WISDOMTREE_SITE}${raw.startsWith('/') ? '' : '/'}${raw}`;
  return absolute
    .replace('/investments/etfs/', '/us/products/')
    .replace(/\/+$/, '')
    .replace(/\/([A-Z0-9]{1,6})$/, (_match, value) => `/${String(value).toLowerCase()}`);
}

function normalizeCategory(value: string): string {
  const raw = cleanText(value);
  const aliases: Record<string, string> = {
    'Megatrends': 'Thematic',
    'Thematic': 'Thematic',
    'Crypto ETPs': 'Crypto ETPs',
    'Capital Efficient ETFs': 'Capital Efficient ETFs',
    'Domestic Equity': 'Domestic Equity',
    'Emerging Markets Equity': 'Emerging Markets Equity',
    'International Equity': 'International Equity',
    'Fixed Income': 'Fixed Income',
    'Alternative': 'Alternative',
  };
  return aliases[raw] || raw || 'ETF';
}

export function catalogAsOfDate(markdown: string): string | null {
  const match = /As of\s+(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(markdown);
  return match ? toIsoDate(match[1]) : null;
}

export function parseCatalogMarkdown(markdown: string): CatalogFund[] {
  const source = String(markdown ?? '').replace(/\r/g, '');
  const lines = source.split('\n');
  const headerIndex = lines.findIndex((line) => /\|\s*WisdomTree Fund\s*\|\s*Fund Ticker\s*\|/i.test(line));
  if (headerIndex < 0) throw new Error('WisdomTree product table: no header row found');
  const funds: CatalogFund[] = [];
  const seen = new Set<string>();
  const catalogDate = catalogAsOfDate(source);
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
    if (cells.length < 10) continue;
    const tickerCell = parseMarkdownCell(cells[1]).replace(/\s+/g, '');
    const ticker = sanitizeTicker(tickerCell);
    if (!ticker || ticker === 'FUNDTICKER' || seen.has(ticker)) continue;
    const name = parseMarkdownCell(cells[0]) || ticker;
    const grossTer = numberOrNull(cells[5]);
    const ter = numberOrNull(cells[6]);
    const aumThousands = numberOrNull(cells[7]);
    const page = canonicalFundPage(linkUrl(cells[1]) || linkUrl(cells[0]), ticker);
    seen.add(ticker);
    funds.push({
      ticker,
      name,
      category: normalizeCategory(parseMarkdownCell(cells[2])),
      categoryPath: `${parseMarkdownCell(cells[2])} / ${parseMarkdownCell(cells[3])}`.replace(/\s*\/\s*$/, ''),
      inception: toIsoDate(parseMarkdownCell(cells[4])) || null,
      exchange: '',
      cusip: '',
      isin: '',
      benchmark: '',
      ter,
      grossTer,
      nav: null,
      close: null,
      premiumDiscount: null,
      netAssets: aumThousands === null ? null : round(aumThousands * 1000, 2),
      dividendYield: numberOrNull(cells[8]),
      secYield: null,
      asOfDate: catalogDate,
      returns: { ...EMPTY_RETURNS },
      fundPage: page,
      source: 'wisdomtree',
    });
  }
  if (!funds.length) throw new Error('WisdomTree product table: no fund rows found');
  return funds.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/** Percent from a fraction (0.0015 -> 0.15), the unit the product table showed. */
function fractionToPercent(value: unknown, digits: number): number | null {
  const parsed = numberOrNull(value);
  return parsed === null ? null : round(parsed * 100, digits);
}

/** The fund list JSON as served directly (an array) or through the rendering proxy (a JSON envelope whose data.content holds the array). */
export function parseFundListJson(text: string): CatalogFund[] {
  let payload: unknown;
  try {
    payload = JSON.parse(String(text ?? ''));
  } catch {
    throw new Error('WisdomTree fund list: response was not JSON');
  }
  const content = (payload as JsonRecord)?.data?.content;
  if (!Array.isArray(payload) && typeof content === 'string') {
    try {
      payload = JSON.parse(content);
    } catch {
      throw new Error('WisdomTree fund list: proxy content was not JSON');
    }
  }
  if (!Array.isArray(payload)) throw new Error('WisdomTree fund list: no fund array found');
  const funds: CatalogFund[] = [];
  const seen = new Set<string>();
  for (const row of payload as JsonRecord[]) {
    const ticker = sanitizeTicker(row?.bloombergTicker || row?.exchangeTicker);
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    const tier1 = cleanText(row.fundCategoryTier1);
    const aum = numberOrNull(row.AUM ?? row.Net_Assets);
    funds.push({
      ticker,
      name: cleanText(row.name) || ticker,
      category: normalizeCategory(tier1),
      categoryPath: `${tier1} / ${cleanText(row.fundCategoryTier2)}`.replace(/\s*\/\s*$/, ''),
      inception: toIsoDate(row.inceptionDt) || null,
      exchange: '',
      cusip: '',
      isin: '',
      benchmark: '',
      ter: fractionToPercent(row.expenseRatio, 4),
      grossTer: fractionToPercent(row.grossExpenseRatio, 4),
      nav: null,
      close: null,
      premiumDiscount: null,
      netAssets: aum === null ? null : round(aum, 2),
      dividendYield: fractionToPercent(row.TTMYieldOrdIncome, 2),
      secYield: null,
      asOfDate: toIsoDate(row.AUM_DateTime || row.NAV_Date) || null,
      returns: { ...EMPTY_RETURNS },
      fundPage: canonicalFundPage(cleanText(row.url), ticker),
      source: 'wisdomtree',
    });
  }
  if (!funds.length) throw new Error('WisdomTree fund list: no fund rows found');
  return funds.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

async function paceRequests(): Promise<void> {
  const now = Date.now();
  let lane = 0;
  for (let i = 1; i < requestGates.length; i++) if (requestGates[i] < requestGates[lane]) lane = i;
  const wait = Math.max(0, requestGates[lane] - now);
  // The lane slot is reserved synchronously, before awaiting.
  requestGates[lane] = Math.max(now, requestGates[lane]) + Math.max(0, requestSleepSeconds * 1000);
  if (wait) await sleep(wait);
}

// r.jina.ai is shared by every worker: one global gate, the slot is reserved before awaiting.
let proxyNextStart = 0;
async function paceProxy(config: UpdaterConfig): Promise<void> {
  const now = Date.now();
  const start = Math.max(now, proxyNextStart);
  proxyNextStart = start + Math.max(0, config.proxyGapMs);
  if (start > now) await sleep(start - now);
}

// Set when wisdomtree.com answered a direct request with a Cloudflare block: later funds in the run go straight to the proxy.
let directBlocked = false;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

function retryable(error: unknown): boolean {
  if (error instanceof HttpError) return error.status === 403 || error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
  return true;
}

/** One request with a timeout that covers headers and body. */
async function fetchOnce(url: string, config: UpdaterConfig, headers: Record<string, string>): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': GENERIC_UA, Accept: '*/*', ...headers }, signal: AbortSignal.timeout(config.fetchTimeoutMs) });
  if (!response.ok) throw new HttpError(response.status, `${response.status} ${response.statusText}`);
  return await response.text();
}

async function fetchText(url: string, label: string, config: UpdaterConfig, headers: Record<string, string> = {}): Promise<string> {
  let lastError: unknown = new Error('no request attempted');
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    try {
      await paceRequests();
      return await fetchOnce(url, config, headers);
    } catch (error) {
      lastError = error;
      if (attempt >= config.maxRetries || !retryable(error)) break;
      await sleep(Math.min(30_000, config.retryDelayMs * 2 ** attempt));
    }
  }
  throw new Error(`${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function fetchJson(url: string, label: string, config: UpdaterConfig, headers: Record<string, string> = {}): Promise<JsonRecord> {
  const text = await fetchText(url, label, config, { Accept: 'application/json', ...headers });
  try {
    return JSON.parse(text) as JsonRecord;
  } catch {
    throw new Error(`${label}: response was not JSON`);
  }
}

/** The read-only r.jina.ai rendering: one global gate (>= 3.2 s between starts), at most one retry, and a verification page counts as a failure. */
async function fetchViaProxy(url: string, label: string, config: UpdaterConfig, valid: (text: string) => boolean, accept = 'text/markdown'): Promise<string> {
  let lastError: unknown = new Error('no request attempted');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await paceProxy(config);
      const text = await fetchOnce(url, config, { Accept: accept });
      if (!valid(text)) throw new Error('proxy returned a verification page or an unexpected document');
      return text;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

/** Direct first (a single read-only GET, no retry), the proxy only as the fallback. A Cloudflare block latches for the rest of the run. */
async function fetchWisdomTreePage(directUrl: string, proxyUrl: string, label: string, config: UpdaterConfig, valid: (text: string) => boolean, accept?: string): Promise<{ text: string; via: 'direct' | 'proxy' }> {
  if (!directBlocked) {
    try {
      await paceRequests();
      const text = await fetchOnce(directUrl, config, { Accept: accept ?? 'text/markdown,text/html;q=0.9' });
      if (valid(text)) return { text, via: 'direct' };
      directBlocked = true;
    } catch (error) {
      if (error instanceof HttpError && (error.status === 403 || error.status === 429)) directBlocked = true;
    }
  }
  return { text: await fetchViaProxy(proxyUrl, label, config, valid, accept), via: 'proxy' };
}

function looksLikeCatalog(text: string): boolean {
  if (!/WisdomTree Fund\s*\|\s*Fund Ticker/i.test(text)) return false;
  try { return parseCatalogMarkdown(text).length > 0; } catch { return false; }
}

/** A real product page carries the NAV table or the Total Returns section; a Cloudflare "Just a moment" page carries neither. */
export function looksLikeProductPage(text: string): boolean {
  return /###\s+Total Returns\b/i.test(text) || /\|\s*NAV\s*\|/i.test(text) || /\|\s*Closing Market Price\s*\|/i.test(text);
}

function looksLikeFundList(text: string): boolean {
  try { return parseFundListJson(text).length > 0; } catch { return false; }
}

const viaLabel = (via: 'direct' | 'proxy'): string => (via === 'direct' ? '' : ' via read-only rendering proxy');

/** The fund list JSON first (JSON is asked for from the proxy too: its markdown mode meets the verification page), the rendered product table second. */
async function fetchCatalog(config: UpdaterConfig): Promise<{ funds: CatalogFund[]; raw: string; rawName: string; source: string }> {
  try {
    const { text, via } = await fetchWisdomTreePage(WISDOMTREE_FUND_LIST_URL, WISDOMTREE_FUND_LIST_PROXY_URL, 'WisdomTree fund list', config, looksLikeFundList, 'application/json');
    return { funds: parseFundListJson(text), raw: text, rawName: 'fund-list', source: `WisdomTree official fund list${viaLabel(via)}` };
  } catch (error) {
    console.warn(`[ ${'catalog'.padEnd(8)} ] ${error instanceof Error ? error.message : String(error)} - trying the product table`);
  }
  const { text, via } = await fetchWisdomTreePage(WISDOMTREE_CATALOG_URL, WISDOMTREE_CATALOG_PROXY_URL, 'WisdomTree product table', config, looksLikeCatalog);
  return { funds: parseCatalogMarkdown(text), raw: text, rawName: 'product-table', source: `WisdomTree official product table${viaLabel(via)}` };
}

function productProxyUrl(fundPage: string): string {
  try {
    const parsed = new URL(fundPage);
    return `${WISDOMTREE_PRODUCT_PROXY_PREFIX}${parsed.pathname}`;
  } catch {
    return `${WISDOMTREE_PRODUCT_PROXY_PREFIX}/us/products`;
  }
}

function markdownPipeCells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cleanText(cell));
}

function markdownTableValue(markdown: string, label: string): string {
  const wanted = cleanText(label).toLowerCase();
  for (const line of String(markdown ?? '').split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = markdownPipeCells(line);
    if (cells.length >= 2 && cells[0].toLowerCase() === wanted) return cells[1];
  }
  return '';
}

function markdownTableDate(markdown: string, label: string): string | null {
  const lines = String(markdown ?? '').split(/\r?\n/);
  const wanted = cleanText(label).toLowerCase();
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].trim().startsWith('|')) continue;
    const cells = markdownPipeCells(lines[index]);
    if (cells.length < 2 || cells[0].toLowerCase() !== wanted) continue;
    const nearby = lines.slice(Math.max(0, index - 8), index + 1).join(' ');
    const match = /As of\s+([^|\n]+)/i.exec(nearby);
    return match ? toIsoDate(match[1]) : null;
  }
  return null;
}

function heroMetric(markdown: string, labelPattern: string): { value: number | null; asOfDate: string | null } {
  const expression = new RegExp(String.raw`###\s+([^\n]+)\s+${labelPattern}\s+As of\s+([^\n]+)`, 'i');
  const match = expression.exec(String(markdown ?? '').replace(/\r/g, ''));
  return match ? { value: numberOrNull(match[1]), asOfDate: toIsoDate(match[2]) } : { value: null, asOfDate: null };
}

function emptyOfficialReturns(): OfficialProductReturns {
  return { asOfDate: '', mo1: null, qtd: null, ytd: null, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null, navReturns: null, indexReturns: null };
}

function emptyOfficialReturnRow(): OfficialReturnRow {
  return { mo1: null, qtd: null, ytd: null, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null };
}

function applyReturnRowValues(target: OfficialReturnRow, mode: 'cumulative' | 'annual' | null, values: Array<number | null>): void {
  if (mode === 'cumulative') {
    target.mo1 = values[0] ?? null;
    target.qtd = values[1] ?? null;
    target.ytd = values[2] ?? null;
  } else if (mode === 'annual') {
    target.yr1 = values[0] ?? null;
    target.cagr3y = values[1] ?? null;
    target.cagr5y = values[2] ?? null;
    target.cagr10y = values[3] ?? null;
    target.siAnn = values[4] ?? null;
  }
}

// The official "Total Returns" table always carries three rows per section
// (Underlying Index Returns, NAV Returns, Market Price Returns, in that
// order) — verified live against wisdomtree.com/us/products/equity/dgrw and
// .../fixed-income/usfr. Market Price Returns stays the primary row (used
// to merge with the Yahoo fallback elsewhere); NAV Returns and Underlying
// Index Returns are captured alongside as their own labeled rows.
function productReturnSection(block: string, asOfDate: string): OfficialProductReturns | null {
  const lines = block.split(/\r?\n/);
  let mode: 'cumulative' | 'annual' | null = null;
  const result = emptyOfficialReturns();
  result.asOfDate = asOfDate;
  const nav = emptyOfficialReturnRow();
  const index = emptyOfficialReturnRow();
  let found = false;
  let foundNav = false;
  let foundIndex = false;
  for (const line of lines) {
    const cells = line.trim().startsWith('|') ? markdownPipeCells(line) : [];
    const label = cells[0]?.toLowerCase();
    if (label === 'cumulative') mode = 'cumulative';
    if (label === 'average annual') mode = 'annual';
    if (!label) continue;
    const values = cells.slice(1).map((value) => numberOrNull(value));
    if (label === 'market price returns') {
      applyReturnRowValues(result, mode, values);
      found = true;
    } else if (label === 'nav returns') {
      applyReturnRowValues(nav, mode, values);
      foundNav = true;
    } else if (label === 'underlying index returns') {
      applyReturnRowValues(index, mode, values);
      foundIndex = true;
    }
  }
  result.navReturns = foundNav ? nav : null;
  result.indexReturns = foundIndex ? index : null;
  return found ? result : null;
}

export function parseProductPageSummary(markdown: string): ProductPageSummary {
  const source = String(markdown ?? '').replace(/\r/g, '');
  const titleMatch = /^#\s+[A-Z0-9.-]+\s+(.+)$/im.exec(source);
  const officialName = titleMatch ? cleanText(titleMatch[1]) : null;
  const distributionHero = heroMetric(source, 'Distribution yield');
  const secHero = heroMetric(source, '30-day SEC yield');
  const expenseHero = heroMetric(source, 'Net expense ratio');
  const nav = numberOrNull(markdownTableValue(source, 'NAV'));
  const closing = numberOrNull(markdownTableValue(source, 'Closing Market Price'));
  const premium = numberOrNull(markdownTableValue(source, 'Premium/Discount to NAV'));
  const distribution = numberOrNull(markdownTableValue(source, 'Distribution Yield')) ?? distributionHero.value;
  const secYield = numberOrNull(markdownTableValue(source, 'SEC 30-day Yield')) ?? secHero.value;
  const expense = numberOrNull(markdownTableValue(source, 'Expense Ratio')) ?? expenseHero.value;
  const totalAssetsThousands = numberOrNull(markdownTableValue(source, 'Total Assets (000)'));
  const totalReturnsStart = source.search(/###\s+Total Returns\b/i);
  const afterTaxStart = totalReturnsStart >= 0 ? source.slice(totalReturnsStart + 1).search(/###\s+After Tax Returns\b/i) : -1;
  const returnsBlock = totalReturnsStart >= 0 ? source.slice(totalReturnsStart, afterTaxStart >= 0 ? totalReturnsStart + 1 + afterTaxStart : undefined) : '';
  const monthMarker = /Month End Performance\s*\(([^)]+)\)/i.exec(returnsBlock);
  const quarterMarker = /Quarter End Performance\s*\(([^)]+)\)/i.exec(returnsBlock);
  const monthBlockEnd = returnsBlock.search(/\nQuarter End Performance/i);
  const monthBlock = monthBlockEnd >= 0 ? returnsBlock.slice(0, monthBlockEnd) : returnsBlock;
  const quarterBlock = quarterMarker ? returnsBlock.slice(returnsBlock.indexOf(quarterMarker[0])) : '';
  const monthReturns = monthMarker ? productReturnSection(monthBlock, toIsoDate(monthMarker[1])) : null;
  const quarterReturns = quarterMarker ? productReturnSection(quarterBlock, toIsoDate(quarterMarker[1])) : null;
  const productAsOf = (monthReturns?.asOfDate || quarterReturns?.asOfDate || distributionHero.asOfDate || secHero.asOfDate || expenseHero.asOfDate || null) || null;
  // Page-loaded check: the pricing tables (NAV / Closing Market Price rows) and the Total Returns section must both be
  // present. A page missing either came back partial (rendering proxy), so what it lacks is unknown, not an honest absence.
  const sections: ProductPageSections = {
    pricing: /\|\s*(NAV|Closing Market Price)\s*\|/i.test(source),
    returns: totalReturnsStart >= 0 || monthReturns !== null || quarterReturns !== null,
    distributions: /###\s+Recent Distributions\b/i.test(source),
  };
  return {
    sections,
    loadedFully: sections.pricing && sections.returns,
    name: officialName,
    cusip: markdownTableValue(source, 'CUSIP'),
    nav,
    navAsOfDate: markdownTableDate(source, 'NAV'),
    marketPrice: closing,
    marketPriceAsOfDate: markdownTableDate(source, 'Closing Market Price'),
    premiumDiscount: premium,
    distributionYield: distribution,
    secYield,
    netExpenseRatio: expense,
    totalAssets: totalAssetsThousands === null ? null : round(totalAssetsThousands * 1000, 2),
    productAsOfDate: productAsOf,
    officialReturns: { monthEnd: monthReturns, quarterEnd: quarterReturns },
  };
}

// A single row of the official product page's "Recent Distributions" table:
// ex-date plus the full Ordinary Income / Short-Term Capital Gains /
// Long-Term Capital Gains / Return of Capital / Total tax-character
// breakdown. Also used (with only exDate/total populated) to represent a
// Yahoo dividend-event fallback row in the merged distributions table.
export type DistributionRow = {
  exDate: string;
  recordDate: string | null;
  payableDate: string | null;
  ordinaryIncome: number | null;
  shortTermCapitalGains: number | null;
  longTermCapitalGains: number | null;
  returnOfCapital: number | null;
  total: number | null;
};

export const DISTRIBUTION_HEADERS = ['Ex-Date', 'Record Date', 'Payable Date', 'Ordinary Income', 'Short-Term Capital Gains', 'Long-Term Capital Gains', 'Return of Capital', 'Total Distribution'];

// Parses the official "Recent Distributions" table, which — verified live
// against wisdomtree.com/us/products/equity/dgrw and .../fixed-income/usfr —
// carries: Ex-Dividend Date | Record Date | Payable Date | Ordinary Income |
// Short Term Capital Gains | Long Term Capital Gains | Return of Capital |
// Total Distribution. The site only ever shows a small window of the most
// recent distributions here, so this is combined with the Yahoo
// dividend-events history for older ex-dates elsewhere (mergeDistributionRecords).
export function parseOfficialDistributions(markdown: string): DistributionRow[] {
  const source = String(markdown ?? '').replace(/\r/g, '');
  const start = source.search(/###\s+Recent Distributions\b/i);
  if (start < 0) return [];
  const afterHeading = source.slice(start + 1);
  const nextHeading = afterHeading.search(/\n###\s+/);
  const block = nextHeading >= 0 ? source.slice(start, start + 1 + nextHeading) : source.slice(start);
  const rows: DistributionRow[] = [];
  let tableStarted = false;
  for (const line of block.split('\n')) {
    if (!line.trim().startsWith('|')) {
      if (tableStarted && rows.length) break;
      continue;
    }
    const cells = markdownPipeCells(line);
    if (cells.length < 2) continue;
    if (cells[0].toLowerCase() === 'ex-dividend date') { tableStarted = true; continue; }
    if (!tableStarted || /^-+$/.test(cells[0])) continue;
    const exDate = toIsoDate(cells[0]);
    if (!exDate) continue;
    rows.push({
      exDate,
      recordDate: toIsoDate(cells[1]) || null,
      payableDate: toIsoDate(cells[2]) || null,
      ordinaryIncome: numberOrNull(cells[3]),
      shortTermCapitalGains: numberOrNull(cells[4]),
      longTermCapitalGains: numberOrNull(cells[5]),
      returnOfCapital: numberOrNull(cells[6]),
      total: numberOrNull(cells[7]),
    });
  }
  return rows;
}

function yahooToDistributionRow(item: { epoch: number; amount: number }): DistributionRow {
  return {
    exDate: new Date(item.epoch * 1000).toISOString().slice(0, 10),
    recordDate: null,
    payableDate: null,
    ordinaryIncome: null,
    shortTermCapitalGains: null,
    longTermCapitalGains: null,
    returnOfCapital: null,
    total: round(item.amount, 6),
  };
}

// House policy: official issuer data wins whenever it exists and is
// non-empty; Yahoo is used only for ex-dates the official table doesn't
// cover (it only ever shows a handful of the most recent distributions).
export function mergeDistributionRecords(official: DistributionRow[], yahoo: Array<{ epoch: number; amount: number }>): { rows: DistributionRow[]; yahooOnlyCount: number } {
  const officialDates = new Set(official.map((row) => row.exDate));
  const fallbackRows = yahoo
    .filter((item) => !officialDates.has(new Date(item.epoch * 1000).toISOString().slice(0, 10)))
    .map(yahooToDistributionRow);
  const rows = [...fallbackRows, ...official].sort((a, b) => a.exDate.localeCompare(b.exDate));
  return { rows, yahooOnlyCount: fallbackRows.length };
}

function distributionAmount(row: DistributionRow): number | null {
  if (row.total !== null) return row.total;
  const parts = [row.ordinaryIncome, row.shortTermCapitalGains, row.longTermCapitalGains, row.returnOfCapital].filter((value): value is number => value !== null);
  return parts.length ? round(parts.reduce((sum, value) => sum + value, 0), 6) : null;
}

export function distributionRecordEvents(rows: DistributionRow[]): Array<{ epoch: number; amount: number }> {
  const events: Array<{ epoch: number; amount: number }> = [];
  for (const row of rows) {
    const epoch = isoDateEpoch(row.exDate);
    const amount = distributionAmount(row);
    if (epoch !== null && amount !== null) events.push({ epoch, amount });
  }
  return events.sort((a, b) => a.epoch - b.epoch);
}

function distributionRowToCells(row: DistributionRow): string[] {
  const amountCell = (value: number | null) => (value === null ? '—' : String(round(value, 6)));
  return [
    isoToUsDate(row.exDate),
    isoToUsDate(row.recordDate),
    isoToUsDate(row.payableDate),
    amountCell(row.ordinaryIncome),
    amountCell(row.shortTermCapitalGains),
    amountCell(row.longTermCapitalGains),
    amountCell(row.returnOfCapital),
    amountCell(row.total),
  ];
}

/** Funds verified as leveraged whose product-page top holdings may add up to more than TOP_HOLDINGS_MAX_SUM. None yet: the
 * long/short funds WSLS and WTAL publish only an allocation summary (Group, Long, Short, Group Weight), no holdings list. */
const TOP_HOLDINGS_LEVERAGED = new Set<string>();
/** A top-N holdings list covers at most the whole fund; a little slack for rounding. */
const TOP_HOLDINGS_MAX_SUM = 105;

/**
 * The top holdings list of the product page (`### Holdings` section, up to the next heading of level 1-3). Only a table
 * whose header is Name plus a weight column counts as a holdings list; an allocation table, or a list whose weights add
 * up to more than TOP_HOLDINGS_MAX_SUM, yields no rows and a `rejected` reason, so the next source or the published sheet applies.
 */
export function parseTopHoldingsMarkdown(markdown: string, ticker: string, companyNames: Map<string, string> = new Map()): { headers: string[]; rows: JsonRecord[]; asOfDate: string | null; rejected: string | null } {
  const source = String(markdown ?? '').replace(/\r/g, '');
  const heading = /###\s+Holdings\s*\n+####\s+As of\s*([^\n]*)/i.exec(source);
  const asOfDate = heading ? toIsoDate(heading[1]) : null;
  const none = (rejected: string | null) => ({ headers: HOLDINGS_HEADERS, rows: [] as JsonRecord[], asOfDate, rejected });
  const start = source.search(/###\s+Holdings\b/i);
  if (start < 0) return none(null);
  const section: string[] = [];
  for (const line of source.slice(start).split('\n').slice(1)) {
    if (/^#{1,3}\s/.test(line.trim())) break;
    section.push(line.trim());
  }
  // Tables are runs of consecutive pipe lines; the first one with a Name and a weight header is the holdings list.
  const tables: string[][][] = [];
  let previousWasTable = false;
  for (const line of section) {
    const isTable = line.startsWith('|');
    if (isTable && !previousWasTable) tables.push([]);
    if (isTable) tables[tables.length - 1].push(line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cleanText));
    previousWasTable = isTable;
  }
  const table = tables.find((rows) => rows[0][0].toLowerCase() === 'name' && rows[0].some((cell, i) => i > 0 && /^weight\b/i.test(cell)));
  if (!table) return none(tables.length ? `no Name and weight table (headers: ${tables.map((rows) => rows[0].join(', ')).join('; ')})` : null);
  const weightAt = table[0].findIndex((cell, i) => i > 0 && /^weight\b/i.test(cell));
  const rows: JsonRecord[] = [];
  let sum = 0;
  for (const cells of table.slice(1)) {
    const name = cells[0];
    if (!name || /^:?-+:?$/.test(name) || name.toLowerCase() === 'remaining portfolio') continue;
    const weight = numberOrNull(cells[weightAt]);
    sum += weight ?? 0;
    const key = nportNameKey(name);
    const resolvedTicker = companyNames.get(key) || companyNames.get(key.replace(/ CL [A-Z]$/, '')) || '-';
    // a weight that is no number stays empty (never "0"), so the holdings guard can reject the list
    rows.push({ Name: name, Ticker: resolvedTicker || '-', Identifier: '-', Weight: weight === null ? '' : String(weight), 'Market Value': '-', 'Shares Held': '-', 'Asset Category': '-' });
  }
  if (sum > TOP_HOLDINGS_MAX_SUM && !TOP_HOLDINGS_LEVERAGED.has(ticker)) return none(`top holdings add up to ${round(sum, 2)}, more than ${TOP_HOLDINGS_MAX_SUM}`);
  return { headers: HOLDINGS_HEADERS, rows, asOfDate, rejected: null };
}

function secHeaders(): Record<string, string> {
  return { 'User-Agent': SEC_UA, Accept: 'application/json, application/xml, text/xml, text/plain' };
}

/** A fresh SEC state for a run (runUpdate and tests). */
export function resetSecState(): void {
  secState = { funds: null, names: null, reader: new Map() };
}

/** SEC's ticker -> registrant CIK + series id table, loaded once per run (a failed load is asked again by the next fund). */
function loadFundTickerTable(config: UpdaterConfig): Promise<Map<string, NportSeriesRef>> {
  if (!secState.funds) {
    const loading = fetchJson(SEC_FUND_TICKERS_URL, '[ edgar    ] fund ticker table', config, secHeaders()).then((payload) => parseSecFundTickers(payload));
    secState.funds = loading;
    loading.catch(() => { if (secState.funds === loading) secState.funds = null; });
  }
  return secState.funds;
}

/** SEC's company name -> ticker table (N-PORT rows and product-page top holdings), loaded once per run. */
function loadCompanyNames(config: UpdaterConfig): Promise<Map<string, string>> {
  if (!secState.names) {
    const loading = fetchJson(SEC_COMPANY_TICKERS_URL, '[ edgar    ] company ticker table', config, secHeaders()).then((payload) => parseSecCompanyNames(payload));
    secState.names = loading;
    loading.catch(() => { if (secState.names === loading) secState.names = null; });
  }
  return secState.names;
}

/** Nasdaq Trader symbol directories for the N-PORT rows (shared nport-reader `readUsListings`), loaded once per run: a row with a
 * foreign ISIN keeps a ticker only for the company's own U.S. listing in U.S. dollars (Linde, NXP, IMAX). null when either failed. */
let usListings: Promise<Map<string, string> | null> | null = null;
function loadUsListings(getText: (url: string, label: string) => Promise<string>): Promise<Map<string, string> | null> {
  if (!usListings) usListings = readUsListings(getText);
  return usListings;
}

/**
 * The WisdomTree holdings sheet of an N-PORT filing: HOLDINGS_HEADERS, plus Coupon and Maturity when the filing holds debt. A
 * missing number stays empty (never 0), a missing text is '-'; tickers come from nportTickers (U.S. equities only).
 */
export function nportHoldingsSheet(filing: NportFiling, tickers: ReadonlyArray<string>): { headers: string[]; rows: JsonRecord[] } {
  const debt = filing.positions.some((position) => Boolean(position.maturity) || position.coupon !== null);
  const rows = filing.positions.map((position, index) => ({
    Name: position.name || '-',
    Ticker: tickers[index] || '-',
    Identifier: nportIdentifier(position) || '-',
    Weight: nportCell(position.weight),
    'Market Value': nportCell(position.value, 2),
    'Shares Held': nportCell(position.balance),
    'Asset Category': position.assetCat || '-',
    ...(debt ? { Coupon: nportCell(position.coupon), Maturity: position.maturity || '-' } : {}),
  }));
  return { headers: debt ? [...HOLDINGS_HEADERS, 'Coupon', 'Maturity'] : HOLDINGS_HEADERS, rows };
}

export function parseChart(payload: JsonRecord): ParsedChart {
  const result = payload?.chart?.result?.[0];
  if (!result) throw new Error('Yahoo chart returned no result');
  const timestamps: number[] = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result.indicators?.quote?.[0] || {};
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose || [];
  const days: ChartDay[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const close = numberOrNull(quote.close?.[i]);
    if (close === null) continue;
    const adjClose = numberOrNull(adjusted[i]) ?? close;
    days.push({ date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10), close, adjClose, volume: numberOrNull(quote.volume?.[i]) ?? 0 });
  }
  const dividends: Array<{ epoch: number; amount: number }> = [];
  for (const [epoch, item] of Object.entries(result.events?.dividends || {})) {
    const amount = numberOrNull((item as JsonRecord)?.amount);
    if (amount !== null) dividends.push({ epoch: Number(epoch), amount });
  }
  dividends.sort((a, b) => a.epoch - b.epoch);
  return {
    days,
    dividends,
    exchangeName: cleanText(result.meta?.exchangeName || result.meta?.fullExchangeName),
    regularMarketPrice: numberOrNull(result.meta?.regularMarketPrice),
    regularMarketTime: numberOrNull(result.meta?.regularMarketTime),
    firstTradeDate: numberOrNull(result.meta?.firstTradeDate),
  };
}

function pctChange(start: number | null, end: number | null): number | null {
  if (start === null || end === null || start === 0) return null;
  return round((end / start - 1) * 100, 2);
}

function annualized(start: number | null, end: number | null, years: number): number | null {
  if (start === null || end === null || start <= 0 || end <= 0 || years <= 0) return null;
  return round(((end / start) ** (1 / years) - 1) * 100, 2);
}

/** Days between two ISO dates (UTC), null when either is not an ISO date. */
function daysBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  const a = toIsoDate(from), b = toIsoDate(to);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
}

/**
 * Since-inception annualized return derived from closes. It is a since-INCEPTION figure only when the series starts at
 * inception (first close within 10 days of the fund's first trade date, the official inception as fallback), so a
 * HISTORY_RANGE window never turns cagr5y into siAnn; null under one year (a few months annualized is noise) or when
 * the inception is unknown.
 */
function annualizedSince(first: ChartDay, end: number, date: Date, inception: string | null): number | null {
  const gap = daysBetween(inception, first.date);
  if (gap === null || gap > 10) return null;
  const years = (date.getTime() - new Date(`${first.date}T00:00:00Z`).getTime()) / (365.25 * 86_400_000);
  return years < 1 ? null : annualized(first.adjClose, end, years);
}

/** The years each return horizon needs (shared young-fund rule, withoutYoungReturns): 1y and since inception one year, 3y, 5y, 10y. */
const YOUNG_FUND_HORIZONS: Record<string, number> = { yr1: 1, cagr3y: 3, cagr5y: 5, cagr10y: 10, siAnn: 1 };

/**
 * WisdomTree publishes "Since Inception" CUMULATIVE for a fund younger than one year (NTSD, launched 2026-03-19: 20.18 as of
 * 2026-09-30) in the Average Annual row. The shared young-fund rule (calendar anniversary of the inception, inclusive, at the
 * table date) nulls every horizon the fund is too young for: main, NAV and index rows; an unknown inception keeps the figures.
 */
export function withoutYoungOfficialReturns(returns: OfficialProductReturns | null, inception: string | null): OfficialProductReturns | null {
  if (!returns) return returns;
  const young = <T extends object>(row: T): T => withoutYoungReturns(row, inception, returns.asOfDate, YOUNG_FUND_HORIZONS);
  return { ...young(returns), navReturns: returns.navReturns ? young(returns.navReturns) : null, indexReturns: returns.indexReturns ? young(returns.indexReturns) : null };
}

function anchor(days: ChartDay[], target: Date): ChartDay | null {
  let found: ChartDay | null = null;
  for (const day of days) {
    if (new Date(`${day.date}T00:00:00Z`) <= target) found = day;
    else break;
  }
  return found;
}

/** `inception`: the fund's first trade date (Yahoo) or official inception, ISO; siAnn stays null without it. */
export function priceReturns(days: ChartDay[], inception: string | null = null): PriceReturns {
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const last = ordered[ordered.length - 1];
  if (!last) return { ...EMPTY_PRICE_RETURNS };
  const date = new Date(`${last.date}T00:00:00Z`);
  const target = (years: number) => new Date(date.getTime() - years * 365.25 * 86_400_000);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const quarterStartMonth = Math.floor(date.getUTCMonth() / 3) * 3;
  const quarterStart = new Date(Date.UTC(date.getUTCFullYear(), quarterStartMonth, 1));
  // Same day one month back, clamped to the end of a shorter month (Oct 31 -> Sep 30, never "Sep 31" = Oct 1).
  const lastDayOfPreviousMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 0)).getUTCDate();
  const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, Math.min(date.getUTCDate(), lastDayOfPreviousMonth)));
  const start = (d: ChartDay | null) => d?.adjClose ?? null;
  const end = last.adjClose;
  return {
    asOfDate: last.date,
    mo1: pctChange(start(anchor(ordered, monthStart)), end),
    qtd: pctChange(start(anchor(ordered, quarterStart)), end),
    ytd: pctChange(start(anchor(ordered, yearStart)), end),
    yr1: pctChange(start(anchor(ordered, target(1))), end),
    cagr3y: annualized(start(anchor(ordered, target(3))), end, 3),
    cagr5y: annualized(start(anchor(ordered, target(5))), end, 5),
    cagr10y: annualized(start(anchor(ordered, target(10))), end, 10),
    siAnn: ordered.length > 1 ? annualizedSince(ordered[0], end, date, inception) : null,
  };
}

export function inferDistributionFrequency(dividends: Array<{ epoch: number; amount: number }>): { frequency: string; paymentsPerYear: number | null } {
  if (!dividends.length) return { frequency: 'None', paymentsPerYear: null };
  if (dividends.length < 2) return { frequency: 'Unknown', paymentsPerYear: null };
  const recent = dividends.slice(-8);
  const gaps = recent.slice(1).map((item, index) => (item.epoch - recent[index].epoch) / 86_400).filter((gap) => gap > 0);
  if (!gaps.length) return { frequency: 'Unknown', paymentsPerYear: null };
  const average = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
  if (average <= 45) return { frequency: 'Monthly', paymentsPerYear: 12 };
  if (average <= 120) return { frequency: 'Quarterly', paymentsPerYear: 4 };
  if (average <= 240) return { frequency: 'Semi-Annual', paymentsPerYear: 2 };
  if (average <= 500) return { frequency: 'Annual', paymentsPerYear: 1 };
  return { frequency: 'Irregular', paymentsPerYear: null };
}

export type DividendYieldBasis = 'official-trailing-12m' | 'official-distribution-rate' | 'official-other' | 'computed-trailing-12m' | 'indicated';
const DIVIDEND_YIELD_BASES: readonly string[] = ['official-trailing-12m', 'official-distribution-rate', 'official-other', 'computed-trailing-12m', 'indicated'];
export const YIELD_KIND_OFFICIAL = 'trailing 12-month, published by WisdomTree catalog (a published 0.00% is kept as published)';
export const YIELD_KIND_INDICATED = 'indicated (latest distribution x inferred frequency / market price)';

/** Maps the yield kind text of a published meta.yields (or an already stored code) to a standard code; null when the yield is null. */
export function dividendYieldBasisFromKind(kind: unknown, yieldValue: number | null): DividendYieldBasis | null {
  if (yieldValue === null) return null;
  const text = String(kind ?? '');
  if (DIVIDEND_YIELD_BASES.includes(text)) return text as DividendYieldBasis;
  if (text === YIELD_KIND_OFFICIAL) return 'official-trailing-12m';
  return 'indicated';
}

export const RETURNS_BASIS_OFFICIAL = 'official WisdomTree product-page Market Price Returns (month-end table); gaps filled with estimates derived from Yahoo Finance adjusted closes';
export const RETURNS_BASIS_DERIVED = 'estimates derived from Yahoo Finance adjusted market-price closes, not official WisdomTree NAV returns';

/** performanceAsOf: the provider's month-end performance table date, or the last Yahoo close date when derived; null when unknown. */
export function performanceAsOfDate(returns: PriceReturns): string | null {
  const iso = toIsoDate(returns.asOfDate);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

export function deriveMetrics(derived: PriceReturns, fund: CatalogFund, dividends: Array<{ epoch: number; amount: number }>, frequency: { paymentsPerYear: number | null }, price: number | null, official = false): JsonRecord {
  const latest = dividends[dividends.length - 1];
  const indicated = fund.dividendYield ?? (latest && frequency.paymentsPerYear && price ? round((latest.amount * frequency.paymentsPerYear / price) * 100, 2) : null);
  const dividendYieldBasis: DividendYieldBasis | null = indicated === null ? null : fund.dividendYield !== null ? (fund.dividendYieldBasis ?? 'official-trailing-12m') : 'indicated';
  return {
    ytd: derived.ytd,
    tr1y: derived.yr1,
    tr3y: annualizedToTotal(derived.cagr3y, 3),
    tr5y: annualizedToTotal(derived.cagr5y, 5),
    tr10y: annualizedToTotal(derived.cagr10y, 10),
    cagr3y: derived.cagr3y,
    cagr5y: derived.cagr5y,
    cagr10y: derived.cagr10y,
    siAnn: derived.siAnn,
    dividendYield: indicated,
    dividendYieldText: indicated === null ? '—' : `${indicated.toFixed(2)}%`,
    dividendYieldBasis,
    secYield: fund.secYield,
    secYieldText: fund.secYield === null ? '—' : `${fund.secYield.toFixed(2)}%`,
    returnsBasis: official ? RETURNS_BASIS_OFFICIAL : RETURNS_BASIS_DERIVED,
    performanceAsOf: performanceAsOfDate(derived),
  };
}

// Yahoo's adjusted close is float32 and its last digits move with the request's period2, so a value
// sitting on a cent boundary (31.544998 vs 31.545001) flips between runs. Within that noise the
// published cent is kept: a rerun with the same source data changes nothing.
export const ADJ_CLOSE_NOISE = 1e-4;
export function keepPublishedAdjClose(adjClose: number, published: unknown): string {
  const fresh = String(round(adjClose, 2));
  const prior = numberOrNull(published);
  return prior !== null && fresh !== String(published) && Math.abs(adjClose - prior) <= 0.005 + ADJ_CLOSE_NOISE ? String(published) : fresh;
}

export function historyRows(days: ChartDay[], published: JsonRecord[] = []): JsonRecord[] {
  // Yahoo recomputes the split/dividend-adjusted close on every request; storing
  // the raw float lets the last digit or two jitter between otherwise identical
  // requests, making every history row (and the fund) look "updated" on every
  // single run. Rounding to 2 decimals is well past any meaningful price
  // precision and absorbs that jitter; keepPublishedAdjClose absorbs the cent-boundary flips.
  const publishedAdj = new Map(published.map((row) => [toIsoDate(row.Date), row['Adj Close']]));
  return days.map((day) => ({ Date: formatDate(day.date), Close: String(day.close), 'Adj Close': keepPublishedAdjClose(day.adjClose, publishedAdj.get(day.date)), Volume: String(day.volume) }));
}

/**
 * Official tenors win, gaps are filled from the Yahoo estimate. The caller applies the young-fund rule to the result at the
 * official table date, so a horizon the fund is too young for is never filled with a Yahoo estimate dated weeks later
 * (WQTM: -9.59 to 2026-10-23 published as of 2026-09-30).
 */
export function mergeOfficialReturns(derived: PriceReturns, official: OfficialProductReturns | null): PriceReturns {
  if (!official) return derived;
  return {
    ...derived,
    asOfDate: official.asOfDate || derived.asOfDate,
    mo1: official.mo1 ?? derived.mo1,
    qtd: official.qtd ?? derived.qtd,
    ytd: official.ytd ?? derived.ytd,
    yr1: official.yr1 ?? derived.yr1,
    cagr3y: official.cagr3y ?? derived.cagr3y,
    cagr5y: official.cagr5y ?? derived.cagr5y,
    cagr10y: official.cagr10y ?? derived.cagr10y,
    siAnn: official.siAnn ?? derived.siAnn,
  };
}

function pctText(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}%`;
}

// month-end nested rows keep the same Text-suffixed convention as the
// primary monthEnd fields they sit alongside.
function formatOfficialReturnRow(row: OfficialReturnRow | null): JsonRecord | null {
  if (!row) return null;
  return {
    mo1: row.mo1, mo1Text: pctText(row.mo1),
    qtd: row.qtd, qtdText: pctText(row.qtd),
    ytd: row.ytd, ytdText: pctText(row.ytd),
    yr1: row.yr1, yr1Text: pctText(row.yr1),
    yr3: row.cagr3y, yr3Text: pctText(row.cagr3y),
    yr5: row.cagr5y, yr5Text: pctText(row.cagr5y),
    yr10: row.cagr10y, yr10Text: pctText(row.cagr10y),
    sinceInception: row.siAnn, sinceInceptionText: pctText(row.siAnn),
  };
}

// quarter-end nested rows keep the same plain-value convention (no Text
// fields) as the primary quarterEnd fields they sit alongside.
function formatOfficialReturnRowPlain(row: OfficialReturnRow | null): JsonRecord | null {
  if (!row) return null;
  return { ytd: row.ytd, yr1: row.yr1, yr3: row.cagr3y, yr5: row.cagr5y, yr10: row.cagr10y, sinceInception: row.siAnn };
}

function parsePreviousFund(ticker: string, row: JsonRecord): CatalogFund {
  const metrics = row.metrics || {};
  const monthEnd = row.returns?.monthEnd || {};
  return {
    ticker,
    name: String(row.name || ticker),
    category: String(row.category || 'ETF'),
    categoryPath: String(row.category || 'ETF'),
    inception: toIsoDate(row.inceptionDate) || null,
    exchange: String(row.exchange || ''),
    cusip: String(row.cusip || ''),
    isin: String(row.isin || ''),
    benchmark: '',
    ter: numberOrNull(row.terValue),
    grossTer: numberOrNull(row.terGrossValue),
    nav: numberOrNull(row.navValue),
    close: numberOrNull(row.closePriceValue),
    premiumDiscount: numberOrNull(row.premiumDiscountValue),
    netAssets: numberOrNull(row.aumValue),
    dividendYield: numberOrNull(metrics.dividendYield),
    dividendYieldBasis: dividendYieldBasisFromKind(metrics.dividendYieldBasis, numberOrNull(metrics.dividendYield)),
    secYield: numberOrNull(metrics.secYield),
    asOfDate: null,
    returns: { ytd: numberOrNull(monthEnd.ytd), yr1: numberOrNull(monthEnd.yr1), yr3: numberOrNull(monthEnd.yr3), yr5: numberOrNull(monthEnd.yr5), yr10: numberOrNull(monthEnd.yr10), sinceInception: numberOrNull(monthEnd.sinceInception) },
    fundPage: String(row.fundPage || `${WISDOMTREE_SITE}/us/products/etf/${ticker.toLowerCase()}`),
    source: 'previous index',
  };
}

async function readPreviousIndex(): Promise<Map<string, JsonRecord>> {
  try {
    const data = JSON.parse(await readFile(INDEX_FILE, 'utf8')) as JsonRecord;
    const map = new Map<string, JsonRecord>();
    for (const row of Array.isArray(data.funds) ? data.funds : []) if (row?.ticker) map.set(String(row.ticker), row);
    return map;
  } catch {
    return new Map();
  }
}

async function readPreviousMeta(ticker: string): Promise<JsonRecord | null> {
  try {
    return JSON.parse(await readFile(new URL(`funds/${ticker}/meta.json`, API_ROOT), 'utf8')) as JsonRecord;
  } catch {
    return null;
  }
}

async function readPreviousSheet(ticker: string, kind: 'holdings' | 'history'): Promise<JsonRecord[]> {
  const meta = await readPreviousMeta(ticker);
  const pages = meta?.[kind]?.pages;
  if (!Array.isArray(pages)) return [];
  const rows: JsonRecord[] = [];
  for (const page of pages) {
    try {
      const pagePath = String(page).includes('/') ? String(page) : `${kind}/${page}`;
      const data = JSON.parse(await readFile(new URL(`funds/${ticker}/${pagePath}`, API_ROOT), 'utf8')) as JsonRecord;
      if (Array.isArray(data.rows)) rows.push(...data.rows);
    } catch {
      // Keep the rows already recovered from earlier pages.
    }
  }
  return rows;
}

async function readPreviousHeaders(ticker: string, kind: 'holdings' | 'history'): Promise<string[] | null> {
  const meta = await readPreviousMeta(ticker);
  const first = Array.isArray(meta?.[kind]?.pages) ? meta[kind].pages[0] : null;
  if (!first) return null;
  try {
    const pagePath = String(first).includes('/') ? String(first) : `${kind}/${first}`;
    const data = JSON.parse(await readFile(new URL(`funds/${ticker}/${pagePath}`, API_ROOT), 'utf8')) as JsonRecord;
    return Array.isArray(data.headers) ? data.headers : null;
  } catch {
    return null;
  }
}

// Comparing raw text would treat a run that only refreshed generatedAt (with
// every fund's actual data unchanged) as a real change and rewrite the file
// every time. Compare with both timestamps stripped instead.
export function samePublishedContent(previous: string, value: unknown): boolean {
  const withoutRunTimestamp = (item: unknown): unknown => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const { generatedAt, savedAt, ...content } = item as Record<string, unknown>;
    return content;
  };
  try {
    return JSON.stringify(withoutRunTimestamp(JSON.parse(previous))) === JSON.stringify(withoutRunTimestamp(value));
  } catch { return false; }
}

/** Writes through a temp file and a rename so a killed run never leaves a half-written JSON file. */
async function writeAtomic(file: URL, text: string): Promise<void> {
  await mkdir(new URL('.', file), { recursive: true });
  const tmp = new URL(`${file.pathname.split('/').pop()}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file);
  try {
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

async function writeIfChanged(file: URL, value: unknown): Promise<boolean> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  try {
    const previous = await readFile(file, 'utf8');
    if (previous === text || samePublishedContent(previous, value)) return false;
  } catch {
    // New file.
  }
  await writeAtomic(file, text);
  return true;
}

/** Writes the page files and returns the manifest plus the stale page files; those are removed only after the new meta.json is written. */
async function writePages(fundDir: URL, ticker: string, kind: 'holdings' | 'history', headers: string[], rows: JsonRecord[], pageSize: number, asOfDate: string | null, source: string): Promise<{ manifest: JsonRecord; stale: URL[] }> {
  const dir = new URL(`${kind}/`, fundDir);
  const pageCount = rows.length ? Math.ceil(rows.length / pageSize) : 0;
  const kept = new Set<string>();
  for (let page = 0; page < pageCount; page += 1) {
    const name = `${String(page + 1).padStart(3, '0')}.json`;
    kept.add(name);
    await writeIfChanged(new URL(name, dir), { ticker, page: page + 1, pageSize, totalRows: rows.length, headers, rows: rows.slice(page * pageSize, (page + 1) * pageSize) });
  }
  const stale: URL[] = [];
  try {
    for (const name of await readdir(dir)) if (name.endsWith('.json') && !kept.has(name)) stale.push(new URL(name, dir));
  } catch {
    // Directory may not exist on a zero-row first run.
  }
  const manifest = { pages: [...kept].sort().map((name) => `${kind}/${name}`), pageSize, totalRows: rows.length, ...(kind === 'holdings' ? { asOfDate, asOf: asOfDate ? formatDate(asOfDate) : '—', source } : { asOf: asOfDate ? formatDate(asOfDate) : '—', source }) };
  return { manifest, stale };
}

function catalogFilterReasons(fund: CatalogFund, config: UpdaterConfig): string[] {
  const reasons: string[] = [];
  if (config.tickers && !config.tickers.has(fund.ticker)) reasons.push('TICKERS');
  if (!rangeMatches(fund.netAssets, config.aum)) reasons.push('AUM');
  if (!rangeMatches(fund.ter, config.ter)) reasons.push('TER');
  if (!rangeMatches(fund.dividendYield, config.dividendYield)) reasons.push('DIVIDEND_YIELD');
  return reasons;
}

/** Return filters need the fetched returns: a fund whose value for a bounded range is unavailable (null) is excluded. */
function matchesReturnFilters(metrics: JsonRecord, config: UpdaterConfig): string[] {
  const reasons: string[] = [];
  const annual: Record<ReturnPeriod, number | null> = { YTD: metrics.ytd, '1Y': metrics.tr1y, '3Y': metrics.cagr3y, '5Y': metrics.cagr5y, '10Y': metrics.cagr10y };
  const cumulative: Record<ReturnPeriod, number | null> = { YTD: metrics.ytd, '1Y': metrics.tr1y, '3Y': metrics.tr3y, '5Y': metrics.tr5y, '10Y': metrics.tr10y };
  for (const [period, range] of Object.entries(config.performance) as [ReturnPeriod, Range][]) if (!rangeMatches(annual[period], range)) reasons.push(`PERFORMANCE_${period}`);
  for (const [period, range] of Object.entries(config.totalReturn) as [ReturnPeriod, Range][]) if (!rangeMatches(cumulative[period], range)) reasons.push(`TOTAL_RETURN_${period}`);
  return reasons;
}

/** US ISIN from a 9-character CUSIP: country code US + CUSIP + Luhn check digit. Null when the CUSIP is malformed. */
export function isinFromCusip(cusip: string): string | null {
  const c = String(cusip ?? '').trim().toUpperCase();
  if (!/^[0-9A-Z]{8}[0-9]$/.test(c)) return null;
  const digits = [...`US${c}`].map((ch) => (/\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55))).join('');
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return `US${c}${(10 - (sum % 10)) % 10}`;
}

const NULL_QUARTER_END = { asOfDate: '—', ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null, navReturns: null, indexReturns: null };
const METRIC_KEYS = ['ytd', 'tr1y', 'tr3y', 'tr5y', 'tr10y', 'cagr3y', 'cagr5y', 'cagr10y', 'siAnn', 'dividendYield', 'dividendYieldText', 'dividendYieldBasis', 'secYield', 'secYieldText', 'returnsBasis', 'performanceAsOf'] as const;

function monthEndToPriceReturns(monthEnd: JsonRecord): PriceReturns {
  const iso = toIsoDate(monthEnd?.asOfDate);
  return {
    asOfDate: /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : '',
    mo1: numberOrNull(monthEnd?.mo1), qtd: numberOrNull(monthEnd?.qtd), ytd: numberOrNull(monthEnd?.ytd), yr1: numberOrNull(monthEnd?.yr1),
    cagr3y: numberOrNull(monthEnd?.yr3), cagr5y: numberOrNull(monthEnd?.yr5), cagr10y: numberOrNull(monthEnd?.yr10), siAnn: numberOrNull(monthEnd?.sinceInception),
  };
}

/** Rows of a published distributions table (US-formatted date cells) back into DistributionRow values. */
function distributionRowsFromTable(rows: unknown): DistributionRow[] {
  const isoOrNull = (cell: unknown): string | null => { const iso = toIsoDate(cell); return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null; };
  const result: DistributionRow[] = [];
  for (const cells of Array.isArray(rows) ? rows : []) {
    if (!Array.isArray(cells)) continue;
    const exDate = isoOrNull(cells[0]);
    if (!exDate) continue;
    result.push({ exDate, recordDate: isoOrNull(cells[1]), payableDate: isoOrNull(cells[2]), ordinaryIncome: numberOrNull(cells[3]), shortTermCapitalGains: numberOrNull(cells[4]), longTermCapitalGains: numberOrNull(cells[5]), returnOfCapital: numberOrNull(cells[6]), total: numberOrNull(cells[7] ?? cells[cells.length - 1]) });
  }
  return result;
}

const isOfficialSource = (value: unknown): boolean => /^WisdomTree (official|product-page)/.test(String(value ?? ''));

/**
 * Where the published net assets came from. When this run's catalog row is the previous index (the live catalog
 * was unreachable or did not list the fund), the value is the published one, so its published source label is kept
 * too: a rerun with the same upstream data must not relabel it (product table -> N-PORT) and flip the fund to updated.
 */
export function aumSource(fund: Pick<CatalogFund, 'source' | 'netAssets'>, nport: { netAssets?: number | null; repPdDate?: string | null } | null | undefined, previousMeta: JsonRecord | null): string {
  if (fund.source === 'wisdomtree') return 'WisdomTree product table Assets Under Mgmt $(000)';
  if (fund.netAssets !== null && previousMeta?.aum?.source) return String(previousMeta.aum.source);
  return nport ? `SEC Form N-PORT-P net assets (${nport.repPdDate || 'n/a'})` : 'previous run';
}

async function processFund(fund: CatalogFund, config: UpdaterConfig, previous: JsonRecord = {}): Promise<JsonRecord> {
  const reasons = catalogFilterReasons(fund, config);
  if (reasons.length) {
    return { __skipped: true, ticker: fund.ticker, __skipReasons: reasons };
  }
  const fundDir = new URL(`funds/${fund.ticker}/`, API_ROOT);
  const previousMeta = await readPreviousMeta(fund.ticker);
  let fresh = false;
  let productPageMarkdown: string | null = null;
  let productSummary: ProductPageSummary | null = null;
  let productVia: 'direct' | 'proxy' | null = null;
  if (!config.skipWisdomTree && fund.fundPage) {
    try {
      const page = await fetchWisdomTreePage(fund.fundPage, productProxyUrl(fund.fundPage), `[ product  ] ${fund.ticker}`, config, looksLikeProductPage);
      productPageMarkdown = page.text;
      productVia = page.via;
      productSummary = parseProductPageSummary(productPageMarkdown);
      fresh = true;
      if (productSummary.name) fund.name = productSummary.name;
      if (productSummary.cusip) fund.cusip = productSummary.cusip;
      if (productSummary.nav !== null) fund.nav = productSummary.nav;
      if (productSummary.marketPrice !== null) fund.close = productSummary.marketPrice;
      if (productSummary.premiumDiscount !== null) fund.premiumDiscount = productSummary.premiumDiscount;
      if (productSummary.netExpenseRatio !== null) fund.ter = productSummary.netExpenseRatio;
      if (productSummary.secYield !== null) fund.secYield = productSummary.secYield;
    } catch (error) {
      productPageMarkdown = null;
      productSummary = null;
      outputNote(`[ ${'product'.padEnd(8)} ] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const productFetched = productSummary !== null;
  // A page that came back partial (see `loadedFully`) says nothing about the sections it lacks: each missing section counts as a
  // FAILED read, exactly like a failed page, and is kept from the previous run as one unit. A fully loaded page lacking a field is an honest null.
  const partialPage = productSummary !== null && !productSummary.loadedFully;
  const pricingFailed = !productFetched || (partialPage && !productSummary!.sections.pricing);
  const returnsFailed = !productFetched || (partialPage && !productSummary!.sections.returns);
  const distributionsFailed = !productFetched || (partialPage && !productSummary!.sections.distributions);
  if (partialPage) {
    const lacking = [pricingFailed && 'NAV/price/premium', returnsFailed && 'returns', distributionsFailed && 'distributions'].filter(Boolean).join(', ');
    outputNote(`[ ${'kept'.padEnd(8)} ] ${fund.ticker}: product page came back partial, kept the published ${lacking}`);
  }
  if (!productFetched || (partialPage && fund.secYield === null)) fund.secYield = fund.secYield ?? numberOrNull(previous.metrics?.secYield);
  fund.cusip = fund.cusip || String(previous.cusip || '');
  fund.isin = fund.isin || String(previous.isin || '') || isinFromCusip(fund.cusip) || '';
  // SEC yield is only known after the product page, so this filter is applied here rather than from the catalog row.
  if (!rangeMatches(fund.secYield, config.secYield)) return { __skipped: true, ticker: fund.ticker, __skipReasons: ['SEC_YIELD'] };

  let holdingsRows: JsonRecord[] = [];
  let holdingsHeaders = HOLDINGS_HEADERS;
  let holdingsAsOf: string | null = null;
  let holdingsSource = 'not available from current public SEC filing';
  let nport: NportFiling | null = null;
  let holdingsFresh = false; // false while holdingsRows is the previous run's sheet
  if (config.edgarFallback) {
    try {
      // The fund's own newest filing (series id from SEC's fund ticker table), read only when strictly newer than the published
      // N-PORT sheet (shared nport-reader block). A published product-page top-N list is no full schedule to compare with: the
      // first N-PORT filing replaces it whatever its date (the top-N date moves every day and would block N-PORT forever).
      const topList = /^WisdomTree product page/.test(String(previousMeta?.holdings?.source || ''));
      const published = { asOf: calendarIso(previousMeta?.holdings?.asOfDate), rows: topList ? 0 : numberOrNull(previousMeta?.holdings?.totalRows) ?? 0 };
      const ref = (await loadFundTickerTable(config)).get(fund.ticker);
      const read = ref
        ? await readNportHoldings({ ticker: fund.ticker, cik: ref.cik, seriesId: ref.seriesId }, published, (url, label) => fetchText(url, `[ nport    ] ${label}`, config, secHeaders()), { cache: secState.reader })
        : { problem: `${fund.ticker}: not in the SEC fund ticker table` };
      if ('problem' in read) outputNote(`[ ${'nport'.padEnd(8)} ] ${read.problem}`);
      else {
        const sheet = nportHoldingsSheet(read.filing, nportTickers(read.filing.positions, await loadCompanyNames(config).catch(() => null), await loadUsListings((url, label) => fetchText(url, `[ nport    ] ${label}`, config, secHeaders()))));
        holdingsRows = sheet.rows;
        holdingsHeaders = sheet.headers;
        holdingsFresh = true;
        holdingsAsOf = read.filing.repPdDate || null;
        nport = read.filing;
        fresh = true;
        holdingsSource = `SEC EDGAR Form N-PORT-P (accession ${read.candidate.accession}, report period ${read.filing.repPdDate || 'n/a'})`;
      }
    } catch (error) {
      outputNote(`[ ${'nport'.padEnd(8)} ] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!holdingsRows.length && config.edgarFallback && productPageMarkdown) {
    const top = parseTopHoldingsMarkdown(productPageMarkdown, fund.ticker, (await loadCompanyNames(config).catch(() => null)) || new Map());
    if (top.rejected) outputNote(`[ ${'holdings'.padEnd(8)} ] ${fund.ticker}: product page top holdings rejected: ${top.rejected}`);
    if (top.rows.length && (!previousMeta?.holdings?.totalRows || /^WisdomTree product page/.test(String(previousMeta.holdings.source || '')))) {
      holdingsRows = top.rows;
      holdingsFresh = true;
      holdingsHeaders = top.headers;
      holdingsAsOf = top.asOfDate;
      holdingsSource = 'WisdomTree product page top holdings (issuer fallback; full N-PORT filing unavailable)';
    }
  }

  if (!holdingsRows.length) {
    const previousSheet = await readPreviousSheet(fund.ticker, 'holdings');
    const previousHeaders = (await readPreviousHeaders(fund.ticker, 'holdings')) || holdingsHeaders;
    // A published sheet that fails the guard on its own is junk, not holdings (WSLS and WTAL published their allocation
    // summary, weights adding up to 581 and 600): it is not republished, the fund has no holdings until a valid source exists.
    const junk = previousSheet.length ? holdingsGuard(previousHeaders, previousSheet, null, HOLDINGS_GUARD_RELAX[fund.ticker] ?? HOLDINGS_GUARD_RELAX['*'] ?? [], holdingsWeightCount(previousHeaders, previousSheet)) : null;
    if (junk) {
      console.warn(`[ ${'holdings'.padEnd(8)} ] ${fund.ticker}: published holdings dropped (${junk}); none until a valid source exists`);
    } else {
      holdingsRows = previousSheet;
      holdingsHeaders = previousHeaders;
      holdingsAsOf = previousMeta?.holdings?.asOfDate || null;
      holdingsSource = previousMeta?.holdings?.source || holdingsSource;
    }
  }

  let chart: ParsedChart | null = null;
  let days: ChartDay[] = [];
  let historySource = 'Yahoo Finance public chart API (adjusted close)';
  const previousRows = await readPreviousSheet(fund.ticker, 'history');
  if (!config.skipYahoo) {
    try {
      const query = yahooChartQuery(config.historyRange);
      const payload = await fetchJson(`${YAHOO_CHART_URL}/${encodeURIComponent(fund.ticker)}?${query.toString()}`, `[ chart    ] ${fund.ticker}`, config, { 'User-Agent': 'Mozilla/5.0' });
      const fetched = parseChart(payload);
      // A HISTORY_RANGE window never shrinks the published history (and with it 3y, 5y, 10y and since inception); the published
      // distributions table is [Ex-Date, ..., Total Distribution], the window merge reads [date, amount]
      const publishedDistributions = (Array.isArray(previousMeta?.distributions?.rows) ? previousMeta.distributions.rows : []).map((cells: unknown) => (Array.isArray(cells) ? [cells[0], cells[cells.length - 1]] : cells));
      chart = Number(query.get('period1')) > 0 ? mergeWindowedChart(fetched, previousRows, publishedDistributions) : fetched;
      if (!chart) throw new Error(`chart window does not join the published history (${config.historyRange})`);
      days = chart.days;
      fresh = fresh || days.length > 0;
    } catch (error) {
      outputNote(`[ ${'chart'.padEnd(8)} ] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // A new fund that no source answered publishes nothing (never an empty meta.json reported updated): it fails and keeps a catalog-only row.
  if (!fresh && !previousMeta) throw new Error('no source answered; no data published for this fund yet');
  if (!days.length) {
    days = previousRows.map((row) => ({ date: toIsoDate(row.Date), close: numberOrNull(row.Close) || 0, adjClose: numberOrNull(row['Adj Close']) || numberOrNull(row.Close) || 0, volume: numberOrNull(row.Volume) || 0 })).filter((row) => row.date && row.close > 0);
    if (previousRows.length) historySource = previousMeta?.history?.source || 'previous run';
  }

  // Official returns, quarter-end returns and the official distributions table come from the product page. When it failed
  // they are retained from the previous run together (returns with their date and basis), never replaced by Yahoo estimates.
  const retainedReturns: JsonRecord | null = returnsFailed && isOfficialSource(previousMeta?.returns?.derivedFrom) && previousMeta?.returns?.monthEnd ? previousMeta.returns : null;
  const retainedDistributions: JsonRecord | null = distributionsFailed && isOfficialSource(previousMeta?.distributions?.source) && Array.isArray(previousMeta?.distributions?.rows) ? previousMeta.distributions : null;
  const officialDistributions = productPageMarkdown && !distributionsFailed ? parseOfficialDistributions(productPageMarkdown) : [];
  const yahooDividends = chart?.dividends || [];
  const merged = mergeDistributionRecords(officialDistributions, yahooDividends);
  const distributionRecords = retainedDistributions ? distributionRowsFromTable(retainedDistributions.rows) : merged.rows;
  const yahooOnlyCount = merged.yahooOnlyCount;
  const distributionEvents = distributionRecordEvents(distributionRecords);
  const frequency = retainedDistributions ? { frequency: String(retainedDistributions.frequency || '—'), paymentsPerYear: numberOrNull(retainedDistributions.paymentsPerYear) } : inferDistributionFrequency(distributionEvents);
  const latest = distributionEvents[distributionEvents.length - 1] || null;
  const firstTrade = chart?.firstTradeDate ? new Date(chart.firstTradeDate * 1000).toISOString().slice(0, 10) : null;
  // The young-fund rule counts from the fund's earliest known start: the catalog inception, Yahoo's first trade or the first
  // history day (GCC joined WisdomTree in 2020 from GreenHaven, trades since 2008 and keeps its official 10-year return)
  const started = [fund.inception, firstTrade, days.length ? days[0].date : null].map((value) => calendarIso(value)).filter((value): value is string => Boolean(value)).sort()[0] ?? null;
  if (productSummary) {
    productSummary.officialReturns = {
      monthEnd: withoutYoungOfficialReturns(productSummary.officialReturns.monthEnd, started),
      quarterEnd: withoutYoungOfficialReturns(productSummary.officialReturns.quarterEnd, started),
    };
  }
  const derived = priceReturns(days, firstTrade ?? fund.inception);
  const officialReturns = returnsFailed ? null : productSummary?.officialReturns.monthEnd || null;
  const mergedReturns = retainedReturns ? monthEndToPriceReturns(retainedReturns.monthEnd) : mergeOfficialReturns(derived, officialReturns);
  // the shared young-fund rule on the final returns: no horizon the fund is too young for at their date, official or derived
  const effectiveReturns = withoutYoungReturns(mergedReturns, started, mergedReturns.asOfDate, YOUNG_FUND_HORIZONS);
  const officialBasis = Boolean(officialReturns) || retainedReturns !== null;

  // NAV, market price and premium/discount travel together: from the page, or all retained when the page failed.
  const retainedQuote = pricingFailed && previous.navValue !== undefined;
  const nav = retainedQuote ? numberOrNull(previous.navValue) : fund.nav;
  const price = retainedQuote
    ? numberOrNull(previous.closePriceValue)
    : productSummary?.marketPrice ?? chart?.regularMarketPrice ?? (days.length ? days[days.length - 1].close : numberOrNull(previous.closePriceValue));
  const marketPrice = price;
  const premiumDiscount = retainedQuote
    ? numberOrNull(previous.premiumDiscountValue)
    : productSummary?.premiumDiscount ?? (nav && productSummary?.marketPrice ? round((productSummary.marketPrice / nav - 1) * 100, 2) : null);
  const metrics = deriveMetrics(effectiveReturns, fund, distributionEvents, frequency, price, officialBasis);
  const returnFilterReasons = matchesReturnFilters(metrics, config);
  if (returnFilterReasons.length) {
    return { __skipped: true, ticker: fund.ticker, __skipReasons: returnFilterReasons };
  }

  // Fresh holdings that look broken (no weight column, non-numeric weights, a bad weight sum, half the rows gone) never replace
  // the published ones: the fund fails before anything of it is written, so it stays exactly as published.
  const publishedWeights = holdingsFresh && previousMeta ? holdingsWeightCount((await readPreviousHeaders(fund.ticker, 'holdings')) || HOLDINGS_HEADERS, await readPreviousSheet(fund.ticker, 'holdings')) : null;
  const holdingsProblem = holdingsFresh ? holdingsGuard(holdingsHeaders, holdingsRows, numberOrNull(previousMeta?.holdings?.totalRows), HOLDINGS_GUARD_RELAX[fund.ticker] ?? HOLDINGS_GUARD_RELAX['*'] ?? [], publishedWeights) : null;
  if (holdingsProblem) throw new Error(`holdings guard: ${holdingsProblem}; ${previousMeta ? 'kept the previous complete data' : 'no data published for this fund yet'}`);

  const history = historyRows(days, previousRows);
  const historyAsOf = derived.asOfDate || previousMeta?.history?.asOf || null;
  const holdingPages = await writePages(fundDir, fund.ticker, 'holdings', holdingsHeaders, holdingsRows, config.holdingsPageSize, holdingsAsOf, holdingsSource);
  const historyPages = await writePages(fundDir, fund.ticker, 'history', historyHeaders(), history, config.historyPageSize, historyAsOf, historySource);
  let distributionHeaders = DISTRIBUTION_HEADERS;
  let distributionTable: string[][];
  let distributionFrequency: string;
  let distributionPaymentsPerYear: number | null;
  let distributionsSource: string;
  if (retainedDistributions) {
    distributionHeaders = retainedDistributions.headers || DISTRIBUTION_HEADERS;
    distributionTable = retainedDistributions.rows;
    distributionFrequency = frequency.frequency;
    distributionPaymentsPerYear = frequency.paymentsPerYear;
    distributionsSource = String(retainedDistributions.source);
  } else if (distributionRecords.length) {
    distributionTable = distributionRecords.map(distributionRowToCells);
    distributionFrequency = frequency.frequency;
    distributionPaymentsPerYear = frequency.paymentsPerYear;
    distributionsSource = officialDistributions.length
      ? (yahooOnlyCount > 0
          ? `WisdomTree official product page Recent Distributions table (${officialDistributions.length} most recent ex-date${officialDistributions.length === 1 ? '' : 's'}; Ex-Date, Record Date, Payable Date and full Ordinary Income/Short-Term/Long-Term Capital Gains/Return of Capital breakdown) plus Yahoo Finance dividend events for ${yahooOnlyCount} earlier ex-date${yahooOnlyCount === 1 ? '' : 's'} the official table does not cover (ex-date and total amount only)`
          : 'WisdomTree official product page Recent Distributions table (Ex-Date, Record Date, Payable Date and full Ordinary Income/Short-Term/Long-Term Capital Gains/Return of Capital breakdown)')
      : 'Yahoo Finance dividend events (ex-date and total amount only; the official WisdomTree Recent Distributions table was unavailable for this fund or the product-page fetch failed)';
  } else {
    distributionHeaders = previousMeta?.distributions?.headers || DISTRIBUTION_HEADERS;
    distributionTable = previousMeta?.distributions?.rows || [];
    distributionFrequency = previousMeta?.distributions?.frequency || '—';
    distributionPaymentsPerYear = previousMeta?.distributions?.paymentsPerYear ?? null;
    distributionsSource = previousMeta?.distributions?.source || 'not available';
  }
  const netAssets = fund.netAssets ?? nport?.netAssets ?? numberOrNull(previous.aumValue);
  const asOfDate = fund.asOfDate || toIsoDate(previous.asOfDate) || null;
  const asOfLabel = asOfDate ? formatDate(asOfDate) : chart?.regularMarketTime ? formatDate(new Date(chart.regularMarketTime * 1000).toISOString().slice(0, 10)) : '—';
  const navAsOfLabel = productSummary?.navAsOfDate ? formatDate(productSummary.navAsOfDate) : retainedQuote && previousMeta?.nav?.asOfDate ? String(previousMeta.nav.asOfDate) : asOfLabel;
  const marketPriceAsOfLabel = productSummary?.marketPriceAsOfDate ? formatDate(productSummary.marketPriceAsOfDate) : retainedQuote && previousMeta?.marketPrice?.asOfDate ? String(previousMeta.marketPrice.asOfDate) : asOfLabel;
  const returns = retainedReturns ?? {
    derivedFrom: officialReturns
      ? 'WisdomTree product-page Market Price Returns where published; Yahoo adjusted market-price closes for missing values. navReturns and indexReturns come from the same official Total Returns table with no non-official fallback (indexReturns is the benchmark index, not the fund itself).'
      : 'adjusted market-price closes (Yahoo chart API), not official WisdomTree NAV returns',
    monthEnd: {
      asOfDate: effectiveReturns.asOfDate ? formatDate(effectiveReturns.asOfDate) : '—',
      mo1: effectiveReturns.mo1, mo1Text: pctText(effectiveReturns.mo1),
      qtd: effectiveReturns.qtd, qtdText: pctText(effectiveReturns.qtd),
      ytd: effectiveReturns.ytd, ytdText: pctText(effectiveReturns.ytd),
      yr1: effectiveReturns.yr1, yr1Text: pctText(effectiveReturns.yr1),
      yr3: effectiveReturns.cagr3y, yr3Text: pctText(effectiveReturns.cagr3y),
      yr5: effectiveReturns.cagr5y, yr5Text: pctText(effectiveReturns.cagr5y),
      yr10: effectiveReturns.cagr10y, yr10Text: pctText(effectiveReturns.cagr10y),
      sinceInception: effectiveReturns.siAnn, sinceInceptionText: pctText(effectiveReturns.siAnn),
      navReturns: formatOfficialReturnRow(officialReturns?.navReturns ?? null),
      indexReturns: formatOfficialReturnRow(officialReturns?.indexReturns ?? null),
    },
    quarterEnd: !returnsFailed && productSummary?.officialReturns.quarterEnd ? {
      asOfDate: formatDate(productSummary.officialReturns.quarterEnd.asOfDate),
      ytd: productSummary.officialReturns.quarterEnd.ytd,
      yr1: productSummary.officialReturns.quarterEnd.yr1,
      yr3: productSummary.officialReturns.quarterEnd.cagr3y,
      yr5: productSummary.officialReturns.quarterEnd.cagr5y,
      yr10: productSummary.officialReturns.quarterEnd.cagr10y,
      sinceInception: productSummary.officialReturns.quarterEnd.siAnn,
      navReturns: formatOfficialReturnRowPlain(productSummary.officialReturns.quarterEnd.navReturns),
      indexReturns: formatOfficialReturnRowPlain(productSummary.officialReturns.quarterEnd.indexReturns),
    } : { ...NULL_QUARTER_END },
  };

  const productPageStatus = productFetched
    ? `fetched ${productVia === 'direct' ? 'directly' : 'through the read-only rendering proxy'}`
    : config.skipWisdomTree
      ? 'skipped (SKIP_WISDOMTREE); official values retained from the previous run'
      : retainedReturns || retainedDistributions || retainedQuote ? 'unavailable this run; official values retained from the previous run' : 'unavailable this run; no previous official values';
  const meta: JsonRecord = {
    ticker: fund.ticker,
    name: fund.name,
    category: fund.category,
    categoryPath: fund.source === 'wisdomtree' ? fund.categoryPath : String(previousMeta?.categoryPath || fund.categoryPath),
    source: {
      fundPage: fund.fundPage,
      officialProductPage: productProxyUrl(fund.fundPage),
      productPageStatus,
      productPageAsOf: productSummary?.productAsOfDate ? formatDate(productSummary.productAsOfDate) : (previousMeta?.source?.productPageAsOf ?? null),
      holdingsDownload: null,
      pricesDownload: null,
      yahooChart: `${YAHOO_CHART_URL}/${encodeURIComponent(fund.ticker)}`,
      holdingsSource,
      historySource,
      distributionsSource,
      provider: 'WisdomTree U.S. product catalog + official WisdomTree product page + SEC EDGAR Form N-PORT-P + Yahoo Finance public chart API',
    },
    identifiers: { cusip: fund.cusip || null, isin: fund.isin || null, isinSource: fund.isin ? 'US ISIN derived from the CUSIP (country code + CUSIP + check digit)' : null, indexTicker: fund.benchmark || null },
    expenseRatio: { display: fund.ter === null ? '—' : `${fund.ter}%`, value: fund.ter, grossDisplay: fund.grossTer === null ? '—' : `${fund.grossTer}%`, grossValue: fund.grossTer, basis: 'value is the net expense ratio (after waivers); grossValue is the gross expense ratio' },
    nav: { display: nav === null ? '—' : `$${nav.toFixed(2)}`, value: nav, asOfDate: navAsOfLabel },
    marketPrice: { display: marketPrice === null ? '—' : `$${marketPrice.toFixed(2)}`, value: marketPrice, asOfDate: marketPriceAsOfLabel },
    premiumDiscount: { display: premiumDiscount === null ? '—' : `${premiumDiscount.toFixed(2)}%`, value: premiumDiscount },
    aum: { display: formatAumDisplay(netAssets), value: netAssets, asOfDate: asOfDate ? formatDate(asOfDate) : (nport?.repPdDate ? formatDate(nport.repPdDate) : '—'), source: aumSource(fund, nport, previousMeta) },
    yields: { dividendYield: metrics.dividendYield, dividendYieldText: metrics.dividendYieldText, dividendYieldBasis: metrics.dividendYieldBasis, dividendYieldKind: metrics.dividendYieldBasis === 'official-trailing-12m' ? YIELD_KIND_OFFICIAL : YIELD_KIND_INDICATED, distributionRate: productSummary?.distributionYield ?? numberOrNull(previousMeta?.yields?.distributionRate), secYield: metrics.secYield, secYieldText: metrics.secYieldText, secYieldKind: metrics.secYield !== null ? '30-day SEC yield published on the official WisdomTree product page' : 'not present in the current official product-page rendering' },
    returns,
    distributions: { frequency: distributionFrequency, paymentsPerYear: distributionPaymentsPerYear, source: distributionsSource, headers: distributionHeaders, rows: distributionTable },
    holdings: holdingPages.manifest,
    history: historyPages.manifest,
  };
  await writeIfChanged(new URL('meta.json', fundDir), meta);
  // Stale pages go only after the new meta.json no longer lists them.
  for (const file of [...holdingPages.stale, ...historyPages.stale]) await rm(file, { force: true });

  return {
    ...buildIndexRow({
      fund,
      nav,
      marketPrice,
      premiumDiscount,
      netAssets,
      asOfLabel,
      inceptionDate: fund.inception ? formatDate(fund.inception) : chart?.firstTradeDate ? formatDate(new Date(chart.firstTradeDate * 1000).toISOString().slice(0, 10)) : (previous.inceptionDate || '—'),
      exchange: fund.exchange || chart?.exchangeName || previous.exchange || '',
      distributions: { frequency: distributionFrequency, exDate: latest ? formatUsDate(latest.epoch) : (previous.distributions?.exDate || '—'), dividend: latest ? String(round(latest.amount, 6)) : (previous.distributions?.dividend || '—') },
      returns,
      metrics,
      holdings: holdingsRows.length,
      history: history.length,
    }),
    __fresh: fresh,
  };
}

type IndexRowInput = {
  fund: Pick<CatalogFund, 'ticker' | 'name' | 'category' | 'fundPage' | 'cusip' | 'isin' | 'ter'> & { grossTer?: number | null };
  nav: number | null;
  marketPrice: number | null;
  premiumDiscount: number | null;
  netAssets: number | null;
  asOfLabel: string;
  inceptionDate: string;
  exchange: string;
  distributions: JsonRecord;
  returns: JsonRecord;
  metrics: JsonRecord;
  holdings: number;
  history: number;
};

/** The one place that shapes an api/wisdomtree/index.json row (used by a live update and by the offline rebuild from meta.json). */
export function buildIndexRow(input: IndexRowInput): JsonRecord {
  const { fund, nav, marketPrice, premiumDiscount, netAssets } = input;
  return {
    ticker: fund.ticker,
    name: fund.name,
    category: fund.category,
    fundPage: fund.fundPage,
    dataFile: `./funds/${fund.ticker}/meta.json`,
    cusip: fund.cusip || null,
    isin: fund.isin || null,
    ter: fund.ter === null ? '—' : `${fund.ter}%`,
    terValue: fund.ter,
    terGross: fund.grossTer === null || fund.grossTer === undefined ? '—' : `${fund.grossTer}%`,
    terGrossValue: fund.grossTer ?? null,
    nav: nav === null ? '—' : `$${nav.toFixed(2)}`,
    navValue: nav,
    aum: formatAumDisplay(netAssets),
    aumValue: netAssets,
    asOfDate: input.asOfLabel,
    inceptionDate: input.inceptionDate,
    exchange: input.exchange,
    closePrice: marketPrice === null ? '—' : `$${marketPrice.toFixed(2)}`,
    closePriceValue: marketPrice,
    premiumDiscount: premiumDiscount === null ? '—' : `${premiumDiscount.toFixed(2)}%`,
    premiumDiscountValue: premiumDiscount,
    distributions: input.distributions,
    returns: input.returns,
    metrics: input.metrics,
    holdings: input.holdings,
    history: input.history,
  };
}

/** The index row of a new fund whose first refresh failed: its catalog listing only (TER and inception, no prices, net assets, returns or files; dataFile and metrics are completed by normalizeIndexRow). */
export function catalogOnlyRow(fund: CatalogFund): JsonRecord {
  return buildIndexRow({
    fund,
    nav: null,
    marketPrice: null,
    premiumDiscount: null,
    netAssets: null,
    asOfLabel: '—',
    inceptionDate: fund.inception ? formatDate(fund.inception) : '—',
    exchange: fund.exchange || '',
    distributions: { frequency: '—', exDate: '—', dividend: '—' },
    returns: {},
    metrics: {},
    holdings: 0,
    history: 0,
  });
}

/** Rebuilds an index row offline from a fund's published meta.json; `previous` (an existing index row) only fills what meta does not carry. Unknown metric inputs stay null, never 0. */
export function rowFromMeta(meta: JsonRecord, firstHistoryDate: string | null = null, previous: JsonRecord = {}): JsonRecord {
  const ticker = String(meta.ticker);
  const monthEnd = meta.returns?.monthEnd || {};
  const asOfIso = toIsoDate(monthEnd.asOfDate);
  const derived: PriceReturns = {
    asOfDate: /^\d{4}-\d{2}-\d{2}$/.test(asOfIso) ? asOfIso : '',
    mo1: numberOrNull(monthEnd.mo1), qtd: numberOrNull(monthEnd.qtd), ytd: numberOrNull(monthEnd.ytd), yr1: numberOrNull(monthEnd.yr1),
    cagr3y: numberOrNull(monthEnd.yr3), cagr5y: numberOrNull(monthEnd.yr5), cagr10y: numberOrNull(monthEnd.yr10), siAnn: numberOrNull(monthEnd.sinceInception),
  };
  const dividends = (Array.isArray(meta.distributions?.rows) ? meta.distributions.rows : [])
    .map((row: string[]) => ({ epoch: Date.parse(`${toIsoDate(row[0])}T00:00:00Z`) / 1000, amount: numberOrNull(row[row.length - 1]) }))
    .filter((item: { epoch: number; amount: number | null }) => Number.isFinite(item.epoch) && item.amount !== null && item.amount > 0) as Array<{ epoch: number; amount: number }>;
  const latest = dividends[dividends.length - 1] || null;
  const frequency = String(meta.distributions?.frequency || previous.distributions?.frequency || '—');
  const paymentsPerYear = numberOrNull(meta.distributions?.paymentsPerYear);
  const marketPrice = numberOrNull(meta.marketPrice?.value);
  const fund = {
    ticker,
    name: String(meta.name || ticker),
    category: String(meta.category || 'ETF'),
    fundPage: String(meta.source?.fundPage || `${WISDOMTREE_SITE}/us/products/etf/${ticker.toLowerCase()}`),
    cusip: String(meta.identifiers?.cusip || ''),
    isin: String(meta.identifiers?.isin || ''),
    ter: numberOrNull(meta.expenseRatio?.value),
    grossTer: numberOrNull(meta.expenseRatio?.grossValue),
    dividendYield: numberOrNull(meta.yields?.dividendYield),
    dividendYieldBasis: dividendYieldBasisFromKind(meta.yields?.dividendYieldBasis ?? meta.yields?.dividendYieldKind, numberOrNull(meta.yields?.dividendYield)),
    secYield: numberOrNull(meta.yields?.secYield),
  };
  const official = /^WisdomTree product-page/.test(String(meta.returns?.derivedFrom || ''));
  const metrics = deriveMetrics(derived, fund as CatalogFund, dividends, { paymentsPerYear }, marketPrice, official);
  const metaLabel = String(meta.aum?.asOfDate || '');
  return buildIndexRow({
    fund,
    nav: numberOrNull(meta.nav?.value),
    marketPrice,
    premiumDiscount: numberOrNull(meta.premiumDiscount?.value),
    netAssets: numberOrNull(meta.aum?.value),
    asOfLabel: previous.asOfDate || (metaLabel && metaLabel !== '—' ? metaLabel : '—'),
    inceptionDate: previous.inceptionDate || (firstHistoryDate ? formatDate(firstHistoryDate) : '—'),
    exchange: previous.exchange || '',
    distributions: { frequency, exDate: latest ? formatUsDate(latest.epoch) : (previous.distributions?.exDate || '—'), dividend: latest ? String(round(latest.amount, 6)) : (previous.distributions?.dividend || '—') },
    returns: meta.returns,
    metrics,
    holdings: numberOrNull(meta.holdings?.totalRows) ?? 0,
    history: numberOrNull(meta.history?.totalRows) ?? 0,
  });
}

/** Every known fund: the published index rows plus a row rebuilt from each funds/<T>/meta.json that the index lacks. Never shrinks. */
export async function readKnownRows(): Promise<Map<string, JsonRecord>> {
  const known = await readPreviousIndex();
  let dirs: string[] = [];
  try { dirs = await readdir(new URL('funds/', API_ROOT)); } catch { dirs = []; }
  for (const ticker of dirs.sort()) {
    if (known.has(ticker)) continue;
    const meta = await readPreviousMeta(ticker);
    if (!meta?.ticker) continue;
    let first: string | null = null;
    try {
      const page = JSON.parse(await readFile(new URL(`funds/${ticker}/${String(meta.history?.pages?.[0] || 'history/001.json')}`, API_ROOT), 'utf8')) as JsonRecord;
      first = toIsoDate(page.rows?.[0]?.Date) || null;
    } catch { first = null; }
    known.set(String(meta.ticker), rowFromMeta(meta, first));
  }
  return known;
}

/** Accepted HISTORY_RANGE values: `max` or a whole number of years such as `5y`. */
export const HISTORY_RANGE_PATTERN = /^(max|[1-9]\d?y)$/;

/** Yahoo chart query. Yahoo ignores `range` when period1=0, so every window is explicit: `max` starts at 0, `Ny` starts N years before now. */
export function yahooChartQuery(historyRange: string, nowSeconds = Math.floor(Date.now() / 1000)): URLSearchParams {
  const query = new URLSearchParams({ interval: '1d', events: 'div|split', includeAdjustedClose: 'true' });
  const years = /^([1-9]\d?)y$/.exec(historyRange || '')?.[1];
  query.set('period1', years ? String(Math.max(0, Math.floor(nowSeconds - Number(years) * 365.25 * 86_400))) : '0');
  query.set('period2', String(nowSeconds + 86_400));
  return query;
}

function historyHeaders(): string[] {
  return ['Date', 'Close', 'Adj Close', 'Volume'];
}

function configLines(config: UpdaterConfig): string[] {
  return [
    `MAX_FETCHES=${config.maxFetches || 'all'}`,
    `REQUEST_SLEEP=${config.requestSleep}s`,
    `CONCURRENCY=${config.concurrency}`,
    `AUM=${config.aum ? JSON.stringify(config.aum) : '—'}`,
    `TER=${config.ter ? JSON.stringify(config.ter) : '—'}`,
    `TICKERS=${config.tickers ? [...config.tickers].join(',') : 'all'}`,
    `EDGAR_FALLBACK=${config.edgarFallback}`,
    `HISTORY_RANGE=${config.historyRange}`,
  ];
}

// --- TLS trust store (identical in every ETF repo) ---
const SYSTEM_CA_MARKER = 'ETF_UPDATER_SYSTEM_CA';
const CERT_ERROR = /UNABLE_TO_GET_ISSUER_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT|CERT_HAS_EXPIRED|unable to get (?:local )?issuer certificate|self[- ]signed certificate|certificate has expired/i;

export function isCertError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; cause?: unknown } | null;
  return CERT_ERROR.test(`${String(e?.code ?? '')} ${String(e?.message ?? '')}`) || (e?.cause ? isCertError(e.cause) : false);
}

export function systemCaActive(env: Record<string, string | undefined> = process.env, execArgv: string[] = process.execArgv): boolean {
  return execArgv.includes('--use-system-ca') || env.NODE_USE_SYSTEM_CA === '1' || env[SYSTEM_CA_MARKER] === '1';
}

export function reexecWithSystemCa(): never {
  const child = Bun.spawnSync([process.execPath, '--use-system-ca', ...process.argv.slice(1)], {
    env: { ...process.env, [SYSTEM_CA_MARKER]: '1' },
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  process.exit(child.exitCode ?? 1);
}

/** mode: auto (restart once on an untrusted-certificate error), true (restart now), false (never). */
export function installSystemCa(mode: string, reexec: () => never = reexecWithSystemCa, active: boolean = systemCaActive()): void {
  if (mode === 'false' || active) return;
  if (mode === 'true') reexec();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    try { return await realFetch(...args); }
    catch (error) {
      if (!isCertError(error)) throw error;
      console.error('[ notice   ] TLS certificate not trusted; restarting once with --use-system-ca');
      return reexec();
    }
  }) as typeof fetch;
}

const USAGE = `
WisdomTree ETF static data updater

Sources:
  catalog       WisdomTree U.S. fund list (the JSON behind the official product
                table), then the rendered product table; read-only Jina
                rendering fallback when Cloudflare blocks a non-browser request
  holdings      SEC EDGAR Form N-PORT-P for each exact ETF series
  returns       Official product-page Total Returns table (Market Price, NAV
                and Underlying Index Returns rows)
  distributions Official product-page Recent Distributions table (ex-date,
                record/payable date, Ordinary Income/ST/LT Capital Gains and
                Return of Capital); Yahoo dividend events fill in only the
                older ex-dates that table does not cover
  history       Yahoo Finance public chart API (adjusted market-price closes)

Environment variables (all filters use AND logic):
  MAX_FETCHES=0       all eligible funds; positive value is a resumable batch
  REQUEST_SLEEP=1.5   seconds between request starts
  CONCURRENCY=3       parallel fund workers; SEC/Yahoo requests stay paced
  AUM=:               min:max; amounts, K/M/B/T suffixes or nano|micro|small|mid|large
  TER=:               net expense ratio range in percent
  DIVIDEND_YIELD=:    catalog trailing-yield range in percent
  SEC_YIELD=:         30-day SEC yield range in percent (read from the product page)
  TICKERS="USFR DGRW"  optional ticker allowlist
  PERFORMANCE_YTD|1Y|3Y|5Y|10Y=min:max   annualized ranges
  TOTAL_RETURN_YTD|1Y|3Y|5Y|10Y=min:max cumulative ranges
  HOLDINGS_PAGE_SIZE=250
  HISTORY_PAGE_SIZE=1000
  HISTORY_RANGE=max   Yahoo window: max or N years (1y, 5y, 10y ...), sent as explicit period1/period2
  MAX_RETRIES=2       retries after the first request (integer >= 1)
  STORE_RAW_DOWNLOADS=off
  EDGAR_FALLBACK=1
  SKIP_WISDOMTREE=off  use the previously published catalog
  SKIP_YAHOO=off       keep previously published history when possible
  SEC_UA=...           SEC/HTTP User-Agent (default daggerok ETF feed daggerok@gmail.com); the protected SEC_UA Actions variable overrides it
  VERBOSE=off          print per-fund retry and fallback notices
  USE_SYSTEM_CA=auto   TLS trust store: auto (restart once with --use-system-ca on an untrusted-certificate error), true or false

Defaults live in scripts/update-data.config.json (file < advanced JSON < nonblank inputs < environment).

Examples:
  TICKERS="USFR DGRW WCLD" ./scripts/update-data.ts
  AUM="large:" TER=":0.30" ./scripts/update-data.ts
  PERFORMANCE_3Y="10:" TOTAL_RETURN_1Y="15:" ./scripts/update-data.ts
`;

// File defaults and explicit overrides, one mechanism for the CLI and the
// GitHub Actions workflow: allowlisted scalar controls only, so nothing is
// interpolated into bash. Precedence: config file < advanced JSON < nonblank
// inputs < environment (explicit env wins, including a deliberately blank one; WISDOMTREE_<NAME> and HISTORICAL_PAGE_SIZE are
// env aliases of the same layer, the plain name wins when both are set).
// Legacy env names next to WISDOMTREE_<NAME>: same layer as the plain name (env), plain name wins, then WISDOMTREE_<NAME>, then these.
const ENV_ALIASES: Record<string, string[]> = { HISTORY_PAGE_SIZE: ['HISTORICAL_PAGE_SIZE'] };
export const CONTROL_NAMES = [
  'MAX_FETCHES', 'REQUEST_SLEEP', 'CONCURRENCY', 'AUM', 'TER', 'DIVIDEND_YIELD', 'SEC_YIELD', 'TICKERS',
  'HOLDINGS_PAGE_SIZE', 'HISTORY_PAGE_SIZE', 'MAX_RETRIES', 'HISTORY_RANGE',
  'STORE_RAW_DOWNLOADS', 'EDGAR_FALLBACK', 'SKIP_YAHOO', 'SKIP_WISDOMTREE', 'SEC_UA', 'VERBOSE', 'USE_SYSTEM_CA',
  ...['PERFORMANCE', 'TOTAL_RETURN'].flatMap((prefix) => ['YTD', '1Y', '3Y', '5Y', '10Y'].map((period) => `${prefix}_${period}`)),
] as const;
export type ControlName = (typeof CONTROL_NAMES)[number];
export const CONFIG_FILE_URL = new URL('./update-data.config.json', import.meta.url);

export function resolveControls(
  file: unknown = {},
  advanced: unknown = {},
  inputs: unknown = {},
  env: Record<string, string | undefined> = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  const known = new Set<string>(CONTROL_NAMES);
  const apply = (value: unknown, skipEmpty = false): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuration must be a JSON object');
    for (const [key, raw] of Object.entries(value)) {
      if (!known.has(key)) throw new Error(`Unknown updater control: ${key}`);
      if (skipEmpty && (raw === '' || raw === undefined || raw === null)) continue;
      if (!['string', 'number', 'boolean'].includes(typeof raw)) throw new Error(`${key}: expected string, number or boolean`);
      const text = String(raw);
      if (/[\r\n\0]/.test(text)) throw new Error(`${key}: multiline/control characters are not allowed`);
      result[key] = text;
    }
  };
  apply(file);
  apply(advanced);
  apply(inputs, true);
  for (const key of CONTROL_NAMES) {
    const value = [key, `WISDOMTREE_${key}`, ...(ENV_ALIASES[key] ?? [])].map((name) => env[name]).find((v) => v !== undefined);
    if (value !== undefined) apply({ [key]: value });
  }
  for (const key of ['MAX_FETCHES', 'CONCURRENCY', 'HOLDINGS_PAGE_SIZE', 'HISTORY_PAGE_SIZE', 'MAX_RETRIES']) {
    const v = result[key];
    if (v === undefined || v === '') continue;
    const min = key === 'MAX_FETCHES' ? 0 : 1;
    if (!/^\d+$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) < min) throw new Error(`${key}: expected integer >= ${min}`);
  }
  if (result.REQUEST_SLEEP && (!Number.isFinite(Number(result.REQUEST_SLEEP)) || Number(result.REQUEST_SLEEP) < 0)) throw new Error('REQUEST_SLEEP: expected nonnegative seconds');
  for (const key of ['STORE_RAW_DOWNLOADS', 'EDGAR_FALLBACK', 'SKIP_YAHOO', 'SKIP_WISDOMTREE', 'VERBOSE']) {
    if (result[key] && !/^(0|1|true|false|yes|no|y|n|on|off)$/i.test(result[key])) throw new Error(`${key}: expected boolean`);
  }
  if (result.USE_SYSTEM_CA) {
    result.USE_SYSTEM_CA = result.USE_SYSTEM_CA.toLowerCase();
    if (!['auto', 'true', 'false'].includes(result.USE_SYSTEM_CA)) throw new Error('USE_SYSTEM_CA: expected auto, true or false');
  }
  if (result.HISTORY_RANGE && !HISTORY_RANGE_PATTERN.test(result.HISTORY_RANGE.toLowerCase())) throw new Error('HISTORY_RANGE: expected max or a number of years such as 5y');
  readConfig(result); // validate every min:max filter before any request or write
  return result;
}

export async function runtimeControls(env: Record<string, string | undefined> = process.env): Promise<Record<string, string>> {
  return resolveControls(JSON.parse(await readFile(CONFIG_FILE_URL, 'utf8')), {}, {}, env);
}

async function main(): Promise<void> {
  const controls = await runtimeControls();
  process.env.VERBOSE = controls.VERBOSE ?? '';
  installSystemCa(controls.USE_SYSTEM_CA || 'auto');
  await runUpdate(readConfig(controls));
}

/** Writes index.json from the given rows (counts derived from them). */
export async function writeIndex(funds: JsonRecord[]): Promise<void> {
  const sorted = [...funds].sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)));
  const counts = { funds: sorted.length, holdings: sorted.reduce((sum, row) => sum + (numberOrNull(row.holdings) || 0), 0), history: sorted.reduce((sum, row) => sum + (numberOrNull(row.history) || 0), 0) };
  await writeIfChanged(INDEX_FILE, {
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    source: {
      provider: 'WisdomTree Asset Management, Inc. (U.S.-listed ETFs)',
      market: 'us',
      site: WISDOMTREE_SITE,
      catalog: WISDOMTREE_CATALOG_URL,
      catalogData: WISDOMTREE_FUND_LIST_URL,
      catalogFallback: WISDOMTREE_CATALOG_PROXY_URL,
      holdings: 'SEC EDGAR Form N-PORT-P for exact series (issuer product-page top holdings fallback)',
      returns: 'Official WisdomTree product-page Total Returns table (Market Price, NAV and Underlying Index Returns rows)',
      distributions: 'Official WisdomTree product-page Recent Distributions table (Ordinary Income/Short-Term/Long-Term Capital Gains/Return of Capital breakdown); Yahoo Finance dividend events fill in older ex-dates the official table does not cover',
      history: 'Yahoo Finance public chart API (adjusted close)',
    },
    counts,
    funds: sorted,
  });
}

/** Index rows always carry the full metrics key set (null when unavailable); a row without funds/<T>/meta.json has no dataFile. */
function normalizeIndexRow(row: JsonRecord, hasMeta: boolean): JsonRecord {
  const metrics: JsonRecord = {};
  for (const key of METRIC_KEYS) metrics[key] = row.metrics?.[key] ?? (key === 'returnsBasis' ? RETURNS_BASIS_DERIVED : key.endsWith('Text') ? '—' : key === 'dividendYieldBasis' ? dividendYieldBasisFromKind(null, numberOrNull(row.metrics?.dividendYield)) : null);
  for (const [key, value] of Object.entries(row.metrics || {})) if (!(key in metrics)) metrics[key] = value;
  return { ...row, dataFile: hasMeta ? row.dataFile ?? `./funds/${row.ticker}/meta.json` : null, metrics };
}

async function hasMetaFile(ticker: string): Promise<boolean> {
  try { await readFile(new URL(`funds/${ticker}/meta.json`, API_ROOT), 'utf8'); return true; } catch { return false; }
}

export async function runUpdate(config: UpdaterConfig, deadlineMs: number = SOFT_DEADLINE_MS): Promise<void> {
  const startedAt = Date.now();
  SEC_UA = config.secUa;
  requestSleepSeconds = config.requestSleep;
  requestGates = new Array(Math.max(1, config.concurrency)).fill(0);
  proxyNextStart = 0;
  directBlocked = false;
  resetSecState();
  outputPrintConfig('WisdomTree', config);

  // Every fund already published (index rows plus funds/*/meta.json): the floor of the feed, never shrunk by this run.
  const previous = await readKnownRows();
  const catalog = new Map<string, CatalogFund>();
  let catalogSource = 'previous api/wisdomtree/index.json';
  let liveCatalog: CatalogFund[] | null = null;
  if (!config.skipWisdomTree) {
    try {
      const fetched = await fetchCatalog(config);
      const parsed = fetched.funds;
      liveCatalog = parsed;
      for (const fund of parsed) catalog.set(fund.ticker, fund);
      catalogSource = fetched.source;
      if (config.storeRawDownloads) {
        // Raw downloads are a debugging aid: they live outside api/wisdomtree so the workflow never commits them.
        const raw = new URL('../../data/raw/', API_ROOT);
        await mkdir(raw, { recursive: true });
        await writeFile(new URL(`${fetched.rawName}-${new Date().toISOString().slice(0, 10)}.${fetched.rawName === 'fund-list' ? 'json' : 'md'}`, raw), fetched.raw, 'utf8');
      }
    } catch (error) {
      console.warn(`[ ${'catalog'.padEnd(8)} ] ${error instanceof Error ? error.message : String(error)} - keeping the published feed`);
    }
  }
  // The live catalog (null when only the published feed is known): a catalog-only row it no longer lists is dropped, never retried.
  const live = liveCatalog ? liveCatalog.map((fund) => fund.ticker) : null;
  if (!catalog.size) previous.forEach((row, ticker) => catalog.set(ticker, parsePreviousFund(ticker, row)));
  if (live) previous.forEach((row, ticker) => { if (!catalog.has(ticker) && row.dataFile) catalog.set(ticker, parsePreviousFund(ticker, row)); });

  const universe = [...catalog.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  if (!universe.length) throw new Error('No catalog rows available. Run this where www.wisdomtree.com is reachable or seed api/wisdomtree/index.json first.');
  console.log(`[ ${'catalog'.padEnd(8)} ] ${universe.length} WisdomTree ETFs (${catalogSource})`);
  const noteLines: string[] = [];
  if (live && previous.size) {
    const listed = new Set(live);
    // A catalog that lost more than half of the known funds is treated as truncated: nothing is reported then.
    const dropped = Array.from(previous.keys()).filter((ticker) => !listed.has(ticker) && previous.get(ticker)?.dataFile).sort();
    if (dropped.length && listed.size * 2 >= previous.size) noteLines.push(`DROPPED FUNDS: ${dropped.join(', ')} (no longer in the live catalog; their published data is kept)`);
  }
  for (const line of noteLines) console.log(`[ ${'catalog'.padEnd(8)} ] ${line}`);
  // Q27: a TICKERS entry outside the live catalog and the published funds stops the run before any fund request
  assertKnownTickers(config.tickers ? Array.from(config.tickers) : null, knownTickers(live, Array.from(previous.values())), 'the WisdomTree catalog or published feed');

  let state: JsonRecord = {};
  try { state = JSON.parse(await readFile(STATE_FILE, 'utf8')) as JsonRecord; } catch { state = {}; }
  // The batch is taken from the funds that pass the catalog filters, in ticker order, starting after the cursor (wrapping around).
  const eligible = withoutClosedFunds(universe.filter((fund) => catalogFilterReasons(fund, config).length === 0), (fund) => fund.ticker, CLOSED_FUNDS);
  const cursor = config.maxFetches > 0 && !config.tickers ? String(state.cursor || '') : '';
  const ordered = cursor ? eligible.filter((fund) => fund.ticker > cursor).concat(eligible.filter((fund) => fund.ticker <= cursor)) : eligible;
  const queue = ordered.slice();
  const totalAttempts = config.maxFetches > 0 ? Math.min(config.maxFetches, ordered.length) : ordered.length;
  const results: JsonRecord[] = [];
  const catalogOnly: JsonRecord[] = [];
  let processed = 0;
  let failures = 0;
  let fundsWithFreshData = 0;
  let stoppedAtDeadline = false;
  // Advances for every fund taken from the queue, whatever its outcome, so a failing batch can never pin the cursor.
  let lastDispatched: string | null = null;
  outputPrintFilter(eligible.length, universe.length, outputHasOutputFilters(config));
  const output = outputCreateReporter(API_ROOT, totalAttempts);
  const worker = async (): Promise<void> => {
    for (;;) {
      if (config.maxFetches > 0 && processed >= config.maxFetches) return;
      if (Date.now() - startedAt >= deadlineMs) { stoppedAtDeadline = stoppedAtDeadline || queue.length > 0; return; }
      const fund = queue.shift();
      if (!fund) return;
      processed += 1;
      lastDispatched = fund.ticker;
      const before = await output.before(fund.ticker);
      const listed = { ...fund };
      // A catalog-only row (dataFile null, written for a new fund whose first refresh failed) is no published state to fall back on.
      const prior = previous.get(fund.ticker);
      try {
        const row = await processFund(fund, config, prior && prior.dataFile ? prior : {});
        if (row.__skipped) {
          await output.result(fund.ticker, before, 'skipped', (row.__skipReasons || ['not eligible']).join(', '));
        } else {
          if (row.__fresh) fundsWithFreshData += 1;
          delete row.__fresh;
          results.push(row);
          await output.result(fund.ticker, before);
        }
      } catch (error) {
        failures += 1;
        // A new fund (no meta.json yet) that failed is still listed, from its catalog row only.
        if (!(await hasMetaFile(fund.ticker))) catalogOnly.push(catalogOnlyRow(listed));
        const message = error instanceof Error ? error.message : String(error);
        await output.result(fund.ticker, before, 'failed', message);
      }
    }
  };
  await Promise.all(Array.from({ length: config.concurrency }, () => worker()));

  // Selected funds are refreshed; every other known fund keeps its published row (filtered, bounded, failed or catalog-less runs never shrink the index).
  const mergedRows = new Map<string, JsonRecord>(withoutStalePlaceholders(Array.from(previous.values()), live).map((row) => [String(row.ticker), row] as [string, JsonRecord]));
  for (const row of catalogOnly) mergedRows.set(String(row.ticker), row);
  for (const row of results) mergedRows.set(String(row.ticker), row);
  const funds: JsonRecord[] = [];
  for (const row of [...mergedRows.values()].sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)))) funds.push(normalizeIndexRow(row, await hasMetaFile(String(row.ticker))));
  const counts = { funds: funds.length, holdings: funds.reduce((sum, row) => sum + (numberOrNull(row.holdings) || 0), 0), history: funds.reduce((sum, row) => sum + (numberOrNull(row.history) || 0), 0) };
  // Closed funds keep their published row as it is, marked closed (written even when this run updated nothing).
  await writeIndex(markClosedFunds(funds, CLOSED_FUNDS));
  // Q28: a fund is announced on its first successful publish (a catalog-only row is not published), new catalog-only rows as pending
  const newFunds = newFundsLines(newFundsReport(Array.from(previous.values()), funds));
  for (const line of newFunds) console.log(line);
  // A TICKERS run never touches the cursor; a full run resets it.
  if (!config.tickers) await writeIfChanged(STATE_FILE, { cursor: config.maxFetches > 0 ? lastDispatched ?? (cursor || null) : null, savedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') });
  if (stoppedAtDeadline) console.warn(`[ ${'deadline'.padEnd(8)} ] soft deadline reached; ${queue.length} funds were not taken this run (the index was still written)`);
  console.log(output.summary(startedAt));
  console.log(outputCounts(counts.funds, counts.holdings, counts.history));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### WisdomTree data update\n\n- updated: ${results.length}\n- failed: ${failures}\n- counts: ${counts.funds} funds / ${counts.holdings.toLocaleString('en-US')} holdings rows / ${counts.history.toLocaleString('en-US')} history rows\n${noteLines.map((line) => `- ${line}\n`).join('')}${stoppedAtDeadline ? '- soft deadline reached before every fund was taken\n' : ''}${newFunds.length ? `\n### NEW FUNDS\n\n${newFunds.join('\n')}\n` : ''}`, 'utf8');
  // Every fund failed (or no fund got fresh data from any enabled source): the run is red.
  const sourcesEnabled = !config.skipWisdomTree || !config.skipYahoo || config.edgarFallback;
  if ((processed > 0 && failures === processed) || (sourcesEnabled && results.length > 0 && fundsWithFreshData === 0)) {
    console.error(`[ ${'failed'.padEnd(8)} ] no fund was updated from a live source`);
    process.exitCode = 1;
  }
}

if ((import.meta as { main?: boolean }).main) {
  if (process.argv.some((arg) => ['-h', '--help', 'help'].includes(arg))) console.log(USAGE.trim());
  else await main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
}

// <holdings-guard> shared block of .claude/tools/etfs/etf-std/holdings-guard.block.ts, applied by apply-holdings-guard.ts: never edit it in one repo
/**
 * Sanity check of a fund's new holdings before they replace the published ones. Returns why they must be rejected
 * (the caller then keeps the fund's previous state and reports it as failed), or null when they may be written.
 * An empty sheet passes only when nothing was published before. Otherwise a Name and a weight column (Weight,
 * Weight (%) or Market Weight) are required, >= 80% of the rows carry a numeric weight, the weights add up to
 * 50..150 and the sheet keeps >= 50% of the previously published rows. `relax` switches off the checks a fund
 * legitimately fails: 'numeric' and 'sum' (geared, inverse, futures, look-through, top-N lists) and 'count'. No relax lets
 * a sheet without a single numeric weight replace a published sheet that had numeric weights (`previousWeights`: how many
 * rows of the published sheet carry a numeric weight, see holdingsWeightCount; open-items etfs Q24).
 * Rows are arrays in header order or objects keyed by the header text. A fund in the brand's CLOSED_FUNDS never reaches the guard.
 */
export function holdingsGuard(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>, previousRows: number | null | undefined, relax: ReadonlyArray<string> = [], previousWeights: number | null = null): string | null {
  const previous = Number(previousRows) > 0 ? Number(previousRows) : 0;
  if (!rows.length) return previous ? `no holdings rows (${previous} published)` : null;
  const names = headers.map((header) => String(header).trim().toLowerCase());
  const nameAt = names.indexOf('name');
  let weightAt = names.indexOf('weight');
  if (weightAt < 0) weightAt = names.indexOf('weight (%)');
  if (weightAt < 0) weightAt = names.indexOf('market weight');
  if (nameAt < 0 || weightAt < 0) return `no ${nameAt < 0 ? 'Name' : 'weight'} column (headers: ${headers.join(', ') || 'none'})`;
  const weights = holdingsGuardWeights(headers, rows, weightAt);
  const numeric = weights.count;
  const sum = weights.sum;
  if (numeric === 0 && Number(previousWeights) > 0) return `no row has a numeric weight, the published sheet had ${Number(previousWeights)}`;
  if (relax.indexOf('numeric') < 0 && numeric < rows.length * 0.8) return `only ${numeric} of ${rows.length} rows have a numeric weight`;
  if (relax.indexOf('sum') < 0 && (sum < 50 || sum > 150)) return `weights add up to ${sum.toFixed(2)}, outside 50..150`;
  if (relax.indexOf('count') < 0 && previous && rows.length < previous * 0.5) return `${rows.length} rows, less than half of the ${previous} published`;
  return null;
}

/** How many rows carry a numeric weight (Weight, Weight (%) or Market Weight column), 0 without such a column: pass it for the published sheet as holdingsGuard's previousWeights. */
export function holdingsWeightCount(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>): number {
  const names = headers.map((header) => String(header).trim().toLowerCase());
  let weightAt = names.indexOf('weight');
  if (weightAt < 0) weightAt = names.indexOf('weight (%)');
  if (weightAt < 0) weightAt = names.indexOf('market weight');
  return weightAt < 0 ? 0 : holdingsGuardWeights(headers, rows, weightAt).count;
}

/** Count and sum of the numeric weights in column weightAt; rows are arrays in header order or objects keyed by the header text. */
function holdingsGuardWeights(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>, weightAt: number): { count: number; sum: number } {
  let count = 0;
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const row: any = rows[i];
    const weight = holdingsGuardNumber(Array.isArray(row) ? row[weightAt] : row && typeof row === 'object' ? row[headers[weightAt]] : undefined);
    if (weight !== null) {
      count++;
      sum += weight;
    }
  }
  return { count, sum };
}

/** A weight cell as a number: %, $, commas and spaces are ignored, (x) is negative; null when it is no plain number (a zero-width character inside counts as broken). */
function holdingsGuardNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = String(value === null || value === undefined ? '' : value).replace(/[ \t ,%$]/g, '').replace(/−/g, '-');
  const negative = /^\(.*\)$/.test(text);
  if (negative) text = text.slice(1, -1);
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  return negative ? -Number(text) : Number(text);
}

/** A fund its issuer closed (liquidated, delisted or merged away), confirmed from an official source: an SEC filing or the issuer's notice. */
export type ClosedFund = { ticker: string; closed: string; source: string };

/**
 * The brand's CLOSED_FUNDS entry for a ticker, or null. A closed fund is never fetched, never guarded and never reported failed: it keeps
 * its last published data and its index row carries `status: 'closed'`, `closedDate` and `closedSource`. A malformed entry throws, so a
 * typo (no ISO date, no https source) never ships.
 */
export function closedFund(list: ReadonlyArray<ClosedFund>, ticker: unknown): ClosedFund | null {
  const wanted = String(ticker === null || ticker === undefined ? '' : ticker).trim().toUpperCase();
  let found: ClosedFund | null = null;
  for (let i = 0; i < list.length; i++) {
    const fund = list[i];
    if (!/^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(fund.ticker) || !/^\d{4}-\d{2}-\d{2}$/.test(fund.closed) || !/^https:\/\/\S+$/.test(fund.source)) throw new Error(`CLOSED_FUNDS: ${fund.ticker} needs an upper-case ticker, an ISO closing date and an https source`);
    if (fund.ticker === wanted) found = fund;
  }
  return found;
}

/** The index rows with every closed fund marked (`status: 'closed'`, `closedDate`, `closedSource`); other rows are returned as they are. */
export function markClosedFunds<T extends object>(rows: ReadonlyArray<T>, list: ReadonlyArray<ClosedFund>): T[] {
  return rows.map((row) => {
    const fund = closedFund(list, (row as { ticker?: unknown }).ticker);
    return fund ? ({ ...row, status: 'closed', closedDate: fund.closed, closedSource: fund.source } as T) : row;
  });
}

/** A run's queue without the closed funds, which are named once in the log: they are neither fetched nor counted as failed. */
export function withoutClosedFunds<T>(queue: ReadonlyArray<T>, tickerOf: (item: T) => string, list: ReadonlyArray<ClosedFund>): T[] {
  const closed: string[] = [];
  const open: T[] = [];
  for (let i = 0; i < queue.length; i++) {
    if (closedFund(list, tickerOf(queue[i]))) closed.push(tickerOf(queue[i]));
    else open.push(queue[i]);
  }
  if (closed.length) console.log(`[ closed   ] ${closed.join(', ')}: closed by the issuer, published data kept`);
  return open;
}
// </holdings-guard>

// <nport-reader> shared block of .claude/tools/etfs/etf-std/nport-reader.block.ts, applied by apply-block.ts: never edit it in one repo
/**
 * SEC EDGAR Form N-PORT-P holdings reader (open-items etfs ETF-H2), one copy for every brand. Pure functions plus one reader
 * that takes the brand's own `getText(url, label)` (its SEC User-Agent, timeout, retries and pacing). Rules it enforces:
 * - identifiers come from the position itself: `<cusip>` text (or a `value` attribute), `<isin value>`, `<ticker value>`,
 *   `<other value>`; a derivative's reference instrument (inside `<derivativeInfo>`) never lends its identifiers to the position
 * - CUSIP `000000000` and `N/A` are missing; a missing weight or value is null (an empty cell), never 0
 * - a ticker only for a common-stock row (assetCat EC, not a CVR, right, warrant or escrow line) traded in USD with a U.S.
 *   ISIN or none, or with a foreign ISIN when the Nasdaq Trader directories list that ticker for the same company (a U.S.
 *   listing such as Linde, NXP, IMAX); renamed issuers through `nportRenamedIssuers`; an abbreviated or reordered name the
 *   exact key misses through a looser key that must name one company (`nportLooseKey`, Q35: `Lowe's Cos` = `LOWES COMPANIES`,
 *   `SCHWAB CHARLES CORP`); never one ticker on two different securities (`nportTickers`)
 * - identity: the filing must name the fund's own series id, or, with no series id known, the fund's name (`nportIdentity`)
 * - freshness: the report period must be strictly newer than the published holdings (`nportIsFresh`)
 * - filings come newest report period first from the registrant's own archive folder, never from the filer agent's CIK
 *   (the accession number prefix)
 */
export type NportPosition = {
  name: string;
  title: string;
  lei: string;
  cusip: string;
  isin: string;
  ticker: string;
  other: string;
  otherDesc: string;
  balance: number | null;
  units: string;
  currency: string;
  /** valUSD, null when the filing has none */
  value: number | null;
  /** pctVal: percent of net assets (0.5 = 0.5%), null when the filing has none */
  weight: number | null;
  payoff: string;
  assetCat: string;
  issuerCat: string;
  country: string;
  /** derivCat of the position's derivativeInfo (FUT, FWD, SWP, OPT, ...), empty for a security */
  derivative: string;
  /** debtSec annualizedRt and maturityDt (ISO), null and '' for a non-debt row */
  coupon: number | null;
  maturity: string;
};

export type NportFiling = {
  seriesId: string;
  seriesName: string;
  regName: string;
  regCik: string;
  /** report period end (genInfo repPdDate) as ISO, '' when missing */
  repPdDate: string;
  netAssets: number | null;
  totalAssets: number | null;
  positions: NportPosition[];
};

export type NportCandidate = { accession: string; filed: string; period: string; cik: string };
export type NportSeriesRef = { cik: string; seriesId: string; classId: string };

/** XML text: entities decoded, tags dropped, whitespace collapsed. */
function nportText(raw: string): string {
  return String(raw)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m: string, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[\s ]+/g, ' ')
    .trim();
}

/** Text of the first `<tag>` (any namespace prefix) in `xml`, '' when absent. */
function nportTag(xml: string, tag: string): string {
  const match = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${tag}>`, 'i').exec(xml);
  return match ? nportText(match[1]) : '';
}

/** The `attribute` of the first `<tag ...>` (any namespace prefix) in `xml`, '' when absent. */
function nportAttr(xml: string, tag: string, attribute: string): string {
  const match = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}\\s[^>]*?\\b${attribute}\\s*=\\s*"([^"]*)"`, 'i').exec(xml);
  return match ? nportText(match[1]) : '';
}

/** A plain decimal or exponent number, null for an empty, N/A or broken cell. */
function nportNumber(raw: string): number | null {
  const text = String(raw).replace(/[\s,]/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** An identifier code, '' for N/A, NONE and all zeros (CUSIP 000000000 means "no CUSIP"). */
function nportCode(raw: string): string {
  const text = String(raw).trim().toUpperCase();
  return !text || /^(N\/?A|NONE|-+|0+)$/.test(text) ? '' : text;
}

/** ISO date of an N-PORT date (YYYY-MM-DD, possibly with a time), '' otherwise. */
function nportIso(raw: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw === null || raw === undefined ? '' : raw).trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

/** One N-PORT-P primary_doc.xml (or the full submission .txt that embeds it) as series facts and positions. */
export function parseNportFiling(xml: string): NportFiling {
  const text = String(xml === null || xml === undefined ? '' : xml);
  const genInfo = /<(?:[A-Za-z0-9_.-]+:)?genInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?genInfo>/i.exec(text);
  const fundInfo = /<(?:[A-Za-z0-9_.-]+:)?fundInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?fundInfo>/i.exec(text);
  const gen = genInfo ? genInfo[1] : '';
  const fund = fundInfo ? fundInfo[1].replace(/<(?:[A-Za-z0-9_.-]+:)?returnInfo\b[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?returnInfo>/gi, ' ') : '';
  const positions: NportPosition[] = [];
  const blocks = /<(?:[A-Za-z0-9_.-]+:)?invstOrSec\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?invstOrSec>/gi;
  let block: RegExpExecArray | null;
  while ((block = blocks.exec(text)) !== null) {
    const raw = block[1];
    const derivativeInfo = /<(?:[A-Za-z0-9_.-]+:)?derivativeInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?derivativeInfo>/i.exec(raw);
    // The reference instrument of a derivative (SPY for a SPY option, a bond for a CDS) is another security: drop it first.
    const own = raw.replace(/<(?:[A-Za-z0-9_.-]+:)?derivativeInfo\b[^>]*>[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?derivativeInfo>/gi, ' ');
    const identifiers = /<(?:[A-Za-z0-9_.-]+:)?identifiers\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?identifiers>/i.exec(own);
    const ids = identifiers ? identifiers[1] : '';
    const debt = /<(?:[A-Za-z0-9_.-]+:)?debtSec\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?debtSec>/i.exec(own);
    const name = nportTag(own, 'name');
    positions.push({
      name: name && !/^N\/?A$/i.test(name) ? name : nportTag(own, 'title'),
      title: nportTag(own, 'title'),
      lei: nportCode(nportTag(own, 'lei')),
      cusip: nportCode(nportTag(own, 'cusip') || nportAttr(ids, 'cusip', 'value')),
      isin: nportCode(nportAttr(ids, 'isin', 'value')),
      ticker: nportCode(nportAttr(ids, 'ticker', 'value')),
      other: nportCode(nportAttr(ids, 'other', 'value')),
      otherDesc: nportAttr(ids, 'other', 'otherDesc'),
      balance: nportNumber(nportTag(own, 'balance')),
      units: nportTag(own, 'units'),
      currency: (nportTag(own, 'curCd') || nportAttr(own, 'currencyConditional', 'curCd')).toUpperCase(),
      value: nportNumber(nportTag(own, 'valUSD')),
      weight: nportNumber(nportTag(own, 'pctVal')),
      payoff: nportTag(own, 'payoffProfile'),
      assetCat: (nportTag(own, 'assetCat') || nportAttr(own, 'assetConditional', 'assetCat')).toUpperCase(),
      issuerCat: (nportTag(own, 'issuerCat') || nportAttr(own, 'issuerConditional', 'issuerCat')).toUpperCase(),
      country: nportTag(own, 'invCountry').toUpperCase(),
      derivative: derivativeInfo ? (/\bderivCat\s*=\s*"([^"]*)"/i.exec(derivativeInfo[1]) || ['', 'OTHER'])[1].toUpperCase() : '',
      coupon: debt ? nportNumber(nportTag(debt[1], 'annualizedRt')) : null,
      maturity: debt ? nportIso(nportTag(debt[1], 'maturityDt')) : '',
    });
  }
  return {
    seriesId: nportTag(gen, 'seriesId').toUpperCase(),
    seriesName: nportTag(gen, 'seriesName'),
    regName: nportTag(gen, 'regName'),
    regCik: nportTag(gen, 'regCik').replace(/\D/g, ''),
    repPdDate: nportIso(nportTag(gen, 'repPdDate')),
    netAssets: nportNumber(nportTag(fund, 'netAssets')),
    totalAssets: nportNumber(nportTag(fund, 'totAssets')),
    positions,
  };
}

/**
 * A number as sheet text: '' for null, no exponent, at most `digits` decimals (trailing zeros dropped), and no binary float
 * artifact: `115797518.01` stays `115797518.01`, not the `115797518.01000001` of `toFixed(8)`.
 */
export function nportCell(value: number | null, digits = 8): string {
  if (value === null || !Number.isFinite(value)) return '';
  const fixed = value.toFixed(digits);
  // the shortest text of the rounded number; toFixed only where that text would be an exponent (very small or large numbers)
  const shortest = String(Number(fixed));
  if (!/e/i.test(shortest)) return shortest;
  return fixed.indexOf('.') < 0 ? fixed : fixed.replace(/0+$/, '').replace(/\.$/, '');
}

/** The position's own identifier for a sheet: CUSIP, else ISIN, else the "other" code (a Bloomberg or internal id), else ''. */
export function nportIdentifier(position: NportPosition): string {
  return position.cusip || position.isin || position.other;
}

/**
 * A company name as a lookup key: upper case, punctuation and legal suffixes dropped, `CLASS A` -> `CL A`. Initials are one
 * word whether written with dots, spaces or a slash (`N.V.` = `N V` = `NV`, `C.H. ROBINSON` = `C H ROBINSON`, `A/S` = `A S`,
 * `S.A.B. de C.V.` = `SAB DE CV`), `PUBLIC LIMITED COMPANY` is `plc`, and a leading `US` stays (`U.S. BANCORP` is not
 * `BANCORP, INC.`), so both spellings of one issuer give one key.
 */
export function nportNameKey(value: unknown): string {
  // EDGAR adds a state or qualifier suffix to company titles ("COSTCO WHOLESALE CORP /NEW", "BANK OF AMERICA CORP /DE/",
  // "US BANCORP \DE\", "ACUITY INC. (DE)"): drop a trailing one
  const raw = String(value === null || value === undefined ? '' : value).replace(/(?:\s*(?:[\/\\]\s*[A-Za-z]{2,3}\s*[\/\\]?|\(\s*[A-Za-z]{2,3}\s*\)))+\s*$/, '');
  let text = nportText(raw).toUpperCase().replace(/['’]/g, '').replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').trim();
  text = text.replace(/\bCLASS\s+([A-Z])\b/g, 'CL $1').replace(/\bCL\s+([A-Z])\b/g, 'CL $1');
  // a run of single letters is one word, never the class letter after CL
  const words: string[] = [];
  let joining = false;
  text.split(' ').forEach((word) => {
    const letter = /^[A-Z]$/.test(word);
    if (letter && joining) words[words.length - 1] += word;
    else words.push(word);
    joining = letter && (joining || words[words.length - 2] !== 'CL');
  });
  text = words.join(' ').replace(/\bPUBLIC (?:(?:LIMITED|LTD)(?: (?:COMP[A-Z]*|CO))?|(?:COMPANY|CO) (?:LIMITED|LTD))\b/g, 'PLC').replace(/\b(?:S DE RL )?DE CV\b/g, ' ');
  const share = /\bCL [A-Z]\b/.exec(text);
  text = text.replace(/\b(THE|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|SA|SAB|NV|AG|SE|SPA|AS|ASA|ORDINARY|COMMON|STOCK|SHS|SHARES|ADR|DEPOSITARY|RECEIPT|USD|US|REG|REGISTERED)\b/g, (word: string, _name: string, at: number) => (word === 'US' && at === 0 ? word : ' ')).replace(/\s+/g, ' ').trim();
  if (share && !/\bCL [A-Z]\b/.test(text)) text = `${text} ${share[0]}`;
  return text;
}

/**
 * Abbreviated words of issuer names (open-items etfs Q35) -> one spelling, each seen in N-PORT-P filings of the brands against
 * the SEC company_tickers.json title of the same CUSIP issuer (2026-10-26): `LOWES COS` / `LOWES COMPANIES`, `AMERIPRISE FINL`,
 * `VICI PPTYS`, `TAIWAN SEMICONDUCTOR MFG`, `ZIONS BANCORP NA` / `ZIONS BANCORPORATION NATIONAL ASSOCIATION`. '' drops the word.
 */
function nportLooseWords(): Record<string, string> {
  return {
    COS: '', COMPANIES: '', AND: '', OF: '', NA: '', NATIONAL_ASSOCIATION: '', INCORPORATION: '', REIT: '',
    BANCORPORATION: 'BANCORP', FINL: 'FINANCIAL', PPTYS: 'PROPERTIES', PPTY: 'PROPERTY', MFG: 'MANUFACTURING', GRP: 'GROUP',
    HLDGS: 'HOLDINGS', HLDG: 'HOLDING', INTL: 'INTERNATIONAL', SVCS: 'SERVICES', TECH: 'TECHNOLOGIES', TECHNOLOGY: 'TECHNOLOGIES',
    SYS: 'SYSTEMS', NATL: 'NATIONAL', RES: 'RESOURCES', RLTY: 'REALTY', INDS: 'INDUSTRIES', INS: 'INSURANCE', BROS: 'BROTHERS', SVGS: 'SAVINGS',
  };
}

/**
 * The second, looser company key (open-items etfs Q35), used only for a row the exact key (`nportNameKey`) left without a
 * ticker: a Bloomberg location or article after a slash dropped (`Charles Schwab Corp/The`, `Energy Fuels Inc/canada`; never a
 * one-word start like `RE/MAX`), abbreviations read as one word (`nportLooseWords`), the share class dropped (the caller picks
 * the class) and the words sorted, so EDGAR's reordered titles meet the usual order: `SCHWAB CHARLES CORP` = `Charles Schwab
 * Corp`, `HORTON D R INC` = `DR Horton Inc`, `PRICE T ROWE GROUP INC` = `T Rowe Price Group Inc`. Several companies can share a
 * loose key: `parseSecCompanyNames` and `parseUsListings` keep such a key empty, so it never gives a ticker.
 */
export function nportLooseKey(value: unknown): string {
  let raw = String(value === null || value === undefined ? '' : value).trim();
  const slash = /^(.*\s\S*[A-Za-z]{2}[.,]?)\s*\/\s*([A-Za-z][A-Za-z .,']*)$/.exec(raw);
  if (slash) raw = slash[1];
  // a trailing EDGAR or Bloomberg qualifier after the legal form: `CHEVRON CORP NEW`, `US BANCORP DEL`, `PROGRESSIVE CORP OHIO`
  raw = raw.replace(/\b(CORP(?:ORATION)?|INC(?:ORPORATED)?|CO(?:MPANY)?|LTD|BANCORP|GROUP|GRP|TRUST|HOLDINGS?)\.?,?\s+(?:NEW|DEL|REINCORPORATION|OHIO|AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\.?$/i, '$1');
  const words = nportLooseWords();
  const key = nportNameKey(raw).replace(/ CL [A-Z]$/, '').replace(/\bNATIONAL ASSOCIATION\b/g, 'NATIONAL_ASSOCIATION');
  return key.split(' ').map((word) => (Object.prototype.hasOwnProperty.call(words, word) ? words[word] : word)).filter(Boolean).sort().join(' ');
}

/**
 * SEC company_tickers.json -> name key -> ticker (the first, largest company wins a shared key; the class-less key is added too).
 * Each loose key (`nportLooseKey`) is added as `\u0001<loose key>` -> the company's tickers, space-separated in the table's
 * order, or '' when two companies (CIKs) share it; `nportTickers` reads them for rows the exact key misses.
 */
export function parseSecCompanyNames(payload: unknown): Map<string, string> {
  const names = new Map<string, string>();
  const loose = new Map<string, { cik: string; tickers: string[] } | null>();
  const rows = payload && typeof payload === 'object' ? Object.keys(payload as object).map((key) => (payload as Record<string, unknown>)[key]) : [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as { ticker?: unknown; title?: unknown; cik_str?: unknown } | null;
    if (!row || typeof row !== 'object') continue;
    const ticker = String(row.ticker === null || row.ticker === undefined ? '' : row.ticker).trim().toUpperCase();
    const key = nportNameKey(row.title);
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) || !key) continue;
    if (!names.has(key)) names.set(key, ticker);
    const core = key.replace(/ CL [A-Z]$/, '');
    if (core && !names.has(core)) names.set(core, ticker);
    const looseKey = nportLooseKey(row.title);
    const cik = String(row.cik_str === null || row.cik_str === undefined ? '' : row.cik_str).replace(/\D/g, '');
    if (!looseKey || !Number(cik)) continue;
    const seen = loose.get(looseKey);
    if (seen === undefined) loose.set(looseKey, { cik: String(Number(cik)), tickers: [ticker] });
    else if (seen && seen.cik === String(Number(cik))) { if (seen.tickers.indexOf(ticker) < 0) seen.tickers.push(ticker); }
    else loose.set(looseKey, null);
  }
  loose.forEach((seen, looseKey) => names.set(`\u0001${looseKey}`, seen ? seen.tickers.join(' ') : ''));
  return names;
}

/** SEC company_tickers_mf.json -> fund ticker -> registrant CIK (10 digits), series id, class id. */
export function parseSecFundTickers(payload: unknown): Map<string, NportSeriesRef> {
  const map = new Map<string, NportSeriesRef>();
  const record = (payload && typeof payload === 'object' ? payload : {}) as { fields?: unknown; data?: unknown };
  const fields = Array.isArray(record.fields) ? record.fields.map(String) : [];
  const rows = Array.isArray(record.data) ? record.data : [];
  const at = (row: unknown[], field: string): string => (fields.indexOf(field) < 0 ? '' : String(row[fields.indexOf(field)] === null || row[fields.indexOf(field)] === undefined ? '' : row[fields.indexOf(field)]).trim());
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const ticker = at(row, 'symbol').toUpperCase();
    const cik = at(row, 'cik').replace(/\D/g, '');
    const seriesId = at(row, 'seriesId').toUpperCase();
    if (!ticker || !Number(cik) || !/^S\d{9}$/.test(seriesId) || map.has(ticker)) continue;
    map.set(ticker, { cik: `0000000000${Number(cik)}`.slice(-10), seriesId, classId: at(row, 'classId').toUpperCase() });
  }
  return map;
}

/**
 * Is the row a contingent value right, a right, a warrant or an escrow line filed as equity? A placeholder CUSIP or ISIN
 * (`436CVR021`, `US009CVR0445`, `549ESC028`, `866CNT017`) says so; so does the name or title (`NOVO NORDISK A/S - CVR`,
 * `XYZ INC RIGHTS`, `... WARRANT FEB 2026`, `Luby's Inc Escrow`), except on a CUSIP with the common-stock issue number 10
 * (Schwab titles Enovix common stock 293594107 "Enovix Corp Warrants"). `CVR` as the first word is a company (CVR Energy).
 */
function nportIsRight(position: NportPosition): boolean {
  if (/^[0-9A-Z]{3}(?:CVR|ESC|CNT)/.test(position.cusip) || /^US[0-9A-Z]{3}(?:CVR|ESC|CNT)/.test(position.isin)) return true;
  if (/^[0-9A-Z]{6}10[0-9]$/.test(position.cusip)) return false;
  return [position.name, position.title].some((text) => /\S\s*\bCVRS?\b|\bCONTINGENT\b|\bRIGHTS?\b|\bRTS\b|\bWARRANTS?\b|\bWTS\b|\bESCROW\b/i.test(text));
}

/**
 * Renamed issuers (open-items etfs Q33): N-PORT filers keep an issuer's old name for months while SEC's company_tickers.json
 * titles only the new one, so the name match misses (JPMorgan JEPI's Exxon). Old name key (`nportNameKey`) -> [ticker, CUSIP
 * issuer number (the first six characters)]. Used only when the SEC table has no such key, the row's CUSIP (or U.S. ISIN) has
 * that issuer number and the SEC table still lists the ticker. Each entry was confirmed on 2026-10-26: an EC row without a
 * ticker in the N-PORT-P filings of large U.S. equity funds (VTI, SCHB, ITOT, JEPI, IWB, VB, SCHA, FNDX, FNDA, ...) whose name
 * is a former EDGAR name of the CIK that has the ticker today (data.sec.gov submissions `formerNames`, the date the old name
 * ended), the ticker the CIK's only common stock in the Nasdaq Trader directories. Add an entry only with the same evidence.
 * A function, not a const: blocks sit at the end of update-data.ts, below the top-level run, so only declarations are hoisted.
 */
export function nportRenamedIssuers(): Array<[string, string, string]> {
  return [
    ['AADI BIOSCIENCE', 'WHWK', '00032Q'], // CIK 1422142 Whitehawk Therapeutics, Inc., former EDGAR name until 2025-03-18
    ['ABACUS LIFE', 'ABX', '00258Y'], // CIK 1814287 Abacus Global Management, Inc., former EDGAR name until 2025-02-04
    ['ACUITY BRANDS', 'AYI', '00508Y'], // CIK 1144215 ACUITY INC. (DE), former EDGAR name until 2025-04-17
    ['AEROVATE THERAPEUTICS', 'JBIO', '008064'], // CIK 1798749 Jade Biosciences, Inc., former EDGAR name until 2025-04-30
    ['AILERON THERAPEUTICS', 'RNTX', '00887A'], // CIK 1420565 Rein Therapeutics, Inc., former EDGAR name until 2024-12-09
    ['ALLOVIR', 'KLRS', '482929'], // CIK 1754068 Kalaris Therapeutics, Inc., former EDGAR name until 2025-03-12
    ['AMC NETWORKS', 'AMCX', '00164V'], // CIK 1514991 AMC Global Media Inc., former EDGAR name until 2026-04-03
    ['AMMO', 'POWW', '00175J'], // CIK 1015383 Outdoor Holding Co, former EDGAR name until 2025-04-24
    ['ARDENT HEALTH PARTNERS', 'ARDT', '03980N'], // CIK 1756655 Ardent Health, Inc., former EDGAR name until 2025-05-23
    ['ARENA GROUP HOLDINGS', 'PAAI', '040044'], // CIK 894871 Paradium.AI, Inc., former EDGAR name until 2026-08-13
    ['ATEGRITY SPECIALTY HOLDINGS LLC', 'ASIC', '04681Y'], // CIK 2040491 Ategrity Specialty Insurance Co Holdings, former EDGAR name until 2025-06-11
    ['BAKKT HOLDINGS', 'BKKT', '05759B'], // CIK 1820302 Bakkt, Inc., former EDGAR name until 2026-01-20
    ['BED BATH AND BEYOND', 'NXH', '690370'], // CIK 1130713 NEIGHBORHOOD INTELLIGENCE, INC., former EDGAR name until 2026-08-14
    ['BLACKROCK FUNDING', 'BLK', '09290D'], // CIK 2012383 BlackRock, Inc., former EDGAR name until 2024-10-01
    ['BRIGHTSPHERE INVESTMENT GROUP', 'AAMI', '10948W'], // CIK 1748824 Acadian Asset Management Inc., former EDGAR name until 2024-11-14
    ['CARA THERAPEUTICS', 'TVRD', '140755'], // CIK 1346830 Tvardi Therapeutics, Inc., former EDGAR name until 2025-04-11
    ['CEA INDUSTRIES', 'BNC', '86887P'], // CIK 1482541 BNB Standard Corp, former EDGAR name until 2026-09-21
    ['CHROMADEX', 'NAGE', '171077'], // CIK 1386570 Niagen Bioscience, Inc., former EDGAR name until 2025-03-10
    ['CLEANCORE SOLUTIONS', 'ZONE', '184492'], // CIK 1956741 Zone Frontier Inc., former EDGAR name until 2026-08-20
    ['CORPORATE OFFICE PROPERTIES TRUST', 'CDP', '22002T'], // CIK 860546 COPT DEFENSE PROPERTIES, former EDGAR name until 2023-09-14
    ['CULLINAN ONCOLOGY', 'CGEM', '230031'], // CIK 1789972 Cullinan Therapeutics, Inc., former EDGAR name until 2024-04-02
    ['DIME COMMUNITY BANCSHARES', 'DCOM', '25432X'], // CIK 846617 Dime Commercial Bancshares, Inc. /NY/, former EDGAR name until 2026-05-27
    ['DOMO', 'HUCK', '257554'], // CIK 1505952 Huckleberry.ai, Inc., former EDGAR name until 2026-09-03
    ['EASTSIDE DISTILLING', 'BLNE', '277802'], // CIK 1534708 Beeline Holdings, Inc., former EDGAR name until 2025-03-11
    ['EQUITY RESIDENTIAL', 'VMRK', '29476L'], // CIK 906107 VIVMARK RESIDENTIAL, former EDGAR name until 2026-08-12
    ['EXP WORLD HOLDINGS', 'AGNT', '30212W'], // CIK 1495932 AGNT, Inc., former EDGAR name until 2026-06-01
    ['EXXON MOBIL', 'XOM', '30231G'], // holding company reorganization: XOM is CIK 2115436 ExxonMobil Holdings Corp since 2026, the old Exxon Mobil Corp is CIK 34088
    ['EYEPOINT PHARMACEUTICALS', 'EYPT', '30233G'], // CIK 1314102 EyePoint, Inc., former EDGAR name until 2025-12-08
    ['EZFILL HOLDINGS', 'NXXT', '652941'], // CIK 1817004 NEXTNRG, INC., former EDGAR name until 2025-02-14
    ['FORTUNE BRANDS HOME AND SECURITY', 'FBIN', '34964C'], // CIK 1519751 Fortune Brands Innovations, Inc., former EDGAR name until 2022-12-14
    ['FRANKLIN RESOURCES', 'BEN', '354613'], // CIK 38777 FRANKLIN TEMPLETON INC, former EDGAR name until 2026-08-14
    ['FREYR BATTERY', 'TE', '35834F'], // CIK 1992243 T1 Energy Inc., former EDGAR name until 2025-02-14
    ['GALLAGHER ARTHUR J AND', 'AJG', '363576'], // CIK 354190 Arthur J. Gallagher & Co., former EDGAR name until 2019-08-14
    ['GRAINGER WW', 'GWW', '384802'], // CIK 277135 W.W. GRAINGER, INC., former EDGAR name until 2019-10-15
    ['GRAY TELEVISION', 'GTN', '389375'], // CIK 43196 GRAY MEDIA, INC, former EDGAR name until 2025-02-24
    ['GREAT AJAX', 'RPT', '38983D'], // CIK 1614806 Rithm Property Trust Inc., former EDGAR name until 2024-11-13
    ['GREENIDGE GENERATION HOLDINGS', 'VIP', '39531G'], // CIK 1844971 Vulcan Infrastructure & Power Inc., former EDGAR name until 2026-07-09
    ['HANNON ARMSTRONG SUSTAINABLE INFRASTRUCTURE CAPITAL', 'HASI', '41068X'], // CIK 1561894 HA Sustainable Infrastructure Capital, Inc., former EDGAR name until 2024-07-02
    ['HARTFORD FINANCIAL SERVICES GROUP', 'HIG', '416515'], // CIK 874766 HARTFORD INSURANCE GROUP, INC., former EDGAR name until 2025-01-30
    ['HELIX ENERGY SOLUTIONS GROUP', 'HOS', '42330P'], // CIK 866829 HORNBECK OFFSHORE SERVICES, INC., former EDGAR name until 2026-08-31
    ['HYSTER YALE MATERIALS HANDLING', 'HY', '449172'], // CIK 1173514 HYSTER-YALE, INC., former EDGAR name until 2024-05-30
    ['IAC', 'PPLI', '44891N'], // CIK 1800227 People Inc, former EDGAR name until 2026-06-02
    ['IDENTIV', 'INVE', '45170X'], // CIK 1036044 INVE Technologies, Inc., former EDGAR name until 2026-08-25
    ['IRHYTHM TECHNOLOGIES', 'IRTC', '450056'], // CIK 1388658 iRhythm Holdings, Inc., former EDGAR name until 2026-01-12
    ['ISSUER DIRECT', 'ACCS', '46520M'], // CIK 843006 ACCESS Newswire Inc., former EDGAR name until 2025-01-16
    ['JANOVER', 'DFDV', '47100L'], // CIK 1805526 DeFi Development Corp., former EDGAR name until 2025-04-15
    ['JOHN BEAN TECHNOLOGIES', 'JBTM', '477839'], // CIK 1433660 JBT MAREL Corp, former EDGAR name until 2024-12-20
    ['LENDINGCLUB', 'HAPN', '52603A'], // CIK 1409970 Happen, Inc., former EDGAR name until 2026-06-18
    ['LIXTE BIOTECHNOLOGY HOLDINGS', 'NMAD', '539319'], // CIK 1335105 NOMAD POWER SOLUTIONS, INC., former EDGAR name until 2026-07-02
    ['MKS INSTRUMENTS', 'MKSI', '55306N'], // CIK 1049502 MKS INC, former EDGAR name until 2025-05-15
    ['MONTANA TECHNOLOGIES', 'AIRJ', '612160'], // CIK 1855474 AirJoule Technologies Corp., former EDGAR name until 2024-10-21
    ['MULTIPLAN', 'CTEV', '62548M'], // CIK 1793229 Claritev Corp, former EDGAR name until 2025-02-07
    ['NEWPARK RESOURCES', 'NPKI', '651718'], // CIK 71829 NPK International Inc., former EDGAR name until 2024-12-03
    ['ONCOLOGY INSTITUTE', 'STLN', '68236X'], // CIK 1799191 Starling Oncology, Inc., former EDGAR name until 2026-08-03
    ['OREILLY AUTOMOTIVE', 'ORLY', '67103H'], // CIK 898173 O REILLY AUTOMOTIVE INC, former EDGAR name until 1998-04-10
    ['ORION OFFICE REIT', 'ONL', '68629Y'], // CIK 1873923 Orion Properties Inc., former EDGAR name until 2025-03-07
    ['PALTALK', 'IPM', '69764K'], // CIK 1355839 INTELLIGENT PROTECTION MANAGEMENT CORP., former EDGAR name until 2025-01-02
    ['PARAMOUNT SKYDANCE', 'SKYD', '69932A'], // CIK 2041610 Skydance Corp, former EDGAR name until 2026-10-06
    ['PIEDMONT OFFICE REALTY TRUST', 'PDM', '720190'], // CIK 1042776 Piedmont Realty Trust, Inc., former EDGAR name until 2025-06-02
    ['PIERIS PHARMACEUTICALS', 'PVLA', '697947'], // CIK 1583648 PALVELLA THERAPEUTICS, INC., former EDGAR name until 2024-12-12
    ['PLUS THERAPEUTICS', 'CNSY', '72941H'], // CIK 1095981 CERENOME, INC., former EDGAR name until 2026-07-01
    ['RUMBLE', 'RUM', '78137L'], // CIK 1830081 RUM Group Inc., former EDGAR name until 2026-06-17
    ['SCHWEITZER MAUDUIT INTERNATIONAL', 'MATV', '808541'], // CIK 1000623 Mativ Holdings, Inc., former EDGAR name until 2022-07-01
    ['SEQLL', 'CIRC', '048592'], // CIK 1605888 CIRCLE8 GROUP INC, former EDGAR name until 2024-06-06
    ['SHOE CARNIVAL', 'SHOE', '824889'], // CIK 895447 SHOE STATION GROUP INC, former EDGAR name until 2026-06-11
    ['TANGER FACTORY OUTLET CENTERS', 'SKT', '875465'], // CIK 899715 TANGER INC., former EDGAR name until 2023-11-15
    ['TECNOGLASS', 'TGLS', '87877F'], // CIK 1534675 Tecnoglass Holdings Inc., former EDGAR name until 2026-07-07
    ['TEMPUR SEALY INTERNATIONAL', 'SGI', '88023U'], // CIK 1206264 SOMNIGROUP INTERNATIONAL INC., former EDGAR name until 2025-02-14
    ['TEVOGEN BIO HOLDINGS', 'TVGN', '88165K'], // CIK 1860871 Tevogen Inc., former EDGAR name until 2026-07-30
    ['TORO COMBINECO', 'TTGT', '87874R'], // CIK 2018064 TechTarget, Inc., former EDGAR name until 2024-11-20
    ['VIAD', 'PRSU', '92552R'], // CIK 884219 Pursuit Attractions & Hospitality, Inc., former EDGAR name until 2024-12-31
    ['WELLGISTICS HEALTH', 'MEDS', '949503'], // CIK 2030763 DataMeds AI, Inc., former EDGAR name until 2026-07-21
    ['ZOOM VIDEO COMMUNICATIONS', 'ZM', '98980L'], // CIK 1585521 Zoom Communications, Inc., former EDGAR name until 2024-11-12
    ['ZYMEWORKS DELAWARE', 'ZYME', '98985Y'], // CIK 1937653 Zymeworks Inc., former EDGAR name until 2022-10-13
  ];
}

/** Nasdaq Trader symbol directories: Nasdaq listings, and NYSE, NYSE American, NYSE Arca, Cboe and IEX listings. */
export function nportUsListingsUrls(): string[] {
  return ['https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt', 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'];
}

/**
 * The Nasdaq Trader symbol directories (the texts of `nportUsListingsUrls()`, in any order) as U.S.-listed symbol -> security
 * name; test issues and ETFs left out, CQS class dots as SEC dashes (`BRK.B` -> `BRK-B`). An issuer listed under several
 * symbols (Liberty Global LBTYA, LBTYB, LBTYK) also gets the entry `\u0000<name key>` -> its symbols, which `nportUsListed` reads
 * to require the share class. null unless every text is a whole directory (a header with Security Name and the File Creation
 * Time footer), so a failed or cut download changes nothing.
 */
export function parseUsListings(texts: ReadonlyArray<string>): Map<string, string> | null {
  const listings = new Map<string, string>();
  if (!texts.length) return null;
  for (let t = 0; t < texts.length; t++) {
    const lines = String(texts[t] === null || texts[t] === undefined ? '' : texts[t]).split(/\r?\n/).filter((line) => line.trim());
    const header = (lines[0] || '').split('|').map((cell) => cell.trim().toUpperCase());
    const nameAt = header.indexOf('SECURITY NAME'), testAt = header.indexOf('TEST ISSUE'), etfAt = header.indexOf('ETF');
    if (nameAt < 0 || !/^FILE CREATION TIME/i.test(lines[lines.length - 1] || '')) return null;
    for (let i = 1; i < lines.length - 1; i++) {
      const cells = lines[i].split('|');
      const symbol = String(cells[0] || '').trim().toUpperCase().replace(/[./ ]/g, '-');
      if (!symbol || String(cells[testAt] || '').trim() === 'Y' || String(cells[etfAt] || '').trim() === 'Y' || listings.has(symbol)) continue;
      listings.set(symbol, String(cells[nameAt] || '').trim());
    }
  }
  const issuers = new Map<string, string[]>();
  const loose = new Map<string, string[]>();
  listings.forEach((name, symbol) => {
    const key = nportNameKey(nportIssuerName(name));
    if (key) issuers.set(key, (issuers.get(key) || []).concat(symbol));
    const looseKey = nportLooseKey(nportIssuerName(name));
    if (looseKey && nportListedCommon(name)) loose.set(looseKey, (loose.get(looseKey) || []).concat(symbol));
  });
  issuers.forEach((symbols, key) => { if (symbols.length > 1) listings.set(`\u0000${key}`, symbols.join(' ')); });
  loose.forEach((symbols, looseKey) => listings.set(`\u0001${looseKey}`, symbols.join(' ')));
  return listings;
}

/** Is a symbol directory security name a company's own common or ordinary shares (not preferred, depositary, notes, warrants, units, rights)? */
function nportListedCommon(name: string): boolean {
  return !/\bDEPOSITARY\b|\bADSS?\b|\bADRS?\b|\bREGISTRY\b|\bPREFERRED\b|\bPREF\b|\bPFD\b|\bNOTES?\b|\bDEBENTURES?\b|\bWARRANTS?\b|\bUNITS?\b|\bRIGHTS?\b|%|\bDUE\s+\d{4}\b|\bPERPETUAL\b|\bCUMULATIVE\b|\bSUBORDINATED\b|\bTRUST\s+(?:SECURITIES|CERTIFICATES)\b|\bETNS?\b|\bEXCHANGE[- ]TRADED\b/i.test(name);
}

/** The share class a name or title states (`Class C`, `CL C`, `Series A`, `LIBERTY GLOBAL-C`), '' for none. */
function nportShareClass(...texts: unknown[]): string {
  for (let i = 0; i < texts.length; i++) {
    const text = String(texts[i] === null || texts[i] === undefined ? '' : texts[i]);
    const match = /\b(?:CLASS|CL|SERIES|SER)\.?\s+([A-Z])\b/i.exec(text) || /[A-Z]-\s?([A-Z])(?:\s|$)/i.exec(text);
    if (match) return match[1].toUpperCase();
  }
  return '';
}

/** Both symbol directories through the brand's `getText`, null when one fails (`parseUsListings`); load once per run. */
export async function readUsListings(getText: (url: string, label: string) => Promise<string>): Promise<Map<string, string> | null> {
  try {
    return parseUsListings(await Promise.all(nportUsListingsUrls().map((url) => getText(url, `Nasdaq Trader ${url.replace(/^.*\//, '')}`))));
  } catch {
    return null;
  }
}

/** A security or sheet name without its share description: `Accenture plc Class A Ordinary Shares (Ireland)` -> `Accenture plc`. */
function nportIssuerName(value: unknown): string {
  return String(value === null || value === undefined ? '' : value).split(' - ')[0]
    .replace(/\s+(?:\(|(?:CLASS|SERIES)\s+[A-Z]\b|COMMON\b|ORDINARY\b|SUBORDINATE\b|SUB\.?\s+VOT|(?:LIMITED|RESTRICTED)\s+VOTING\b|VOTING\b|SHARES?\b|STOCK\b|AMERICAN\s+DEPOSITARY\b|TRADING\s+UNDER\b)[\s\S]*$/i, '');
}

/**
 * Is `ticker` the company's own U.S. listing? The Nasdaq Trader directories (`parseUsListings`) list it under the same company
 * (same name key, or one key the start of the other: `BUNGE GLOBAL` and the directory's `BUNGE`, a name cut short after two words
 * or more: `CHECK POINT SOFTWARE TECH`), and not as depositary or New York registry shares, which are another security than
 * the foreign line (Shell's SHEL ADR, ASML's New York shares). When the issuer has several listed classes, the name or title
 * must state the listed class (Liberty Latin America Class C is LILAK, not LILA). False without listings. Callers check that
 * the line trades in U.S. dollars: a Toronto or London line of the same company in its own currency never gets the U.S. ticker.
 */
export function nportUsListed(listings: Map<string, string> | null, ticker: string, name: unknown, title: unknown = ''): boolean {
  if (!listings) return false;
  const listed = listings.get(String(ticker).trim().toUpperCase().replace(/[./ ]/g, '-'));
  if (listed === undefined || /\bDEPOSITARY\b|\bADSS?\b|\bADRS?\b|\bREGISTRY\b/i.test(listed)) return false;
  const a = nportNameKey(nportIssuerName(listed)), b = nportNameKey(nportIssuerName(name));
  if (!a || !b) return false;
  const short = a.length < b.length ? a : b, long = a.length < b.length ? b : a;
  if (a !== b && !(short.length >= 4 && long.indexOf(`${short} `) === 0) && !(short.split(' ').length >= 2 && long.indexOf(short) === 0)) return false;
  const listedClass = nportShareClass(listed);
  return !listedClass || !listings.has(`\u0000${a}`) || nportShareClass(name, title) === listedClass;
}

/**
 * Exchange tickers for the positions, in their order ('' for none). A ticker is given only to a common-stock row (assetCat
 * EC; a preferred EP, a CVR, right, warrant or escrow line gets none, a name match would give it the issuer's common ticker):
 * - U.S. ISIN or none, traded in USD (or with no currency): the filer's own `<ticker value>`, else the SEC issuer-name table
 *   (`names`) when the row has a CUSIP or a U.S. ISIN, else a renamed issuer (`nportRenamedIssuers`)
 * - foreign ISIN (Linde IE, NXP NL, IMAX CA): only traded in USD and only when the symbol directories (`listings`,
 *   `parseUsListings`) confirm the filer's or the name-matched ticker for the same company (`nportUsListed`); a local line in
 *   another currency, and every foreign row without listings, gets none
 * A ticker that lands on two different securities (Alphabet A and C, an ordinary share and its ADR) is dropped from the
 * name-matched rows; when the filer itself gave it to two securities it is dropped from all of them. Rows still without a
 * ticker get the second, looser name match (`nportLooseTickers`), which never changes a ticker given here. Bonds, cash, funds
 * and derivatives stay identifier-keyed.
 */
export function nportTickers(positions: ReadonlyArray<NportPosition>, names: Map<string, string> | null = null, listings: Map<string, string> | null = null): string[] {
  const fromFiler: boolean[] = [];
  const secTickers = new Set<string>();
  if (names) names.forEach((ticker, key) => { if (key.charAt(0) !== '\u0001') secTickers.add(ticker); });
  const renames = nportRenamedIssuers();
  const renamed = (position: NportPosition, key: string): string => {
    const issuer = (position.cusip || (/^US[0-9A-Z]{10}$/.test(position.isin) ? position.isin.slice(2, 11) : '')).slice(0, 6);
    const hit = renames.filter((entry) => entry[0] === key && entry[2] === issuer && secTickers.has(entry[1]))[0];
    return hit ? hit[1] : '';
  };
  const tickers = positions.map((position, index) => {
    fromFiler[index] = false;
    const equity = position.assetCat === 'EC' && !position.derivative && !nportIsRight(position);
    const foreign = Boolean(position.isin) && position.isin.slice(0, 2) !== 'US';
    const usd = foreign ? position.currency === 'USD' && Boolean(listings) : !position.currency || position.currency === 'USD';
    if (!equity || !usd) return '';
    const filer = /^[A-Z][A-Z0-9.-]{0,9}$/.test(position.ticker) ? position.ticker : '';
    const key = nportNameKey(position.name);
    const named = names && (/^[0-9A-Z]{9}$/.test(position.cusip) || /^[A-Z]{2}[0-9A-Z]{10}$/.test(position.isin)) ? names.get(key) || names.get(key.replace(/ CL [A-Z]$/, '')) || '' : '';
    if (!foreign) {
      fromFiler[index] = Boolean(filer);
      return filer || named || (names ? renamed(position, key) : '');
    }
    if (filer && nportUsListed(listings, filer, position.name, position.title)) {
      fromFiler[index] = true;
      return filer;
    }
    return named && nportUsListed(listings, named, position.name, position.title) ? named : '';
  });
  const securities = new Map<string, { keys: string[]; filer: string[] }>();
  tickers.forEach((ticker, index) => {
    if (!ticker) return;
    const position = positions[index];
    const key = position.cusip || position.isin || position.other || nportNameKey(position.name);
    const seen = securities.get(ticker) || { keys: [], filer: [] };
    if (seen.keys.indexOf(key) < 0) seen.keys.push(key);
    if (fromFiler[index] && seen.filer.indexOf(key) < 0) seen.filer.push(key);
    securities.set(ticker, seen);
  });
  const exact = tickers.map((ticker, index) => {
    const seen = ticker ? securities.get(ticker) : undefined;
    if (!seen || seen.keys.length < 2) return ticker;
    return seen.filer.length === 1 && fromFiler[index] ? ticker : '';
  });
  return nportLooseTickers(positions, exact, names, listings);
}

/**
 * The second name match (open-items etfs Q35) for the common-stock rows `nportTickers` left without a ticker; the tickers it
 * already gave never change. The row's loose key (`nportLooseKey`) must name one company: in the SEC table (`\u0001` entries of
 * `parseSecCompanyNames`, one CIK) and/or in the symbol directories (`\u0001` entries of `parseUsListings`, common shares only),
 * and when both know the key they must agree on the company. Of that company's tickers only its listed common shares count
 * (with one SEC ticker and no listing, that ticker); several of them (Fox, Lennar, Zillow) need the class the row states in its
 * name or title, matched to the listed security name, else no ticker. A foreign ISIN needs the directory listing of the same
 * key (its own U.S. shares, never depositary ones). A ticker that a row of `exact` holds for another security, or that this pass
 * finds for two securities, is dropped.
 */
function nportLooseTickers(positions: ReadonlyArray<NportPosition>, exact: string[], names: Map<string, string> | null, listings: Map<string, string> | null): string[] {
  if (!names) return exact;
  const companyOf = new Map<string, string>();
  names.forEach((tickers, key) => { if (key.charAt(0) === '\u0001' && tickers) tickers.split(' ').forEach((ticker) => companyOf.set(ticker, key)); });
  const securityOf = (position: NportPosition): string => position.cusip || position.isin || position.other || nportNameKey(position.name);
  const listedClass = (symbol: string): string => nportShareClass(listings ? listings.get(symbol) : '');
  const found = positions.map((position, index) => {
    if (exact[index] || position.assetCat !== 'EC' || position.derivative || nportIsRight(position)) return '';
    const foreign = Boolean(position.isin) && position.isin.slice(0, 2) !== 'US';
    if (foreign ? position.currency !== 'USD' || !listings : position.currency && position.currency !== 'USD') return '';
    if (!/^[0-9A-Z]{9}$/.test(position.cusip) && !/^[A-Z]{2}[0-9A-Z]{10}$/.test(position.isin)) return '';
    const key = nportLooseKey(position.name);
    if (!key) return '';
    const sec = names.get(`\u0001${key}`);
    const listed = listings ? listings.get(`\u0001${key}`) : undefined;
    if (sec === '' || (sec === undefined && listed === undefined) || (foreign && !listed)) return '';
    const listedSymbols = listed ? listed.split(' ') : [];
    // the company: the SEC entry of the key, else the one SEC entry every listed symbol of the key belongs to
    const company = sec !== undefined ? `\u0001${key}` : companyOf.get(listedSymbols[0]) || '';
    if (!company || listedSymbols.some((symbol) => companyOf.get(symbol) !== company)) return '';
    const tickers = String(names.get(company) || '').split(' ').filter(Boolean);
    const common = tickers.filter((ticker) => listings && listings.has(ticker) && nportListedCommon(String(listings.get(ticker))));
    const candidates = common.length ? common : tickers.length === 1 && !foreign ? tickers : [];
    if (foreign && candidates.some((ticker) => listedSymbols.indexOf(ticker) < 0)) return '';
    const wanted = nportShareClass(position.name, position.title);
    if (candidates.length === 1) return !wanted || !listings || !listings.has(candidates[0]) || !listedClass(candidates[0]) || listedClass(candidates[0]) === wanted ? candidates[0] : '';
    const classed = wanted ? candidates.filter((ticker) => listedClass(ticker) === wanted) : [];
    return classed.length === 1 ? classed[0] : '';
  });
  const taken = new Map<string, string[]>();
  exact.forEach((ticker, index) => { if (ticker) taken.set(ticker, (taken.get(ticker) || []).concat(securityOf(positions[index]))); });
  found.forEach((ticker, index) => {
    if (!ticker) return;
    const seen = taken.get(ticker) || [];
    if (seen.indexOf(securityOf(positions[index])) < 0) taken.set(ticker, seen.concat(securityOf(positions[index])));
  });
  return exact.map((ticker, index) => ticker || (found[index] && (taken.get(found[index]) || []).length === 1 ? found[index] : ''));
}

/** The browse-edgar Atom feed of one series' NPORT-P filings. */
export function nportSeriesFeedUrl(seriesId: string, count = 10): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(String(seriesId).toUpperCase())}&type=NPORT-P&dateb=&owner=include&count=${count}&output=atom`;
}

/** The registrant's submissions JSON (report periods of its recent filings). */
export function nportSubmissionsUrl(cik: string): string {
  return `https://data.sec.gov/submissions/CIK${`0000000000${Number(String(cik).replace(/\D/g, '')) || 0}`.slice(-10)}.json`;
}

/** primary_doc.xml of a filing in the registrant's own folder. Throws without a registrant CIK: the accession prefix is the filer agent. */
export function nportDocumentUrl(registrantCik: string, accession: string): string {
  const cik = Number(String(registrantCik).replace(/\D/g, ''));
  if (!cik) throw new Error(`N-PORT ${accession}: no registrant CIK (the accession prefix is the filer agent, never used as the folder)`);
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${String(accession).replace(/-/g, '')}/primary_doc.xml`;
}

/** NPORT-P entries of a browse-edgar Atom feed (amendments and other forms skipped), with the registrant CIK of the filing link. */
export function parseNportFeed(atom: string): NportCandidate[] {
  const out: NportCandidate[] = [];
  const entries = /<entry>([\s\S]*?)<\/entry>/gi;
  let entry: RegExpExecArray | null;
  while ((entry = entries.exec(String(atom === null || atom === undefined ? '' : atom))) !== null) {
    const body = entry[1];
    const form = (nportTag(body, 'filing-type') || nportAttr(body, 'category', 'term')).toUpperCase();
    const accession = nportTag(body, 'accession-number');
    if (form !== 'NPORT-P' || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) continue;
    const folder = /\/Archives\/edgar\/data\/(\d+)\//i.exec(nportTag(body, 'filing-href'));
    out.push({ accession, filed: nportIso(nportTag(body, 'filing-date')), period: nportIso(nportTag(body, 'period')), cik: folder ? folder[1] : '' });
  }
  return out;
}

/** NPORT-P filings of a registrant's submissions JSON (`filings.recent`), with report periods; the registrant is the JSON's own CIK. */
export function parseNportSubmissions(payload: unknown): NportCandidate[] {
  const record = (payload && typeof payload === 'object' ? payload : {}) as { cik?: unknown; filings?: { recent?: Record<string, unknown> } };
  const recent = record.filings && record.filings.recent ? record.filings.recent : {};
  const column = (name: string): unknown[] => (Array.isArray(recent[name]) ? (recent[name] as unknown[]) : []);
  const forms = column('form'), accessions = column('accessionNumber'), filed = column('filingDate'), periods = column('reportDate');
  const cik = String(record.cik === null || record.cik === undefined ? '' : record.cik).replace(/\D/g, '');
  const out: NportCandidate[] = [];
  for (let i = 0; i < forms.length; i++) {
    const accession = String(accessions[i] === null || accessions[i] === undefined ? '' : accessions[i]);
    if (String(forms[i]).toUpperCase() !== 'NPORT-P' || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) continue;
    out.push({ accession, filed: nportIso(filed[i]), period: nportIso(periods[i]), cik });
  }
  return out;
}

/**
 * Candidates newest report period first, then newest filing: a late filing for an older period never wins. A missing
 * period is taken from `known` (the registrant's submissions) by accession; candidates still without one go last.
 */
export function nportNewestFirst(candidates: ReadonlyArray<NportCandidate>, known: ReadonlyArray<NportCandidate> = []): NportCandidate[] {
  const periods = new Map<string, string>();
  for (let i = 0; i < known.length; i++) if (known[i].period) periods.set(known[i].accession, known[i].period);
  return candidates
    .map((candidate) => (candidate.period ? candidate : { ...candidate, period: periods.get(candidate.accession) || '' }))
    .sort((a, b) => (a.period && b.period ? b.period.localeCompare(a.period) : a.period ? -1 : b.period ? 1 : 0) || b.filed.localeCompare(a.filed));
}

/**
 * Does the filing belong to the fund? With a series id: only the same series id. Without one: the normalized series name
 * equals the fund name, or (`loose`, reported to the caller) one contains the other. Returns the problem, or null.
 */
export function nportIdentity(filing: Pick<NportFiling, 'seriesId' | 'seriesName'>, fund: { seriesId?: string | null; name?: string | null }): { problem: string | null; loose: boolean } {
  const wantedSeries = String(fund.seriesId || '').trim().toUpperCase();
  if (wantedSeries) return { problem: filing.seriesId === wantedSeries ? null : `names series ${filing.seriesId || 'none'}, not ${wantedSeries}`, loose: false };
  const filed = nportNameKey(filing.seriesName), wanted = nportNameKey(fund.name);
  if (!filed || !wanted) return { problem: 'no series id and no fund name to match', loose: false };
  if (filed === wanted) return { problem: null, loose: false };
  if (filed.indexOf(wanted) >= 0 || wanted.indexOf(filed) >= 0) return { problem: null, loose: true };
  return { problem: `names series "${filing.seriesName}", not "${String(fund.name)}"`, loose: false };
}

/**
 * May a filing replace the published holdings? Nothing published (no rows): any dated or undated report. Otherwise only a
 * report period strictly newer than the published holdings date; both must be ISO dates (convert the brand's display
 * date first), an unknown date on either side keeps the published sheet.
 */
export function nportIsFresh(repPdDate: unknown, publishedAsOf: unknown, publishedRows: unknown): boolean {
  if (!(Number(publishedRows) > 0)) return true;
  const report = nportIso(repPdDate), published = nportIso(publishedAsOf);
  return Boolean(report && published && String(publishedAsOf).trim().length === 10 && report > published);
}

export type NportRead = { filing: NportFiling; candidate: NportCandidate; url: string; loose: boolean } | { problem: string };

/**
 * The newest N-PORT-P filing of one fund, or why there is none. Candidates: the series' Atom feed (when a series id is known;
 * an empty feed means no filing yet) with periods from the registrant's submissions, else (no series id, or the feed failed)
 * the registrant's NPORT-P filings themselves; newest period first.
 * Documents are read until one passes the identity check (at most `maxDocuments`); that newest own filing is returned only
 * when it is fresh against the published holdings (`published.asOf` ISO, `published.rows`). Errors of the optional
 * submissions request are tolerated; others come back as `problem`. `cache` (one Map per run) keeps the submissions and
 * the parsed documents, so funds of one registrant share requests.
 */
export async function readNportHoldings(
  fund: { ticker: string; cik: string; seriesId?: string | null; name?: string | null },
  published: { asOf?: unknown; rows?: unknown },
  getText: (url: string, label: string) => Promise<string>,
  options: { maxDocuments?: number; cache?: Map<string, unknown> } = {},
): Promise<NportRead> {
  const cache = options.cache || new Map<string, unknown>();
  const once = async <T>(key: string, load: () => Promise<T>): Promise<T> => {
    if (!cache.has(key)) cache.set(key, load().catch((error: unknown) => { cache.delete(key); throw error; }));
    return (await cache.get(key)) as T;
  };
  const cik = String(fund.cik || '').replace(/\D/g, '');
  if (!Number(cik)) return { problem: `${fund.ticker}: no registrant CIK` };
  let known: NportCandidate[] = [];
  try {
    known = await once(`submissions:${Number(cik)}`, async () => parseNportSubmissions(JSON.parse(await getText(nportSubmissionsUrl(cik), `${fund.ticker} N-PORT periods`))));
  } catch {
    known = [];
  }
  // null: no series feed (no series id, or the feed failed), so the registrant's own NPORT-P filings are scanned instead
  let candidates: NportCandidate[] | null = null;
  try {
    if (fund.seriesId) candidates = parseNportFeed(await getText(nportSeriesFeedUrl(fund.seriesId), `${fund.ticker} N-PORT filings`));
  } catch (error) {
    if (!known.length) return { problem: `${fund.ticker}: N-PORT filings unavailable (${error instanceof Error ? error.message : String(error)})` };
  }
  const sorted = nportNewestFirst(candidates || known, known);
  if (!sorted.length) return { problem: `${fund.ticker}: no NPORT-P filing yet` };
  const limit = Math.max(1, options.maxDocuments || (candidates ? 3 : 12));
  const misses: string[] = [];
  for (let i = 0; i < sorted.length && i < limit; i++) {
    const candidate = sorted[i];
    const url = nportDocumentUrl(Number(candidate.cik) ? candidate.cik : cik, candidate.accession);
    let filing: NportFiling;
    try {
      filing = await once(`document:${url}`, async () => parseNportFiling(await getText(url, `${fund.ticker} N-PORT ${candidate.accession}`)));
    } catch (error) {
      misses.push(`${candidate.accession} unreadable (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const identity = nportIdentity(filing, fund);
    if (identity.problem) {
      misses.push(`${candidate.accession} ${identity.problem}`);
      continue;
    }
    if (!filing.positions.length) return { problem: `${fund.ticker}: ${candidate.accession} has no positions` };
    if (!nportIsFresh(filing.repPdDate, published.asOf, published.rows)) return { problem: `${fund.ticker}: N-PORT ${filing.repPdDate || 'undated'} is not newer than the published holdings (${String(published.asOf || 'undated')})` };
    return { filing, candidate, url, loose: identity.loose };
  }
  return { problem: `${fund.ticker}: no N-PORT-P filing of its own${misses.length ? `: ${misses.join('; ')}` : ''}` };
}
// </nport-reader>

// <calendar-dates> shared block of .claude/tools/etfs/etf-std/calendar-dates.block.ts, applied by apply-block.ts: never edit it in one repo
/**
 * A calendar date as ISO `YYYY-MM-DD`, or null. Pure text work, never `Date.parse` or local getters, so a run in Tokyo
 * publishes the same day as CI (open-items etfs ETF-H4). Accepts ISO (`2026-10-24`, with a time the date part is kept as
 * written), `2026/10/24`, U.S. `10/24/2026` and `10-24-26` (two-digit years up to 69 are 20xx), month names in either order
 * (`Oct 24, 2026`, `October 24 2026`, `Sept. 30, 2026`, `24 Oct 2026`, `24-Oct-26`), an optional weekday or `as of` in front.
 * A day that does not exist (`02/30/2026`) is null.
 */
export function calendarIso(value: unknown): string | null {
  const text = String(value === null || value === undefined ? '' : value).replace(/[\s ]+/g, ' ').trim()
    .replace(/^as of:? /i, '').replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,? /i, '');
  const year = (raw: string): number => (raw.length === 2 ? (Number(raw) <= 69 ? 2000 : 1900) + Number(raw) : Number(raw));
  const month = (raw: string): number => {
    const word = raw.toLowerCase();
    const names = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    for (let i = 0; i < names.length; i++) if (word.length >= 3 && names[i].indexOf(word) === 0) return i + 1;
    return 0;
  };
  let y = 0, m = 0, d = 0, match: RegExpExecArray | null;
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text)) || (match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text))) {
    y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
  } else if ((match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})$/.exec(text))) {
    y = year(match[3]); m = Number(match[1]); d = Number(match[2]);
  } else if ((match = /^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/.exec(text))) {
    y = Number(match[3]); m = month(match[1]); d = Number(match[2]);
  } else if ((match = /^(\d{1,2})(?:st|nd|rd|th)?[ -]([A-Za-z]{3,9})\.?,?[ -](\d{4}|\d{2})$/.exec(text))) {
    y = year(match[3]); m = month(match[2]); d = Number(match[1]);
  } else {
    return null;
  }
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > days[m - 1]) return null;
  return `${y}-${m < 10 ? '0' : ''}${m}-${d < 10 ? '0' : ''}${d}`;
}

/**
 * Is the fund at least `years` old on `asOf`? Calendar anniversary, inclusive: a fund started 2025-10-24 is one year old on
 * 2026-10-24 (a 29 February start on 1 March). Unknown or unreadable dates answer true, so a value is never dropped for want
 * of a date. The shared "younger than one year" rule: since-inception returns are annualized only from one year on.
 */
export function fundAgeAtLeast(inception: unknown, asOf: unknown, years: number): boolean {
  const start = calendarIso(inception), end = calendarIso(asOf);
  if (!start || !end) return true;
  return end >= `${Number(start.slice(0, 4)) + years}${start.slice(4)}`;
}

/**
 * The returns with every horizon the fund is too young for set to null: `horizons` maps a key of `returns` to the years it
 * needs (`{ yr1: 1, cagr3y: 3, siAnn: 1 }`). Keys that are absent or already null stay as they are; the object is copied.
 */
export function withoutYoungReturns<T extends object>(returns: T, inception: unknown, asOf: unknown, horizons: Record<string, number>): T {
  const out: Record<string, unknown> = { ...(returns as Record<string, unknown>) };
  const keys = Object.keys(horizons);
  for (let i = 0; i < keys.length; i++) {
    if (out[keys[i]] !== undefined && out[keys[i]] !== null && !fundAgeAtLeast(inception, asOf, horizons[keys[i]])) out[keys[i]] = null;
  }
  return out as T;
}
// </calendar-dates>

// <windowed-chart> shared block of .claude/tools/etfs/etf-std/windowed-chart.block.ts, applied by apply-block.ts: never edit it in one repo
export type WindowedChartDay = { date: string; close: number; adjClose: number; volume: number; adjCloseRaw?: number };
export type WindowedChartDividend = { epoch: number; amount: number };

/**
 * A HISTORY_RANGE window (`period1` N years back) never shrinks the published history, and with it the 3y, 5y, 10y and
 * since-inception returns (open-items etfs Q25; was a byte-identical copy in Fidelity, Invesco and JPMorgan). The published
 * rows older than the first fresh day are put in front of the fresh days; their Adj Close is rescaled by the ratio measured on
 * the overlapping days (Yahoo re-adjusts the whole series after each distribution). Published distributions older than the
 * window are kept as well. Returns the chart unchanged when nothing published is older, and null when the window cannot be
 * joined safely (no overlap, Close changed, inconsistent or implausible ratio): the caller then keeps the fund as published.
 * `published` rows carry `Date` (any calendarIso form), `Close`, `Adj Close`, `Volume`; distribution rows are
 * [date, amount, ...] arrays. The chart's days must be sorted by ISO date.
 */
export function mergeWindowedChart<C extends { days: WindowedChartDay[]; dividends: WindowedChartDividend[] }>(chart: C, published: ReadonlyArray<Record<string, unknown>>, publishedDistributions: ReadonlyArray<unknown> = []): C | null {
  if (!chart.days.length || !published.length) return chart;
  const num = (value: unknown): number | null => {
    const text = String(value === null || value === undefined ? '' : value).replace(/[\s,$]/g, '');
    return text && Number.isFinite(Number(text)) ? Number(text) : null;
  };
  const firstFresh = chart.days[0].date;
  const rows: Array<{ date: string; close: number; adjClose: number; volume: number }> = [];
  for (let i = 0; i < published.length; i++) {
    const date = calendarIso(published[i].Date), close = num(published[i].Close), adjClose = num(published[i]['Adj Close']);
    if (date && close !== null && adjClose !== null && adjClose > 0) rows.push({ date, close, adjClose, volume: num(published[i].Volume) || 0 });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const older = rows.filter((row) => row.date < firstFresh);
  if (!older.length) return chart;
  const byDate = new Map<string, { close: number; adjClose: number }>();
  for (let i = 0; i < rows.length; i++) byDate.set(rows[i].date, rows[i]);
  const adjRatios: number[] = [];
  const closeRatios: number[] = [];
  for (let i = 0; i < chart.days.length; i++) {
    const day = chart.days[i];
    const prior = byDate.get(day.date);
    if (!prior) continue;
    adjRatios.push((day.adjCloseRaw === undefined ? day.adjClose : day.adjCloseRaw) / prior.adjClose);
    if (prior.close > 0) closeRatios.push(day.close / prior.close);
  }
  if (!adjRatios.length) return null;
  const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
  if (closeRatios.length && Math.abs(mean(closeRatios) - 1) > 1e-3) return null;
  if (Math.max.apply(null, adjRatios) / Math.min.apply(null, adjRatios) - 1 > 5e-3) return null;
  const measured = mean(adjRatios);
  if (measured < 0.5 || measured > 1.001) return null;
  const factor = Math.abs(measured - 1) < 1e-4 ? 1 : measured;
  const days: WindowedChartDay[] = older.map((row) => {
    const raw = row.adjClose * factor;
    return { date: row.date, close: row.close, adjClose: factor === 1 ? row.adjClose : Math.round(raw * 100) / 100, volume: row.volume, adjCloseRaw: raw };
  });
  const firstFreshEpoch = Date.UTC(Number(firstFresh.slice(0, 4)), Number(firstFresh.slice(5, 7)) - 1, Number(firstFresh.slice(8, 10))) / 1000;
  const kept: WindowedChartDividend[] = [];
  for (let i = 0; i < publishedDistributions.length; i++) {
    const cells = publishedDistributions[i];
    const date = Array.isArray(cells) ? calendarIso(cells[0]) : null;
    const amount = Array.isArray(cells) ? num(cells[1]) : null;
    if (!date || amount === null || amount <= 0) continue;
    const epoch = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 1000;
    if (epoch < firstFreshEpoch) kept.push({ epoch, amount });
  }
  kept.sort((a, b) => a.epoch - b.epoch);
  return { ...chart, days: days.concat(chart.days), dividends: kept.concat(chart.dividends.filter((dividend) => dividend.epoch >= firstFreshEpoch)) };
}
// </windowed-chart>

// <fund-selection> shared block of .claude/tools/etfs/etf-std/fund-selection.block.ts, applied by apply-block.ts: never edit it in one repo
/** An index row as far as these helpers read it: the ticker and whether it has published data (`dataFile`, null for a catalog-only row). */
export type FundSelectionRow = { ticker?: unknown; dataFile?: unknown };

function fundSelectionTicker(row: FundSelectionRow): string {
  return String(row.ticker === null || row.ticker === undefined ? '' : row.ticker).trim().toUpperCase();
}

/**
 * The tickers a TICKERS entry may name: the live catalog plus every fund with published data (closed funds included). When
 * the live catalog could not be read (`live` null) every previous index row counts, since nothing tells a real catalog-only
 * row from a stale one. A catalog-only row from an earlier mistyped TICKERS run is therefore not "known" (open-items etfs Q27).
 */
export function knownTickers(live: ReadonlyArray<string> | null, previous: ReadonlyArray<FundSelectionRow>): string[] {
  const out: string[] = [];
  const add = (ticker: string): void => { if (ticker && out.indexOf(ticker) < 0) out.push(ticker); };
  if (live) for (let i = 0; i < live.length; i++) add(String(live[i]).trim().toUpperCase());
  for (let i = 0; i < previous.length; i++) if (!live || previous[i].dataFile) add(fundSelectionTicker(previous[i]));
  return out;
}

/** Throws before any fund request when TICKERS names a fund outside `known` (see knownTickers): a clear error, nothing fetched or written. */
export function assertKnownTickers(selected: ReadonlyArray<string> | null, known: ReadonlyArray<string>, where: string): void {
  const unknown = (selected || []).map((ticker) => String(ticker).trim().toUpperCase()).filter((ticker) => ticker && known.indexOf(ticker) < 0);
  if (unknown.length) throw new Error(`TICKERS: ${unknown.join(', ')} not in ${where}; nothing was fetched or written`);
}

/**
 * The index rows without stale catalog-only rows: a row with no published data whose ticker the live catalog no longer lists
 * (an earlier mistyped TICKERS entry, a fund withdrawn before launch). Rows with data always stay; nothing is dropped when the
 * live catalog could not be read (`live` null).
 */
export function withoutStalePlaceholders<T extends FundSelectionRow>(rows: ReadonlyArray<T>, live: ReadonlyArray<string> | null): T[] {
  if (!live) return rows.slice();
  const listed = live.map((ticker) => String(ticker).trim().toUpperCase());
  return rows.filter((row) => Boolean(row.dataFile) || listed.indexOf(fundSelectionTicker(row)) >= 0);
}

/**
 * New funds of a run (open-items etfs Q28): `published` - first published in this run (the previous index had no row for it,
 * or only a catalog-only one), so a fund whose first read failed is announced when it finally succeeds; `pending` - new in the
 * catalog this run but not published yet. Nothing is reported on a first run (empty previous index).
 */
export function newFundsReport(previous: ReadonlyArray<FundSelectionRow>, next: ReadonlyArray<FundSelectionRow>): { published: string[]; pending: string[] } {
  const report = { published: [] as string[], pending: [] as string[] };
  if (!previous.length) return report;
  const before = new Map<string, boolean>();
  for (let i = 0; i < previous.length; i++) before.set(fundSelectionTicker(previous[i]), Boolean(previous[i].dataFile));
  for (let i = 0; i < next.length; i++) {
    const ticker = fundSelectionTicker(next[i]);
    if (!ticker || before.get(ticker)) continue;
    if (next[i].dataFile) report.published.push(ticker);
    else if (!before.has(ticker)) report.pending.push(ticker);
  }
  report.published.sort();
  report.pending.sort();
  return report;
}

/** The log and step-summary lines of a newFundsReport: `NEW FUNDS: A, B` and `NEW FUNDS (not published yet): C`; none when empty. */
export function newFundsLines(report: { published: ReadonlyArray<string>; pending: ReadonlyArray<string> }): string[] {
  const lines: string[] = [];
  if (report.published.length) lines.push(`NEW FUNDS: ${report.published.join(', ')}`);
  if (report.pending.length) lines.push(`NEW FUNDS (not published yet): ${report.pending.join(', ')}`);
  return lines;
}
// </fund-selection>
