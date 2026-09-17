#!/usr/bin/env bun

// Parse the browser's TypeScript before publishing. The deployed page relies
// on Babel standalone at runtime, so a missing comma or other syntax error
// would otherwise leave the catalog permanently on its loading state.

declare const Bun: {
  file(path: string): { text(): Promise<string> };
  Transpiler: new (options: { loader: string }) => { transform(source: string): string | Promise<string> };
};

type BrowserScript = { inline: string } | { src: string };

function attributeValue(attributes: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attributes);
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null;
}

export function extractBrowserScript(html: string): BrowserScript {
  const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scripts.exec(html))) {
    const type = attributeValue(match[1], 'type');
    if (type?.toLowerCase() !== 'text/babel') continue;
    const src = attributeValue(match[1], 'src');
    if (src) return { src };
    if (match[2].trim()) return { inline: match[2] };
  }
  throw new Error('index.html: text/babel browser script not found');
}

// Keep the original helper for callers that specifically want an inline
// script, while allowing the page to move its Babel entrypoint into a local
// .tsx file without making this validation stale.
export function extractInlineBrowserScript(html: string): string {
  const script = extractBrowserScript(html);
  if ('inline' in script) return script.inline;
  throw new Error(`index.html: text/babel script is external (${script.src})`);
}

export async function parseBrowserScript(source: string): Promise<string> {
  const transformed = await new Bun.Transpiler({ loader: 'tsx' }).transform(source);
  if (!transformed || typeof transformed !== 'string') throw new Error('browser script did not transpile');
  return transformed;
}

// Backwards-compatible name for the inline-script parser used by the earlier
// single-file layout.
export const parseInlineBrowserScript = parseBrowserScript;

if ((import.meta as { main?: boolean }).main) {
  const indexUrl = new URL('../index.html', import.meta.url);
  const html = await Bun.file(indexUrl.pathname).text();
  const script = extractBrowserScript(html);
  const sourcePath = 'src' in script ? new URL(script.src, indexUrl) : indexUrl;
  if (sourcePath.protocol !== 'file:') throw new Error(`browser script must be local: ${sourcePath.href}`);
  const source = 'inline' in script ? script.inline : await Bun.file(sourcePath.pathname).text();
  const transformed = await parseBrowserScript(source);
  const label = 'src' in script ? script.src : 'index.html inline script';
  console.log(`${label} parses (${source.length.toLocaleString()} source chars, ${transformed.length.toLocaleString()} transpiled chars)`);
}
