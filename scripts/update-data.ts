#!/usr/bin/env bun
import { readFile as outputReadFile, readdir as outputReadDir } from 'node:fs/promises';
import { createHash as outputCreateHash } from 'node:crypto';
import { join as outputJoin } from 'node:path';
import { fileURLToPath as outputFileURLToPath } from 'node:url';

// Console presentation; no changes to provider requests or persisted data.
/** Presentation only: no requests, writes, filtering, or changes to updater state. */

const outputClean = (value: unknown): string => String(value ?? 'null').replace(/[\r\n\t]+/g, ' ');
/** Names are the canonical environment knobs, not internal parser properties. */
function outputConfigEntries(config: Record<string, any>): [string, string][] {
  const values = new Map<string, string>();
  const aliases: Record<string, string> = {
    requestSleepSeconds: 'REQUEST_SLEEP', categories: 'CATEGORY',
    aumRange: 'AUM', terRange: 'TER', dividendYieldRange: 'DIVIDEND_YIELD', secYieldRange: 'SEC_YIELD',
    performanceRanges: 'PERFORMANCE', totalReturnRanges: 'TOTAL_RETURN',
    skipVanEck: 'SKIP_VANECK', skipProShares: 'SKIP_PROSHARES',
    skipWisdomTree: 'SKIP_WISDOMTREE', skipGoldmanSachs: 'SKIP_GOLDMANSACHS',
  };
  const range = (v: any): string => v?.source ?? `${Number.isFinite(v?.min) ? v.min : ''}:${Number.isFinite(v?.max) ? v.max : ''}`;
  for (const [key, value] of Object.entries(config)) {
    const name = aliases[key] ?? key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
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
function outputPrintConfig(brand: string, config: Record<string, any>): void {
  console.log(`[ config ] ${brand} updater:\n${outputConfigEntries(config).map(([key, value]) => `            ${key}=${/TOKEN|PASSWORD|SECRET|COOKIE/i.test(key) ? '<redacted>' : outputClean(value)}`).join('\n')}`);
}
function outputHasOutputFilters(config: Record<string, any>): boolean {
  return outputConfigEntries(config).some(([name, value]) =>
    /^(TICKERS|CATEGORY|AUM|TER|DIVIDEND_YIELD|SEC_YIELD|PERFORMANCE_|TOTAL_RETURN_)/.test(name) &&
    !['', ':', 'null', 'all'].includes(value));
}
function outputPrintFilter(selected: number, total: number, deferred = false): void {
  console.log(`[ filter ] ${selected} of ${total} funds ${deferred ? 'selected for evaluation (data-dependent filters applied per fund)' : 'pass filters'}`);
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
function outputMoney(value: any): string {
  const raw = outputScalar(value);
  if (raw === null || raw === undefined || raw === '—' || raw === '--') return 'null';
  const text = String(raw).replace(/[$,\s]/g, '');
  const match = text.match(/^([+-]?[\d.]+)([KMBT])?$/i);
  if (!match) return outputClean(raw);
  const number = Number(match[1]) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[match[2]?.toUpperCase() as 'K' | 'M' | 'B' | 'T'] ?? 1);
  if (!Number.isFinite(number)) return 'null';
  for (const [unit, scale] of [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]] as const) {
    if (Math.abs(number) >= scale) return `$${(number / scale).toFixed(1)}${unit}`;
  }
  return `$${number.toFixed(2)}`;
}
function outputFundLine(index: number, total: number, ticker: string, status: string, data: any = {}, reason?: unknown): string {
  const width = Math.max(2, String(total).length);
  const metrics = data.metrics ?? {};
  const detail = [
    `port=${outputClean(data.portId ?? data.portfolioId)}`,
    `history=${outputClean(outputCount(data.history ?? data.historyCount))}`,
    `(official=${outputClean(data.officialHistoryCount)} yahoo=${outputClean(data.yahooHistoryCount)})`,
    `holdings=${outputClean(outputCount(data.holdings ?? data.holdingsCount))}`,
    `divs=${outputClean(outputCount(data.worksheets?.Distributions ?? data.distributions))}`,
    `netAssets=${outputMoney(data.netAssets ?? data.aum)}`,
    `total=${outputMoney(data.totalFundNetAssets ?? data.totalNetAssets)}`,
    `div=${outputClean(outputScalar(data.trailingYield ?? data.yields?.effectiveYield ?? data.yields?.dividendYield ?? data.dividendYield ?? metrics.dividendYield))}`,
    `sec=${outputClean(outputScalar(data.secYield ?? data.yields?.secYield ?? metrics.secYield))}`,
    `wp=${outputClean(data.workplaceRaw)}`,
  ].join(' ');
  return `[ ${String(index).padStart(width)}/${String(total).padEnd(width)}  ] ${outputClean(ticker).padEnd(5)} ${status.padEnd(9)} ${detail}${reason ? ` reason=${outputClean(reason)}` : ''}`;
}
function outputCreateReporter(root: URL | string, total: number) {
  let completed = 0;
  return {
    before: (ticker: string) => outputInspectFund(root, ticker),
    async result(ticker: string, before: { digest: string }, status?: string, reason?: unknown, extra: any = {}) {
      const after = await outputInspectFund(root, ticker);
      console.log(outputFundLine(++completed, total, ticker, status ?? (before.digest === after.digest ? 'unchanged' : 'updated'), { ...after.meta, ...extra }, reason));
    },
  };
}


// WisdomTree U.S.-listed ETF static data updater.
//
// The browser application is deliberately static. This script builds the feed
// under api/wisdomtree/** from public, issuer/SEC/market-data sources:
//
//   catalog   WisdomTree's U.S. ETF product table and per-fund product pages
//             https://www.wisdomtree.com/us/products
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
// catalog fetch first tries the official page and then uses the read-only
// r.jina.ai rendering of that same official page. No user data or credentials
// are sent to the proxy. SEC and Yahoo requests stay direct.
//
// Usage: bun ./scripts/update-data.ts [--help]

// Bun provides Node-compatible fs/promises; node types are intentionally not required at runtime.
/// <reference types="bun" />
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';

declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  exitCode?: number;
};

type JsonRecord = Record<string, any>;
type Range = { min?: number; max?: number };
type ReturnPeriod = 'YTD' | '1Y' | '3Y' | '5Y' | '10Y';
type RangeMap = Partial<Record<ReturnPeriod, Range>>;

