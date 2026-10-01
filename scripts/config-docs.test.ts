/// <reference types="bun" />
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CONTROL_NAMES, readConfig, resolveControls, runtimeControls } from './update-data';
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const configFile = () => JSON.parse(read('scripts/update-data.config.json'));
const workflow = () => read('.github/workflows/update-data.yml');
const tenor = (name: string) => name.match(/^(PERFORMANCE|TOTAL_RETURN)_(1Y|3Y|5Y|10Y)$/);

test('configuration precedence: file < advanced < nonblank input < environment', () => {
  const c = resolveControls({ CONCURRENCY: 2, TICKERS: 'DGRW' }, { CONCURRENCY: 3, TICKERS: 'USFR' }, { CONCURRENCY: '4', TICKERS: '' }, { CONCURRENCY: '5' });
  expect(c.CONCURRENCY).toBe('5');
  expect(c.TICKERS).toBe('USFR');
  expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }).CONCURRENCY).toBe('4');
  expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }).CONCURRENCY).toBe('3');
});

test('blank input inherits the file value; advanced can deliberately blank a key', () => {
  expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }).CONCURRENCY).toBe('2');
  expect(resolveControls({ TICKERS: 'DGRW' }, {}, { TICKERS: '' }).TICKERS).toBe('DGRW');
  expect(resolveControls({ TICKERS: 'DGRW' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
  expect(resolveControls({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }).SKIP_YAHOO).toBe('false');
  expect(readConfig(resolveControls({ MAX_RETRIES: 0 })).maxRetries).toBe(0);
});

test('scheduled path (empty inputs and advanced) equals config defaults; no personal contact in defaults', () => {
  const file = configFile();
  expect(resolveControls(file, {}, {}, {})).toEqual(Object.fromEntries(Object.entries(file).map(([k, v]) => [k, String(v)])));
  expect(file.SEC_UA).not.toMatch(/@/);
  expect(file.SEC_UA).toContain('https://github.com/daggerok/WisdomTree');
  expect(readConfig(resolveControls(file)).secUa).toBe(file.SEC_UA);
  expect(read('scripts/update-data.ts')).not.toMatch(/admin@/);
});

test('provider-specific defaults', () => {
  const file = configFile();
  expect(file).toMatchObject({ MAX_FETCHES: '0', REQUEST_SLEEP: '2', CONCURRENCY: '2', HOLDINGS_PAGE_SIZE: '250', HISTORY_PAGE_SIZE: '1000', MAX_RETRIES: '2', HISTORY_RANGE: 'max', EDGAR_FALLBACK: 'true', SKIP_YAHOO: 'false', SKIP_WISDOMTREE: 'false', STORE_RAW_DOWNLOADS: 'false', AUM: ':', TER: ':', DIVIDEND_YIELD: ':', TICKERS: '' });
  const config = readConfig(resolveControls(file));
  expect(config.maxFetches).toBe(0);
  expect(config.requestSleep).toBe(2);
  expect(config.concurrency).toBe(2);
  expect(config.tickers).toBeNull();
  expect(config.edgarFallback).toBe(true);
  expect(config.skipYahoo).toBe(false);
  expect(config.skipWisdomTree).toBe(false);
  expect(config.storeRawDownloads).toBe(false);
  expect(config.historyRange).toBe('max');
  expect(config.aum).toBeUndefined();
});

test('safe resolver rejects unknown, invalid and environment-file injection values', () => {
  for (const value of [{ UNKNOWN: 1 }, { SEC_UA: 'x\nEVIL=yes' }, { CONCURRENCY: 0 }, { MAX_RETRIES: -1 }, { MAX_FETCHES: 1.5 }, { REQUEST_SLEEP: '-1' }, { VERBOSE: 'maybe' }, { EDGAR_FALLBACK: 'maybe' }, { AUM: '1:2:3' }, { TER: '5:1' }, { PERFORMANCE_1Y: '5' }, { TICKERS: ['DGRW'] }, null, []]) {
    expect(() => resolveControls(value)).toThrow();
  }
  expect(() => resolveControls({}, { SEC_UA: 'x\rfoo' })).toThrow();
  expect(() => resolveControls({}, {}, {}, { SEC_UA: 'x\0bad' })).toThrow();
  expect(() => resolveControls({}, 'x')).toThrow();
  expect(() => resolveControls({}, { UNKNOWN: 'x' })).toThrow();
  expect(() => resolveControls({}, {}, { TICKERS: { a: 1 } })).toThrow();
  expect(() => resolveControls({}, {}, { TICKERS: 'A\nB' })).toThrow();
});

test('runtimeControls reads the config file and lets the environment win', async () => {
  const file = configFile();
  expect(await runtimeControls({})).toEqual(resolveControls(file));
  expect((await runtimeControls({ CONCURRENCY: '7' })).CONCURRENCY).toBe('7');
});

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

test('workflow: <= 25 inputs, advanced default, every input is a control, fixed output, no inputs.* interpolation', () => {
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
  expect(actual).not.toMatch(/inputs\.\w+ \|\| '/);
  expect(actual).not.toMatch(/OUTPUT_DIR|output_dir/i);
  expect(actual).toContain('PROTECTED_SEC_UA: ${{ vars.SEC_UA }}');
  expect(actual.match(/git add (\S+)/g)).toEqual(['git add api/wisdomtree']);
  expect(actual.match(/api\/[\w-]+/g)!.every((p) => p === 'api/wisdomtree')).toBe(true);
  expect(actual).toContain('if: ${{ !cancelled() }}');
});

test('every control stays reachable from the workflow: individually or through advanced', () => {
  const actual = workflow();
  const individual = new Set([...actual.matchAll(/^      (\w+):$/gm)].map((m) => m[1].toUpperCase()));
  const viaAdvanced = CONTROL_NAMES.filter((n) => !individual.has(n));
  expect(viaAdvanced).toEqual(['STORE_RAW_DOWNLOADS', 'SEC_UA', 'VERBOSE']);
  expect(() => resolveControls(configFile(), Object.fromEntries(viaAdvanced.map((n) => [n, configFile()[n]])))).not.toThrow();
});
