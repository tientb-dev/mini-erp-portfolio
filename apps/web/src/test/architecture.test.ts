import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * Dependency rules of the web app (docs/architecture/FRONTEND.md §3), checked on the source text so that
 * a violation fails `pnpm test` without adding a lint dependency.
 */
const SRC = resolve(__dirname, '..');
const files = (function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
})(SRC);
const rel = (p: string) => relative(SRC, p).split(sep).join('/');

/** Relative imports of one file, resolved to repo files (`import`, `export … from`). */
function importsOf(file: string): string[] {
  const specs = [...readFileSync(file, 'utf8').matchAll(/(?:import|export)\s[^'"]*?from\s+'(\.[^']*)'|import\s+'(\.[^']*)'/g)].map((m) => m[1] ?? m[2]);
  return specs.map((s) => {
    const base = resolve(dirname(file), s);
    const hit = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')].find((c) => existsSync(c) && statSync(c).isFile());
    if (!hit) throw new Error(`${rel(file)}: cannot resolve '${s}'`);
    return hit;
  });
}
const graph = new Map(files.map((f) => [f, importsOf(f)]));
const isTest = (f: string) => /\.test\.tsx?$/.test(f) || rel(f).startsWith('test/');
const layer = (f: string) => rel(f).split('/')[0];
const feature = (f: string) => (layer(f) === 'features' ? rel(f).split('/')[1] : null);

describe('Frontend dependency rules', () => {
  it('shared/, services/ and config/ never import features/ or app/', () => {
    const bad = [...graph].flatMap(([f, deps]) => (['shared', 'services', 'config'].includes(layer(f)) && !isTest(f)
      ? deps.filter((d) => ['features', 'app'].includes(layer(d))).map((d) => `${rel(f)} -> ${rel(d)}`) : []));
    expect(bad).toEqual([]);
  });

  it('only main.tsx imports app/', () => {
    const bad = [...graph].flatMap(([f, deps]) => (layer(f) !== 'app' && rel(f) !== 'main.tsx'
      ? deps.filter((d) => layer(d) === 'app').map((d) => `${rel(f)} -> ${rel(d)}`) : []));
    expect(bad).toEqual([]);
  });

  it('a feature reaches another feature (and app/ reaches a feature) only through its index.ts', () => {
    const bad = [...graph].flatMap(([f, deps]) => deps
      .filter((d) => feature(d) && feature(d) !== feature(f) && !/\/index\.tsx?$/.test(rel(d)))
      .map((d) => `${rel(f)} -> ${rel(d)}`));
    expect(bad).toEqual([]);
  });

  it('has no circular imports', () => {
    const cycles: string[] = [];
    const state = new Map<string, 'visiting' | 'done'>();
    const visit = (f: string, path: string[]) => {
      if (state.get(f) === 'done') return;
      if (state.get(f) === 'visiting') { cycles.push([...path.slice(path.indexOf(f)), f].map(rel).join(' -> ')); return; }
      state.set(f, 'visiting');
      for (const d of graph.get(f) ?? []) visit(d, [...path, f]);
      state.set(f, 'done');
    };
    for (const f of files) visit(f, []);
    expect(cycles).toEqual([]);
  });

  it('no business file is left at the src/ root', () => {
    expect(files.filter((f) => !rel(f).includes('/')).map(rel)).toEqual(['main.tsx']);
  });
});