const WISDOMTREE_SITE = 'https://www.wisdomtree.com';
const WISDOMTREE_CATALOG_URL = `${WISDOMTREE_SITE}/us/products`;
const WISDOMTREE_CATALOG_PROXY_URL = `https://r.jina.ai/http://www.wisdomtree.com/us/products`;
const WISDOMTREE_PRODUCT_PROXY_PREFIX = 'https://r.jina.ai/http://www.wisdomtree.com';
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const SEC_DATA_HOST = 'https://data.sec.gov';
const SEC_SITE = 'https://www.sec.gov';
const SEC_BROWSE_URL = `${SEC_SITE}/cgi-bin/browse-edgar`;
const SEC_ARCHIVES = `${SEC_SITE}/Archives/edgar/data`;
const SEC_FUND_TICKERS_URL = `${SEC_SITE}/files/company_tickers_mf.json`;
const SEC_COMPANY_TICKERS_URL = `${SEC_SITE}/files/company_tickers.json`;
const SEC_UA = 'DaggerOk WisdomTree ETF feed admin@daggerok.example.com';

const API_ROOT = new URL('../api/wisdomtree/', import.meta.url);
const INDEX_FILE = new URL('index.json', API_ROOT);
const STATE_FILE = new URL('update-state.json', API_ROOT);

const HOLDINGS_HEADERS = ['Name', 'Ticker', 'Identifier', 'Weight', 'Market Value', 'Shares Held', 'Asset Category'];
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

export type ParsedNport = {
  regName: string;
  regCik: string;
  seriesName: string;
  seriesId: string;
  repPdDate: string;
  holdings: JsonRecord[];
  totalValue: number;
  netAssets: number | null;
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
};

type SecSeriesRef = { cik: string; seriesId: string; classId: string };
type NportAccession = { accession: string; filed: string; reportDate: string; url: string };

type UpdaterConfig = {
  maxFetches: number;
  requestSleep: number;
  aum?: Range;
  ter?: Range;
  dividendYield?: Range;
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
};

const EMPTY_RETURNS: CatalogReturns = { ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null };
const EMPTY_PRICE_RETURNS: PriceReturns = { asOfDate: '', mo1: null, qtd: null, ytd: null, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null };

let requestGateAt = 0;
let requestSleepSeconds = 1.5;
let fundTickerMap: Map<string, SecSeriesRef> | null = null;
let fundTickerMapPromise: Promise<Map<string, SecSeriesRef>> | null = null;
let companyTickerMap: Map<string, string> | null = null;
let companyTickerMapPromise: Promise<Map<string, string>> | null = null;

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
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? raw : new Date(parsed).toISOString().slice(0, 10);
}

