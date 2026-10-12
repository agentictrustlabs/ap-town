// check:no-jsx-escapes — a `\uXXXX` in a JSX TEXT node is not an escape.
//
// JSX children are text, not a string literal: the compiler hands them through as written. So
// `<button>← Back</button>` renders the SIX CHARACTERS `←`, and `standing — this page`
// renders the backslash too. Both shipped to town.faithnet.io and sat there in production, because
// nothing catches this — it typechecks, it builds, it lays out, and it only looks wrong to a person
// reading the page. The file reads as if it is being careful about encoding while doing the opposite.
//
// The rule: inside a .tsx file, every `\uXXXX` must sit in a string literal, a template literal, or a
// comment. Anywhere else it is text somebody will read. Write the character itself (—, ←, ×, …).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const ESCAPE = /\\u[0-9a-fA-F]{4}/;
const SKIP = new Set(['node_modules', 'dist', '.wrangler', '.git', 'coverage']);

const tsxFiles = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (e.endsWith('.tsx')) out.push(p);
  }
  return out;
};

/**
 * Strip what the compiler DOES read escapes in: quoted strings, template literals, and comments.
 * Whatever still holds an escape afterwards is text on the page. Deliberately simple — it over-strips
 * rather than under-strips, so it accuses nothing it cannot prove.
 */
const bareText = (line: string): string =>
  line
    .replace(/\/\/.*$/, '')
    .replace(/\/\*.*?\*\//g, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');

const findings: string[] = [];
let scanned = 0;
for (const file of tsxFiles(ROOT)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  scanned += 1;
  let inBlockComment = false;
  for (const [i, line] of lines.entries()) {
    const trimmed = line.trim();
    if (inBlockComment) { if (trimmed.includes('*/')) inBlockComment = false; continue; }
    if (/^\/\*/.test(trimmed) && !trimmed.includes('*/')) { inBlockComment = true; continue; }
    if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue;
    if (!ESCAPE.test(line)) continue;
    if (ESCAPE.test(bareText(line))) findings.push(`${relative(ROOT, file)}:${i + 1}  ${trimmed}`);
  }
}

if (findings.length > 0) {
  console.error(`✗ check:no-jsx-escapes — ${findings.length} escape(s) in JSX text, which render as literal characters:\n`);
  for (const f of findings) console.error(`  ${f}`);
  console.error('\n  JSX children are text, not a string literal. Write the character itself (— ← × …).');
  process.exit(1);
}
console.log(`✓ check:no-jsx-escapes passed (${scanned} .tsx file(s); every \\uXXXX sits in a string, template or comment).`);
