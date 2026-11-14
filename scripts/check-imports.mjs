// Kiểm tra mọi import tương đối (./, ../) và alias (@/) trong mã nguồn có trỏ tới file TỒN TẠI không, và các file bắt buộc của Next.js.
// Chạy tại thư mục gốc dự án:  node scripts/check-imports.mjs
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const ROOT = process.cwd();
const DIRS = ['app', 'components', 'lib', 'contexts', 'types', 'scripts'];
const EXTS = ['', '.ts', '.tsx', '.js', '.mjs', '.json', '.css', '/index.ts', '/index.tsx', '/index.js'];
const walk = d => (existsSync(d) ? readdirSync(d).flatMap(n => { const p = join(d, n); return n === 'node_modules' || n === '.next' ? [] : statSync(p).isDirectory() ? walk(p) : [p]; }) : []);
const files = DIRS.flatMap(d => walk(join(ROOT, d))).filter(f => /\.(ts|tsx|mjs)$/.test(f));
const RE = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const missing = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(RE)) {
    const spec = m[1] ?? m[2] ?? m[3];
    const base = spec.startsWith('@/') ? join(ROOT, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(f), spec) : null;
    if (base && !EXTS.some(e => existsSync(base + e) && (e !== '' || statSync(base).isFile()))) missing.push(`${f.slice(ROOT.length + 1)}  →  ${spec}`);
  }
}
const required = ['app/layout.tsx', 'app/page.tsx', 'app/globals.css', 'package.json', 'next.config.ts', 'tsconfig.json', 'firestore.rules'];
const noReq = required.filter(r => !existsSync(join(ROOT, r)));
console.log(`Đã quét ${files.length} file.`);
if (noReq.length) console.log('THIẾU file bắt buộc:\n  ' + noReq.join('\n  '));
if (missing.length) console.log(`THIẾU ${new Set(missing.map(x => x.split('→')[1].trim())).size} đích import (${missing.length} lượt):\n  ` + [...new Set(missing)].slice(0, 60).join('\n  '));
if (!noReq.length && !missing.length) console.log('OK: không thiếu file nào.');
process.exit(noReq.length || missing.length ? 1 : 0);