function formatDate(value: string | null | undefined): string {
  const iso = toIsoDate(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso || '—';
  return `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])} ${match[1]}`;
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

function parseRanges(env: Record<string, string | undefined>, prefix: 'PERFORMANCE' | 'TOTAL_RETURN'): RangeMap {
  const result: RangeMap = {};
  for (const period of ['YTD', '1Y', '3Y', '5Y', '10Y'] as ReturnPeriod[]) {
    const value = env[`${prefix}_${period}`];
    if (value !== undefined && value.trim() !== '') result[period] = parseRange(value, `${prefix}_${period}`);
  }
  return result;
}

function readTickerSet(value: string | undefined): Set<string> | null {
  const tickers = String(value ?? '').split(/[\s,;]+/).map(sanitizeTicker).filter(Boolean);
  return tickers.length ? new Set(tickers) : null;
}

function hasConfiguredFilters(config: UpdaterConfig): boolean {
  return Boolean(config.aum || config.ter || config.dividendYield || config.tickers || Object.keys(config.performance).length || Object.keys(config.totalReturn).length);
}

function readConfig(env: Record<string, string | undefined> = process.env): UpdaterConfig {
  return {
    maxFetches: parsePositiveInt(env.MAX_FETCHES, 0),
    requestSleep: parseDecimal(env.REQUEST_SLEEP, 1.5),
    aum: parseAumRange(env.AUM ?? ':'),
    ter: parseRange(env.TER ?? ':', 'TER'),
    dividendYield: parseRange(env.DIVIDEND_YIELD ?? ':', 'DIVIDEND_YIELD'),
    performance: parseRanges(env, 'PERFORMANCE'),
    totalReturn: parseRanges(env, 'TOTAL_RETURN'),
    concurrency: Math.max(1, parsePositiveInt(env.CONCURRENCY, 3)),
    holdingsPageSize: Math.max(1, parsePositiveInt(env.HOLDINGS_PAGE_SIZE, 250)),
    historyPageSize: Math.max(1, parsePositiveInt(env.HISTORY_PAGE_SIZE, 1000)),
    storeRawDownloads: parseBoolean(env.STORE_RAW_DOWNLOADS),
    maxRetries: Math.max(0, parsePositiveInt(env.MAX_RETRIES, 2)),
    tickers: readTickerSet(env.TICKERS),
    historyRange: env.HISTORY_RANGE?.trim() || 'max',
    edgarFallback: !['0', 'false', 'off', 'no'].includes(String(env.EDGAR_FALLBACK ?? '1').toLowerCase()),
    skipWisdomTree: parseBoolean(env.SKIP_WISDOMTREE),
    skipYahoo: parseBoolean(env.SKIP_YAHOO),
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

async function paceRequests(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, requestGateAt - now);
  requestGateAt = Math.max(now, requestGateAt) + Math.max(0, requestSleepSeconds * 1000);
  if (wait) await sleep(wait);
}

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

async function fetchText(url: string, label: string, config: UpdaterConfig, headers: Record<string, string> = {}): Promise<string> {
  let lastError: unknown = new Error('no request attempted');
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    try {
      await paceRequests();
      const response = await fetch(url, { headers: { 'User-Agent': SEC_UA, Accept: '*/*', ...headers } });
      if (!response.ok) throw new HttpError(response.status, `${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt >= config.maxRetries || !retryable(error)) break;
      await sleep(Math.min(30_000, 800 * 2 ** attempt));
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

async function fetchCatalog(config: UpdaterConfig): Promise<{ markdown: string; source: string }> {
  const urls = [WISDOMTREE_CATALOG_URL, WISDOMTREE_CATALOG_PROXY_URL];
  let lastError: unknown;
  for (const url of urls) {
    try {
      const markdown = await fetchText(url, `[catalog ] ${url}`, config, { Accept: 'text/markdown,text/html;q=0.9' });
      if (/WisdomTree Fund\s*\|\s*Fund Ticker/i.test(markdown)) return { markdown, source: url === WISDOMTREE_CATALOG_URL ? 'WisdomTree official product table' : 'WisdomTree official product table via read-only rendering proxy' };
      lastError = new Error('product table not present');
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
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
  return {
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

export function parseTopHoldingsMarkdown(markdown: string, ticker: string, companyNames: Map<string, string> = new Map()): { headers: string[]; rows: JsonRecord[]; asOfDate: string | null } {
  const source = String(markdown ?? '').replace(/\r/g, '');
  const heading = /###\s+Holdings\s*\n+####\s+As of\s*([^\n]*)/i.exec(source);
  const asOfDate = heading ? toIsoDate(heading[1]) : null;
  const start = source.search(/###\s+Holdings\b/i);
  if (start < 0) return { headers: HOLDINGS_HEADERS, rows: [], asOfDate };
  const lines = source.slice(start).split('\n');
  const rows: JsonRecord[] = [];
  let tableStarted = false;
  for (const line of lines) {
    if (!line.trim().startsWith('|')) {
      if (tableStarted && rows.length) break;
      continue;
    }
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cleanText);
    if (cells.length < 2 || cells[0].toLowerCase() === 'name' || /^-+$/.test(cells[0])) continue;
    tableStarted = true;
    const name = cells[0];
    if (name.toLowerCase() === 'remaining portfolio') continue;
    const normalized = normalizeHoldingName(name);
    const resolvedTicker = companyNames.get(normalized) || companyNames.get(normalizeHoldingNameCore(name)) || '-';
    rows.push({ Name: name, Ticker: resolvedTicker || '-', Identifier: '-', Weight: String(numberOrNull(cells[1]) ?? 0), 'Market Value': '-', 'Shares Held': '-', 'Asset Category': '-' });
  }
  return { headers: HOLDINGS_HEADERS, rows, asOfDate };
}

function secHeaders(): Record<string, string> {
  return { 'User-Agent': SEC_UA, Accept: 'application/json, application/xml, text/xml, text/plain' };
}

export function parseFundTickerMap(payload: JsonRecord): Map<string, SecSeriesRef> {
  const result = new Map<string, SecSeriesRef>();
  const fields = Array.isArray(payload?.fields) ? payload.fields.map(String) : [];
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const at = (field: string) => String(row[fields.indexOf(field)] ?? '');
    const ticker = sanitizeTicker(at('symbol'));
    const cik = at('cik').replace(/\D/g, '');
    const seriesId = at('seriesId').toUpperCase();
    const classId = at('classId').toUpperCase();
    if (ticker && cik && seriesId && !result.has(ticker)) result.set(ticker, { cik: cik.padStart(10, '0'), seriesId, classId });
  }
  return result;
}

function unescapeXml(value: string): string {
  return value.replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");
}

function tagValue(xml: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<(?:(?:[A-Za-z0-9_.-]+):)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[A-Za-z0-9_.-]+):)?${escaped}>`, 'i').exec(xml);
  return match ? cleanText(unescapeXml(match[1].replace(/<[^>]+>/g, ' '))) : '';
}

function tagAttribute(xml: string, tag: string, attribute: string): string {
  const match = new RegExp(`<(?:(?:[A-Za-z0-9_.-]+):)?${tag}\\b[^>]*\\b${attribute}="([^"]*)"`, 'i').exec(xml);
  return match ? cleanText(unescapeXml(match[1])) : '';
}

export function nportUrlFor(cik: string, accession: string): string {
  const digits = String(cik).replace(/\D/g, '').replace(/^0+/, '') || '0';
  const acc = String(accession).replace(/-/g, '');
  // The raw submission text is the stable machine-readable public document for
  // WisdomTree's NPORT-P filings; primary_doc.xml is often only the EDGAR
  // submission header or an XSL-rendered HTML view.
  return `${SEC_ARCHIVES}/${digits}/${acc}/${accession}.txt`;
}

export function parseEdgarAtomFilings(xml: string): NportAccession[] {
  const result: NportAccession[] = [];
  for (const match of String(xml ?? '').matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
    const body = match[1];
    const type = (tagValue(body, 'filing-type') || '').toUpperCase();
    if (type && type !== 'NPORT-P') continue;
    if (/<amend>/i.test(body)) continue;
    const accession = tagValue(body, 'accession-number');
    if (!accession) continue;
    const href = /<filing-href>([\s\S]*?)<\/filing-href>/i.exec(body)?.[1] || '';
    const cik = /\/data\/(\d+)\//i.exec(unescapeXml(href))?.[1] || '';
    result.push({ accession, filed: tagValue(body, 'filing-date'), reportDate: tagValue(body, 'period'), url: nportUrlFor(cik, accession) });
  }
  return result;
}

export function parseNport(xml: string): ParsedNport {
  const text = String(xml ?? '');
  const genInfo = /<genInfo\b[^>]*>([\s\S]*?)<\/genInfo>/i.exec(text)?.[1] || text.slice(0, 5000);
  const fundInfo = /<fundInfo\b[^>]*>([\s\S]*?)<\/fundInfo>/i.exec(text)?.[1] || '';
  const holdings: JsonRecord[] = [];
  let totalValue = 0;
  for (const match of text.matchAll(/<invstOrSec\b[^>]*>([\s\S]*?)<\/invstOrSec>/gi)) {
    const body = match[1];
    const name = tagValue(body, 'name') || tagValue(body, 'title') || '-';
    const cusip = tagValue(body, 'cusip');
    const identifier = cusip && !/^n\/?a$/i.test(cusip) ? cusip : tagAttribute(body, 'isin', 'value') || tagAttribute(body, 'other', 'value') || '-';
    const value = numberOrNull(tagValue(body, 'valUSD'));
    const weight = numberOrNull(tagValue(body, 'pctVal'));
    if (value !== null) totalValue += value;
    const debt = /<debtSec\b[^>]*>([\s\S]*?)<\/debtSec>/i.exec(body)?.[1] || '';
    holdings.push({
      Name: name,
      Ticker: '-',
      Identifier: identifier,
      Weight: weight === null ? '0' : String(weight),
      'Market Value': value === null ? '0' : String(value),
      'Shares Held': tagValue(body, 'balance') || '-',
      'Asset Category': tagValue(body, 'assetCat') || '-',
      ...(debt ? { Coupon: tagValue(debt, 'annualizedRt') || '-', Maturity: tagValue(debt, 'maturityDt') || '-' } : {}),
    });
  }
  return {
    regName: tagValue(genInfo, 'regName'),
    regCik: tagValue(genInfo, 'regCik'),
    seriesName: tagValue(genInfo, 'seriesName'),
    seriesId: tagValue(genInfo, 'seriesId'),
    repPdDate: toIsoDate(tagValue(genInfo, 'repPdDate')),
    holdings,
    totalValue: round(totalValue, 2),
    netAssets: numberOrNull(tagValue(fundInfo, 'netAssets')),
  };
}

export function normalizeHoldingName(value: unknown): string {
  let text = cleanText(value).toUpperCase().replace(/[’']/g, '').replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  text = text.replace(/\bCLASS\s+([A-Z])\b/g, 'CL $1').replace(/\bCL\.?\s*([A-Z])\b/g, 'CL $1');
  const keepClass = text.match(/\bCL\s+[A-Z]\b/gi)?.[0] || '';
  text = text.replace(/\b(THE|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|SA|NV|AG|SE|SPA|ORDINARY|COMMON|STOCK|SHS|SHARES|ADR|DEPOSITARY|RECEIPT|USD|US|REG|REGISTERED)\b/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  if (keepClass && !/\bCL\s+[A-Z]\b/.test(text)) text = `${text} ${keepClass}`.trim();
  return text;
}

export function normalizeHoldingNameCore(value: unknown): string {
  return normalizeHoldingName(value).replace(/\s+CL\s+[A-Z]\b/g, '').trim();
}

export function cleanHoldingTicker(value: unknown): string {
  const raw = cleanText(value).toUpperCase();
  if (!raw || ['-', '--', 'N/A', 'NA', 'NONE', 'NULL', 'SEE FILE'].includes(raw)) return '';
  return raw.replace(/\s+/g, '');
}

function parseCompanyTickerMap(payload: JsonRecord): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of Object.values(payload || {})) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as JsonRecord;
    const ticker = cleanHoldingTicker(row.ticker);
    const title = cleanText(row.title);
    if (!ticker || !title) continue;
    for (const key of [normalizeHoldingName(title), normalizeHoldingNameCore(title)]) if (key && !map.has(key)) map.set(key, ticker);
  }
  return map;
}

async function loadFundTickerTable(config: UpdaterConfig): Promise<Map<string, SecSeriesRef>> {
  if (fundTickerMap) return fundTickerMap;
  if (fundTickerMapPromise) return fundTickerMapPromise;
  fundTickerMapPromise = (async () => {
    const payload = await fetchJson(SEC_FUND_TICKERS_URL, '[edgar   ] fund ticker table', config, secHeaders());
    fundTickerMap = parseFundTickerMap(payload);
    console.log(`[edgar   ] SEC fund ticker table: ${fundTickerMap.size} share classes`);
    return fundTickerMap;
  })();
  try {
    return await fundTickerMapPromise;
  } finally {
    fundTickerMapPromise = null;
  }
}

async function loadCompanyTickerTable(config: UpdaterConfig): Promise<Map<string, string>> {
  if (companyTickerMap) return companyTickerMap;
  if (companyTickerMapPromise) return companyTickerMapPromise;
  companyTickerMapPromise = (async () => {
    const payload = await fetchJson(SEC_COMPANY_TICKERS_URL, '[edgar   ] company ticker table', config, secHeaders());
    companyTickerMap = parseCompanyTickerMap(payload);
    console.log(`[edgar   ] SEC company ticker table: ${companyTickerMap.size} issuer names`);
    return companyTickerMap;
  })();
  try {
    return await companyTickerMapPromise;
  } finally {
    companyTickerMapPromise = null;
  }
}

function fillNportTickers(rows: JsonRecord[], names: Map<string, string>): JsonRecord[] {
  return rows.map((row) => {
    if (cleanHoldingTicker(row.Ticker)) return row;
    const ticker = names.get(normalizeHoldingName(row.Name)) || names.get(normalizeHoldingNameCore(row.Name)) || '';
    return ticker ? { ...row, Ticker: ticker } : row;
  });
}

async function resolveNportFiling(fund: CatalogFund, config: UpdaterConfig): Promise<{ ref: SecSeriesRef; accession: NportAccession } | null> {
  const table = await loadFundTickerTable(config);
  const ref = table.get(fund.ticker);
  if (!ref) return null;
  const params = new URLSearchParams({ action: 'getcompany', CIK: ref.seriesId, type: 'NPORT-P', owner: 'include', count: '10', output: 'atom' });
  const atom = await fetchText(`${SEC_BROWSE_URL}?${params.toString()}`, `[edgar   ] ${fund.ticker} filings`, config, secHeaders());
  const [accession] = parseEdgarAtomFilings(atom);
  return accession ? { ref, accession } : null;
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

function anchor(days: ChartDay[], target: Date): ChartDay | null {
  let found: ChartDay | null = null;
  for (const day of days) {
    if (new Date(`${day.date}T00:00:00Z`) <= target) found = day;
    else break;
  }
  return found;
}

export function priceReturns(days: ChartDay[], now = new Date()): PriceReturns {
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const last = ordered[ordered.length - 1];
  if (!last) return { ...EMPTY_PRICE_RETURNS };
  const date = new Date(`${last.date}T00:00:00Z`);
  const target = (years: number) => new Date(date.getTime() - years * 365.25 * 86_400_000);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const quarterStartMonth = Math.floor(date.getUTCMonth() / 3) * 3;
  const quarterStart = new Date(Date.UTC(date.getUTCFullYear(), quarterStartMonth, 1));
  const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, date.getUTCDate()));
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
    siAnn: ordered.length > 1 ? annualized(ordered[0].adjClose, end, Math.max(1 / 365, (date.getTime() - new Date(`${ordered[0].date}T00:00:00Z`).getTime()) / (365.25 * 86_400_000))) : null,
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

function lastCompletedQuarterEnd(now = new Date()): string {
  const month = now.getUTCMonth();
  const quarterEndMonth = Math.floor(month / 3) * 3 - 1;
  const year = quarterEndMonth < 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const normalizedMonth = (quarterEndMonth + 12) % 12;
  const day = new Date(Date.UTC(year, normalizedMonth + 1, 0));
  return day.toISOString().slice(0, 10);
}

function deriveMetrics(derived: PriceReturns, fund: CatalogFund, dividends: Array<{ epoch: number; amount: number }>, frequency: { paymentsPerYear: number | null }, price: number | null): JsonRecord {
  const latest = dividends[dividends.length - 1];
  const indicated = fund.dividendYield ?? (latest && frequency.paymentsPerYear && price ? round((latest.amount * frequency.paymentsPerYear / price) * 100, 2) : null);
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
    secYield: fund.secYield,
    secYieldText: fund.secYield === null ? '—' : `${fund.secYield.toFixed(2)}%`,
    returnsBasis: 'adjusted market-price closes (Yahoo chart API), not official WisdomTree NAV returns',
  };
}

function historyRows(days: ChartDay[]): JsonRecord[] {
  return days.map((day) => ({ Date: formatDate(day.date), Close: String(day.close), 'Adj Close': String(day.adjClose), Volume: String(day.volume) }));
}

function mergeOfficialReturns(derived: PriceReturns, official: OfficialProductReturns | null): PriceReturns {
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
    grossTer: null,
    nav: numberOrNull(row.navValue),
    close: numberOrNull(row.closePriceValue),
    premiumDiscount: numberOrNull(row.premiumDiscountValue),
    netAssets: numberOrNull(row.aumValue),
    dividendYield: numberOrNull(metrics.dividendYield),
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

async function writeIfChanged(file: URL, value: unknown): Promise<boolean> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  try {
    if (await readFile(file, 'utf8') === text) return false;
  } catch {
    // New file.
  }
  await mkdir(new URL('.', file), { recursive: true });
  await writeFile(file, text, 'utf8');
  return true;
}

async function writePages(fundDir: URL, ticker: string, kind: 'holdings' | 'history', headers: string[], rows: JsonRecord[], pageSize: number, asOfDate: string | null, source: string): Promise<JsonRecord> {
  const dir = new URL(`${kind}/`, fundDir);
  await mkdir(dir, { recursive: true });
  const pageCount = rows.length ? Math.ceil(rows.length / pageSize) : 0;
  const kept = new Set<string>();
  for (let page = 0; page < pageCount; page += 1) {
    const name = `${String(page + 1).padStart(3, '0')}.json`;
    kept.add(name);
    await writeIfChanged(new URL(name, dir), { ticker, page: page + 1, pageSize, totalRows: rows.length, headers, rows: rows.slice(page * pageSize, (page + 1) * pageSize) });
  }
  try {
    for (const name of await readdir(dir)) if (name.endsWith('.json') && !kept.has(name)) await rm(new URL(name, dir), { force: true });
  } catch {
    // Directory may not exist on a zero-row first run.
  }
  return { pages: [...kept].sort().map((name) => `${kind}/${name}`), pageSize, totalRows: rows.length, ...(kind === 'holdings' ? { asOfDate, asOf: asOfDate ? formatDate(asOfDate) : '—', source } : { asOf: asOfDate ? formatDate(asOfDate) : '—', source }) };
}

function catalogFilterReasons(fund: CatalogFund, config: UpdaterConfig): string[] {
  const reasons: string[] = [];
  if (config.tickers && !config.tickers.has(fund.ticker)) reasons.push('TICKERS');
  if (!rangeMatches(fund.netAssets, config.aum)) reasons.push('AUM');
  if (!rangeMatches(fund.ter, config.ter)) reasons.push('TER');
  if (!rangeMatches(fund.dividendYield, config.dividendYield)) reasons.push('DIVIDEND_YIELD');
  for (const [period, range] of Object.entries(config.performance) as [ReturnPeriod, Range][]) {
    const value = period === 'YTD' ? null : null; // returns are derived after Yahoo; young funds remain eligible.
    if (value !== null && !rangeMatches(value, range)) reasons.push(`PERFORMANCE_${period}`);
  }
  return reasons;
}

function matchesReturnFilters(metrics: JsonRecord, config: UpdaterConfig): string[] {
  const reasons: string[] = [];
  const annual: Record<ReturnPeriod, number | null> = { YTD: metrics.ytd, '1Y': metrics.cagr1y ?? metrics.tr1y, '3Y': metrics.cagr3y, '5Y': metrics.cagr5y, '10Y': metrics.cagr10y };
  const cumulative: Record<ReturnPeriod, number | null> = { YTD: metrics.ytd, '1Y': metrics.tr1y, '3Y': metrics.tr3y, '5Y': metrics.tr5y, '10Y': metrics.tr10y };
  for (const [period, range] of Object.entries(config.performance) as [ReturnPeriod, Range][]) if (annual[period] !== null && !rangeMatches(annual[period], range)) reasons.push(`PERFORMANCE_${period}`);
  for (const [period, range] of Object.entries(config.totalReturn) as [ReturnPeriod, Range][]) if (cumulative[period] !== null && !rangeMatches(cumulative[period], range)) reasons.push(`TOTAL_RETURN_${period}`);
  return reasons;
}

async function processFund(fund: CatalogFund, config: UpdaterConfig, previous: JsonRecord = {}): Promise<JsonRecord> {
  const reasons = catalogFilterReasons(fund, config);
  if (reasons.length) {
    return { __skipped: true, ticker: fund.ticker, __skipReasons: reasons };
  }
  const fundDir = new URL(`funds/${fund.ticker}/`, API_ROOT);
  await mkdir(fundDir, { recursive: true });
  const previousMeta = await readPreviousMeta(fund.ticker);
  let productPageMarkdown: string | null = null;
  let productSummary: ProductPageSummary | null = null;
  if (!config.skipWisdomTree && fund.fundPage) {
    try {
      productPageMarkdown = await fetchText(productProxyUrl(fund.fundPage), `[product ] ${fund.ticker}`, config, { Accept: 'text/markdown' });
      productSummary = parseProductPageSummary(productPageMarkdown);
      if (productSummary.name) fund.name = productSummary.name;
      if (productSummary.cusip) fund.cusip = productSummary.cusip;
      if (productSummary.nav !== null) fund.nav = productSummary.nav;
      if (productSummary.marketPrice !== null) fund.close = productSummary.marketPrice;
      if (productSummary.premiumDiscount !== null) fund.premiumDiscount = productSummary.premiumDiscount;
      if (productSummary.netExpenseRatio !== null) fund.ter = productSummary.netExpenseRatio;
      if (productSummary.secYield !== null) fund.secYield = productSummary.secYield;
    } catch (error) {
      console.warn(`[product ] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let holdingsRows: JsonRecord[] = [];
  let holdingsHeaders = HOLDINGS_HEADERS;
  let holdingsAsOf: string | null = null;
  let holdingsSource = 'not available from current public SEC filing';
  let nport: ParsedNport | null = null;
  if (config.edgarFallback) {
    try {
      const filing = await resolveNportFiling(fund, config);
      if (filing) {
        const parsed = parseNport(await fetchText(filing.accession.url, `[nport   ] ${fund.ticker}`, config, secHeaders()));
        const seriesMatches = !parsed.seriesId || parsed.seriesId.toUpperCase() === filing.ref.seriesId.toUpperCase();
        if (seriesMatches && parsed.holdings.length) {
          const names = await loadCompanyTickerTable(config);
          holdingsRows = fillNportTickers(parsed.holdings, names);
          holdingsHeaders = holdingsRows.some((row) => 'Coupon' in row || 'Maturity' in row) ? [...HOLDINGS_HEADERS, 'Coupon', 'Maturity'] : HOLDINGS_HEADERS;
          holdingsAsOf = parsed.repPdDate || null;
          nport = parsed;
          holdingsSource = `SEC EDGAR Form N-PORT-P (accession ${filing.accession.accession}, report period ${parsed.repPdDate || 'n/a'})`;
        }
      }
    } catch (error) {
      console.warn(`[nport   ] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!holdingsRows.length && config.edgarFallback && fund.fundPage) {
    try {
      const issuerMarkdown = productPageMarkdown ?? await fetchText(productProxyUrl(fund.fundPage), `[issuer  ] ${fund.ticker}`, config, { Accept: 'text/markdown' });
      const top = parseTopHoldingsMarkdown(issuerMarkdown, fund.ticker, companyTickerMap || new Map());
      if (top.rows.length) {
        holdingsRows = top.rows;
        holdingsHeaders = top.headers;
        holdingsAsOf = top.asOfDate;
        holdingsSource = 'WisdomTree product page top holdings (issuer fallback; full N-PORT filing unavailable)';
      }
    } catch {
      // SEC is the normal route; keep a previous sheet or an empty sheet below.
    }
  }

  if (!holdingsRows.length) {
    holdingsRows = await readPreviousSheet(fund.ticker, 'holdings');
    holdingsHeaders = (await readPreviousHeaders(fund.ticker, 'holdings')) || holdingsHeaders;
    holdingsAsOf = previousMeta?.holdings?.asOfDate || null;
    holdingsSource = previousMeta?.holdings?.source || holdingsSource;
  }

  let chart: ParsedChart | null = null;
  let days: ChartDay[] = [];
  let historySource = 'Yahoo Finance public chart API (adjusted close)';
  if (!config.skipYahoo) {
    try {
      const query = new URLSearchParams({ period1: '0', period2: String(Math.floor(Date.now() / 1000) + 86_400), interval: '1d', events: 'div|split', includeAdjustedClose: 'true' });
      if (config.historyRange && config.historyRange !== 'max') query.set('range', config.historyRange);
      const payload = await fetchJson(`${YAHOO_CHART_URL}/${encodeURIComponent(fund.ticker)}?${query.toString()}`, `[chart   ] ${fund.ticker}`, config, { 'User-Agent': 'Mozilla/5.0' });
      chart = parseChart(payload);
      days = chart.days;
    } catch (error) {
      console.warn(`[chart   ] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!days.length) {
    const previousRows = await readPreviousSheet(fund.ticker, 'history');
    days = previousRows.map((row) => ({ date: toIsoDate(row.Date), close: numberOrNull(row.Close) || 0, adjClose: numberOrNull(row['Adj Close']) || numberOrNull(row.Close) || 0, volume: numberOrNull(row.Volume) || 0 })).filter((row) => row.date && row.close > 0);
    if (previousRows.length) historySource = previousMeta?.history?.source || 'previous run';
  }

  // House policy: prefer official issuer data whenever it exists and is
  // non-empty. The official "Recent Distributions" table only ever shows a
  // small recent window, so Yahoo dividend events fill in older ex-dates it
  // doesn't cover (or the whole history when the product-page fetch failed,
  // both direct and proxy).
  const officialDistributions = productPageMarkdown ? parseOfficialDistributions(productPageMarkdown) : [];
  const yahooDividends = chart?.dividends || [];
  const { rows: distributionRecords, yahooOnlyCount } = mergeDistributionRecords(officialDistributions, yahooDividends);
  const distributionEvents = distributionRecordEvents(distributionRecords);
  const frequency = inferDistributionFrequency(distributionEvents);
  const latest = distributionEvents[distributionEvents.length - 1] || null;
  const derived = priceReturns(days);
  const officialReturns = productSummary?.officialReturns.monthEnd || null;
  const effectiveReturns = mergeOfficialReturns(derived, officialReturns);
  const price = productSummary?.marketPrice ?? chart?.regularMarketPrice ?? (days.length ? days[days.length - 1].close : numberOrNull(previous.closePriceValue));
  const metrics = deriveMetrics(effectiveReturns, fund, distributionEvents, frequency, price);
  if (officialReturns) {
    metrics.returnsBasis = 'WisdomTree product-page Market Price Returns where published; Yahoo adjusted market-price closes for missing values';
  }
  const returnFilterReasons = matchesReturnFilters(metrics, config);
  if (returnFilterReasons.length) {
    return { __skipped: true, ticker: fund.ticker, __skipReasons: returnFilterReasons };
  }

  const history = historyRows(days);
  const historyAsOf = derived.asOfDate || previousMeta?.history?.asOf || null;
  const holdingManifest = await writePages(fundDir, fund.ticker, 'holdings', holdingsHeaders, holdingsRows, config.holdingsPageSize, holdingsAsOf, holdingsSource);
  const historyManifest = await writePages(fundDir, fund.ticker, 'history', historyHeaders(), history, config.historyPageSize, historyAsOf, historySource);
  let distributionHeaders = DISTRIBUTION_HEADERS;
  let distributionTable: string[][];
  let distributionFrequency: string;
  let distributionPaymentsPerYear: number | null;
  let distributionsSource: string;
  if (distributionRecords.length) {
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
  const marketPrice = price;
  const nav = fund.nav ?? numberOrNull(previous.navValue);
  const premiumDiscount = fund.premiumDiscount ?? (nav && marketPrice ? round((marketPrice / nav - 1) * 100, 2) : numberOrNull(previous.premiumDiscountValue));
  const netAssets = fund.netAssets ?? nport?.netAssets ?? numberOrNull(previous.aumValue);
  const asOfDate = fund.asOfDate || toIsoDate(previous.asOfDate) || null;
  const asOfLabel = asOfDate ? formatDate(asOfDate) : chart?.regularMarketTime ? formatDate(new Date(chart.regularMarketTime * 1000).toISOString().slice(0, 10)) : '—';
  const navAsOfLabel = productSummary?.navAsOfDate ? formatDate(productSummary.navAsOfDate) : asOfLabel;
  const marketPriceAsOfLabel = productSummary?.marketPriceAsOfDate ? formatDate(productSummary.marketPriceAsOfDate) : asOfLabel;
  const returns = {
    derivedFrom: officialReturns
      ? 'WisdomTree product-page Market Price Returns where published; Yahoo adjusted market-price closes for missing values. navReturns and indexReturns come from the same official Total Returns table with no non-official fallback (indexReturns is the benchmark index, not the fund itself).'
      : 'adjusted market-price closes (Yahoo chart API), not official WisdomTree NAV returns',
    monthEnd: {
      asOfDate: effectiveReturns.asOfDate ? formatDate(effectiveReturns.asOfDate) : '—',
      mo1: effectiveReturns.mo1, mo1Text: effectiveReturns.mo1 === null ? '—' : `${effectiveReturns.mo1.toFixed(2)}%`,
      qtd: effectiveReturns.qtd, qtdText: effectiveReturns.qtd === null ? '—' : `${effectiveReturns.qtd.toFixed(2)}%`,
      ytd: effectiveReturns.ytd, ytdText: effectiveReturns.ytd === null ? '—' : `${effectiveReturns.ytd.toFixed(2)}%`,
      yr1: effectiveReturns.yr1, yr1Text: effectiveReturns.yr1 === null ? '—' : `${effectiveReturns.yr1.toFixed(2)}%`,
      yr3: effectiveReturns.cagr3y, yr3Text: effectiveReturns.cagr3y === null ? '—' : `${effectiveReturns.cagr3y.toFixed(2)}%`,
      yr5: effectiveReturns.cagr5y, yr5Text: effectiveReturns.cagr5y === null ? '—' : `${effectiveReturns.cagr5y.toFixed(2)}%`,
      yr10: effectiveReturns.cagr10y, yr10Text: effectiveReturns.cagr10y === null ? '—' : `${effectiveReturns.cagr10y.toFixed(2)}%`,
      sinceInception: effectiveReturns.siAnn, sinceInceptionText: effectiveReturns.siAnn === null ? '—' : `${effectiveReturns.siAnn.toFixed(2)}%`,
      navReturns: formatOfficialReturnRow(officialReturns?.navReturns ?? null),
      indexReturns: formatOfficialReturnRow(officialReturns?.indexReturns ?? null),
    },
    quarterEnd: productSummary?.officialReturns.quarterEnd ? {
      asOfDate: formatDate(productSummary.officialReturns.quarterEnd.asOfDate),
      ytd: productSummary.officialReturns.quarterEnd.ytd,
      yr1: productSummary.officialReturns.quarterEnd.yr1,
      yr3: productSummary.officialReturns.quarterEnd.cagr3y,
      yr5: productSummary.officialReturns.quarterEnd.cagr5y,
      yr10: productSummary.officialReturns.quarterEnd.cagr10y,
      sinceInception: productSummary.officialReturns.quarterEnd.siAnn,
      navReturns: formatOfficialReturnRowPlain(productSummary.officialReturns.quarterEnd.navReturns),
      indexReturns: formatOfficialReturnRowPlain(productSummary.officialReturns.quarterEnd.indexReturns),
    } : { asOfDate: formatDate(lastCompletedQuarterEnd()), ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null, navReturns: null, indexReturns: null },
  };

  const meta: JsonRecord = {
    ticker: fund.ticker,
    name: fund.name,
    category: fund.category,
    categoryPath: fund.categoryPath,
    source: {
      fundPage: fund.fundPage,
      officialProductPage: productProxyUrl(fund.fundPage),
      productPageAsOf: productSummary?.productAsOfDate ? formatDate(productSummary.productAsOfDate) : null,
      holdingsDownload: null,
      pricesDownload: null,
      yahooChart: `${YAHOO_CHART_URL}/${encodeURIComponent(fund.ticker)}`,
      holdingsSource,
      historySource,
      distributionsSource,
      provider: 'WisdomTree U.S. product catalog + official WisdomTree product page + SEC EDGAR Form N-PORT-P + Yahoo Finance public chart API',
    },
    identifiers: { cusip: fund.cusip || null, isin: fund.isin || null, indexTicker: fund.benchmark || null },
    expenseRatio: { display: fund.ter === null ? '—' : `${fund.ter}%`, value: fund.ter },
    nav: { display: nav === null ? '—' : `$${nav.toFixed(2)}`, value: nav, asOfDate: navAsOfLabel },
    marketPrice: { display: marketPrice === null ? '—' : `$${marketPrice.toFixed(2)}`, value: marketPrice, asOfDate: marketPriceAsOfLabel },
    premiumDiscount: { display: premiumDiscount === null ? '—' : `${premiumDiscount.toFixed(2)}%`, value: premiumDiscount },
    aum: { display: formatAumDisplay(netAssets), value: netAssets, asOfDate: asOfDate ? formatDate(asOfDate) : (nport?.repPdDate ? formatDate(nport.repPdDate) : '—'), source: fund.source === 'wisdomtree' ? 'WisdomTree product table Assets Under Mgmt $(000)' : nport ? `SEC Form N-PORT-P net assets (${nport.repPdDate || 'n/a'})` : 'previous run' },
    yields: { dividendYield: metrics.dividendYield, dividendYieldText: metrics.dividendYieldText, dividendYieldKind: fund.dividendYield !== null ? 'trailing 12-month, published by WisdomTree catalog' : 'indicated (latest distribution x inferred frequency / market price)', distributionRate: productSummary?.distributionYield ?? null, secYield: metrics.secYield, secYieldText: metrics.secYieldText, secYieldKind: productSummary?.secYield !== null && productSummary?.secYield !== undefined ? '30-day SEC yield published on the official WisdomTree product page' : 'not present in the current official product-page rendering' },
    returns,
    distributions: { frequency: distributionFrequency, paymentsPerYear: distributionPaymentsPerYear, source: distributionsSource, headers: distributionHeaders, rows: distributionTable },
    holdings: holdingManifest,
    history: historyManifest,
  };
  await writeIfChanged(new URL('meta.json', fundDir), meta);

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
    nav: nav === null ? '—' : `$${nav.toFixed(2)}`,
    navValue: nav,
    aum: formatAumDisplay(netAssets),
    aumValue: netAssets,
    asOfDate: asOfLabel,
    inceptionDate: fund.inception ? formatDate(fund.inception) : chart?.firstTradeDate ? formatDate(new Date(chart.firstTradeDate * 1000).toISOString().slice(0, 10)) : (previous.inceptionDate || '—'),
    exchange: fund.exchange || chart?.exchangeName || previous.exchange || '',
    closePrice: marketPrice === null ? '—' : `$${marketPrice.toFixed(2)}`,
    closePriceValue: marketPrice,
    premiumDiscount: premiumDiscount === null ? '—' : `${premiumDiscount.toFixed(2)}%`,
    premiumDiscountValue: premiumDiscount,
    distributions: { frequency: distributionFrequency, exDate: latest ? formatUsDate(latest.epoch) : (previous.distributions?.exDate || '—'), dividend: latest ? String(round(latest.amount, 6)) : (previous.distributions?.dividend || '—') },
    returns,
    metrics,
    holdings: holdingsRows.length,
    history: history.length,
  };
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

const USAGE = `
WisdomTree ETF static data updater

Sources:
  catalog       WisdomTree U.S. ETF product table (official page; read-only
                Jina rendering fallback when Cloudflare blocks a non-browser
                request)
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
  AUM=:\n  TER=:\n  DIVIDEND_YIELD=:\n  TICKERS="USFR DGRW"  optional ticker allowlist
  PERFORMANCE_YTD|1Y|3Y|5Y|10Y=min:max   annualized ranges
  TOTAL_RETURN_YTD|1Y|3Y|5Y|10Y=min:max cumulative ranges
  HOLDINGS_PAGE_SIZE=250
  HISTORY_PAGE_SIZE=1000
  HISTORY_RANGE=max
  MAX_RETRIES=2
  STORE_RAW_DOWNLOADS=off
  EDGAR_FALLBACK=1
  SKIP_WISDOMTREE=off  use the previously published catalog
  SKIP_YAHOO=off       keep previously published history when possible

Examples:
  TICKERS="USFR DGRW WCLD" ./scripts/update-data.ts
  AUM="large:" TER=":0.30" ./scripts/update-data.ts
  PERFORMANCE_3Y="10:" TOTAL_RETURN_1Y="15:" ./scripts/update-data.ts
`;

async function main(): Promise<void> {
  const config = readConfig();
  requestSleepSeconds = config.requestSleep;
  requestGateAt = 0;
  outputPrintConfig('WisdomTree', config);

  const previous = await readPreviousIndex();
  const catalog = new Map<string, CatalogFund>();
  let catalogSource = 'previous api/wisdomtree/index.json';
  if (!config.skipWisdomTree) {
    try {
      const fetched = await fetchCatalog(config);
      const parsed = parseCatalogMarkdown(fetched.markdown);
      for (const fund of parsed) catalog.set(fund.ticker, fund);
      catalogSource = fetched.source;
      if (config.storeRawDownloads) {
        const raw = new URL('raw/', API_ROOT);
        await mkdir(raw, { recursive: true });
        await writeFile(new URL(`product-table-${new Date().toISOString().slice(0, 10)}.md`, raw), fetched.markdown, 'utf8');
      }
    } catch (error) {
      console.warn(`[catalog ] ${error instanceof Error ? error.message : String(error)} — keeping the published feed`);
    }
  }
  if (!catalog.size) for (const [ticker, row] of previous) catalog.set(ticker, parsePreviousFund(ticker, row));
  if (catalog.size && catalogSource !== 'previous api/wisdomtree/index.json') for (const [ticker, row] of previous) if (!catalog.has(ticker)) catalog.set(ticker, parsePreviousFund(ticker, row));

  const universe = [...catalog.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  if (!universe.length) throw new Error('No catalog rows available. Run this where www.wisdomtree.com is reachable or seed api/wisdomtree/index.json first.');
  console.log(`[catalog ] ${universe.length} WisdomTree ETFs (${catalogSource})`);

  let state: JsonRecord = {};
  try { state = JSON.parse(await readFile(STATE_FILE, 'utf8')) as JsonRecord; } catch { state = {}; }
  const cursor = config.maxFetches > 0 ? String(state.cursor || '') : '';
  const index = cursor ? universe.findIndex((fund) => fund.ticker === cursor) : -1;
  const ordered = index >= 0 ? universe.slice(index + 1).concat(universe.slice(0, index + 1)) : universe;
  const queue = ordered.slice();
  const totalAttempts = config.maxFetches > 0 ? Math.min(config.maxFetches, ordered.length) : ordered.length;
  const results: JsonRecord[] = [];
  let processed = 0;
  let failures = 0;
  let lastTicker: string | null = cursor || null;
  outputPrintFilter(universe.length, universe.length, outputHasOutputFilters(config));
  const output = outputCreateReporter(API_ROOT, totalAttempts);
  const worker = async (): Promise<void> => {
    for (;;) {
      if (config.maxFetches > 0 && processed >= config.maxFetches) return;
      const fund = queue.shift();
      if (!fund) return;
      processed += 1;
      const before = await output.before(fund.ticker);
      try {
        const row = await processFund(fund, config, previous.get(fund.ticker) || {});
        if (row.__skipped) {
          await output.result(fund.ticker, before, 'skipped', (row.__skipReasons || ['not eligible']).join(', '));
        } else {
          results.push(row);
          lastTicker = fund.ticker;
          await output.result(fund.ticker, before);
        }
      } catch (error) {
        failures += 1;
        const message = error instanceof Error ? error.message : String(error);
        const old = previous.get(fund.ticker);
        if (old && !hasConfiguredFilters(config)) results.push(old);
        await output.result(fund.ticker, before, 'failed', message);
      }
    }
  };
  await Promise.all(Array.from({ length: config.concurrency }, () => worker()));

  const filterRun = hasConfiguredFilters(config);
  const funds = [...results].sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)));
  if (!filterRun) {
    for (const fund of universe) if (!funds.some((row) => row.ticker === fund.ticker)) {
      const old = previous.get(fund.ticker);
      if (old) funds.push(old);
    }
    funds.sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)));
  }
  const counts = { funds: funds.length, holdings: funds.reduce((sum, row) => sum + (numberOrNull(row.holdings) || 0), 0), history: funds.reduce((sum, row) => sum + (numberOrNull(row.history) || 0), 0) };
  await writeIfChanged(INDEX_FILE, {
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    source: {
      provider: 'WisdomTree Asset Management, Inc. (U.S.-listed ETFs)',
      market: 'us',
      site: WISDOMTREE_SITE,
      catalog: WISDOMTREE_CATALOG_URL,
      catalogFallback: WISDOMTREE_CATALOG_PROXY_URL,
      holdings: 'SEC EDGAR Form N-PORT-P for exact series (issuer product-page top holdings fallback)',
      returns: 'Official WisdomTree product-page Total Returns table (Market Price, NAV and Underlying Index Returns rows)',
      distributions: 'Official WisdomTree product-page Recent Distributions table (Ordinary Income/Short-Term/Long-Term Capital Gains/Return of Capital breakdown); Yahoo Finance dividend events fill in older ex-dates the official table does not cover',
      history: 'Yahoo Finance public chart API (adjusted close)',
    },
    counts,
    funds,
  });
  await writeIfChanged(STATE_FILE, { cursor: config.maxFetches > 0 ? lastTicker : null, savedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') });
  console.log(`[done    ] ${results.length} funds updated, ${failures} failures`);
  console.log(`[done    ] counts: ${counts.funds} funds / ${counts.holdings.toLocaleString('en-US')} holdings rows / ${counts.history.toLocaleString('en-US')} history rows`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### WisdomTree data update\n\n- updated: ${results.length}\n- failed: ${failures}\n- counts: ${counts.funds} funds / ${counts.holdings.toLocaleString('en-US')} holdings rows / ${counts.history.toLocaleString('en-US')} history rows\n`, 'utf8');
}

if ((import.meta as { main?: boolean }).main) {
  if (process.argv.some((arg) => ['-h', '--help', 'help'].includes(arg))) console.log(USAGE.trim());
  else await main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
}
