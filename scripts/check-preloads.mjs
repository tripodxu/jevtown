// modulepreload 清单校验（技术债 B10）：index.html 里那排 <link rel="modulepreload"> 是
// 手工同步的（无构建步骤压不平模块瀑布），新增静态 import 忘补就退化成逐级往返，多预载
// 则白拉字节。这里静态解析两个入口的 import 闭包，与清单比对——缺了、多了都红。
// 2026-10-06 曾用一次性脚本展开核对过；本脚本让它常驻 lint，不再是人肉记忆。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'public/index.html'), 'utf8');

const entries = [...html.matchAll(/<script type="module" src="([^"]+)"/g)].map((m) => m[1]);
const preloaded = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]);
if (!entries.length) {
  console.error('✗ public/index.html 里没找到 <script type="module">：入口变了？更新本脚本。');
  process.exit(1);
}

// 静态 ESM 三种形式（本仓库没有动态 import()；出现时这里会漏报，新加动态 import 记得补清单）。
const IMPORT_RES = [
  /^[ \t]*import\s*['"]([^'"]+)['"]/m,
  /^[ \t]*import\s[^;'\n]*?from\s*['"]([^'"]+)['"]/m,
  /^[ \t]*export\s[^;'\n]*?from\s*['"]([^'"]+)['"]/m,
];

const reached = new Set(entries);
const queue = [...entries];
while (queue.length) {
  const module = queue.pop();
  const spec = module.startsWith('/') ? module.slice(1) : module;
  let source;
  try {
    source = readFileSync(join(root, 'public', spec), 'utf8');
  } catch {
    console.error(`✗ 模块不存在：${module}`);
    process.exit(1);
  }
  for (const re of IMPORT_RES) {
    for (const match of source.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) {
      const from = match[1];
      if (!from.startsWith('.') && !from.startsWith('/')) continue; // 裸说明符（无；出现再说）
      const resolved = new URL(from, `http://x${module.startsWith('/') ? module : `/${module}`}`).pathname;
      if (!reached.has(resolved)) {
        reached.add(resolved);
        queue.push(resolved);
      }
    }
  }
}

const missing = [...reached].filter((m) => !preloaded.includes(m));
const stale = preloaded.filter((m) => !reached.has(m));
for (const m of missing) console.error(`✗ 缺预载：${m} 被静态 import，却不在 modulepreload 清单里`);
for (const m of stale) console.error(`✗ 多预载：${m} 不在任何入口的 import 闭包里，白拉字节`);
if (missing.length || stale.length) {
  console.error(`\n${missing.length + stale.length} 处清单漂移（入口 ${entries.join('、')}）`);
  process.exit(1);
}
console.log(`✓ modulepreload 清单与 import 闭包一致（${preloaded.length} 项）`);
