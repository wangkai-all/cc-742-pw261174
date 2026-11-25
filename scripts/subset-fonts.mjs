// Regenerate the subset WOFF2 fonts used by the desk.
//
// The UI ships its own Noto Sans SC subset so the page renders identically
// offline (no CDN, no system-font guessing). The subset must cover every glyph
// that can appear: corpus text, all UI source strings, the stylesheet (which
// carries a few glyphs in comments and counters) and the HTML shell.
//
// Run:  node scripts/subset-fonts.mjs   (from the repo root)

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from '../.tools/node_modules/subset-font/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

function walk(dir, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    const st = statSync(join(root, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (/\.(js|css|html)$/.test(name)) out.push(rel);
  }
  return out;
}

const sources = ['public/index.html', 'public/styles.css', 'src/data/corpus.json', ...walk('src/app'), ...walk('src/core')];
const base = sources.map(read).join('\n');
const ui = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .,:;!?()[]{}<>/\\|-_+=*&%#@~`"\''
  + '，。、；：？！（）【】《》“”‘’—…·×÷≤≥±°％–→←↑↓✓✕•…';
const chars = [...new Set(base + ui)].sort().join('');
writeFileSync(join(root, 'scripts/.font-glyphs.txt'), chars);

for (const weight of [400, 500, 700]) {
  const src = join(root, `.tools/node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-${weight}-normal.woff2`);
  const out = join(root, `public/vendor/fonts/noto-sans-sc-${weight}-subset.woff2`);
  const buf = readFileSync(src);
  const sub = await subsetFont(buf, chars, { targetFormat: 'woff2' });
  writeFileSync(out, sub);
  console.log(`${weight}: ${(buf.length / 1024).toFixed(0)} KB -> ${(sub.length / 1024).toFixed(0)} KB, ${[...chars].length} glyphs`);
}
console.log(`scanned ${sources.length} files`);
