#!/usr/bin/env bun

// Parse the browser's inline TypeScript before publishing. The deployed page
// relies on Babel standalone at runtime, so a missing comma or other syntax
// error would otherwise leave the catalog permanently on its loading state.

declare const Bun: {
  file(path: string): { text(): Promise<string> };
  Transpiler: new (options: { loader: string }) => { transform(source: string): string | Promise<string> };
};

type Match = RegExpExecArray & { 1: string };

export function extractInlineBrowserScript(html: string): string {
  const match = /<script\s+type=["']text\/babel["'][^>]*>([\s\S]*?)<\/script>/i.exec(html) as Match | null;
  if (!match || !match[1].trim()) throw new Error('index.html: inline text/babel script not found');
  return match[1];
}

export async function parseInlineBrowserScript(source: string): Promise<string> {
  const transformed = await new Bun.Transpiler({ loader: 'tsx' }).transform(source);
  if (!transformed || typeof transformed !== 'string') throw new Error('index.html: inline script did not transpile');
  return transformed;
}

if ((import.meta as { main?: boolean }).main) {
  const html = await Bun.file(new URL('../index.html', import.meta.url).pathname).text();
  const source = extractInlineBrowserScript(html);
  const transformed = await parseInlineBrowserScript(source);
  console.log(`index.html inline script parses (${source.length.toLocaleString()} source chars, ${transformed.length.toLocaleString()} transpiled chars)`);
}
