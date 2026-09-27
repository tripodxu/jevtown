#!/usr/bin/env node
// 终端跑一次完整检查，不经过站点：
//   npm run check -- --preset listing "iPhone 13，128G，电池 86%，无维修，1400 元，可小刀"
//   npm run check -- --preset post --max-waves 2 "我为什么把每周的例会砍成了 15 分钟"
// 密钥从 .env.local 读（模板见 .env.example）；没有 key 或 MOCK=1 时自动走 mock，全程不花钱。
// 结果打印摘要，并把完整字节存到 output/checks/<时间戳>.json，给前端回放或对比用。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCheck } from '../public/shared/check.js';
import { PRESETS } from '../public/shared/presets.js';
import { pickProvider, ask as askJev } from '../public/shared/jev.js';
import { createMockAsk } from '../public/shared/mock.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// 轻量 .env.local 加载（不引入依赖）：KEY=VALUE，# 注释，已存在的环境变量优先。
const envFile = path.join(here, '..', '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

// -- 参数 -----------------------------------------------------------------------

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const positional = args.filter((arg, index) => !arg.startsWith('--') && !/^--(preset|prices|max-waves)$/.test(args[index - 1] ?? ''));
const presetId = option('preset') ?? 'post';
const prices = (option('prices') ?? '9,19,39,79').split(',').map(Number);
const maxWaves = Number(option('max-waves') ?? 4);
const text = positional.join(' ').trim();

if (!PRESETS[presetId]) {
  console.error(`unknown preset: ${presetId}（可选：post / listing / product / headline）`);
  process.exit(1);
}
if (!text) {
  console.error('用法：npm run check -- --preset post "要检查的文本"');
  process.exit(1);
}

// -- 发送通道 ---------------------------------------------------------------------

const picked = pickProvider(process.env);
const provider =
  process.env.MOCK === '1' || process.env.JEV_PROVIDER === 'mock' || !picked
    ? { name: 'mock', send: createMockAsk() }
    : { name: picked.name, send: (request) => askJev(picked, request) };

const result = await runCheck({
  send: provider.send,
  presetId,
  pool: 'zh',
  text,
  versionId: `cli.${Date.now()}`,
  prices,
  maxWaves,
  blocking: true,
});

// -- 摘要 -------------------------------------------------------------------------

const keys = Object.keys(PRESETS[presetId].reactions);
const preset = PRESETS[presetId];
const countBy = (predicate) => result.reactions.reduce((sum, byte) => sum + (byte && predicate(preset.reactions[keys[byte - 1]]) ? 1 : 0), 0);
const zh = { post: '帖子', listing: '闲置转让', product: '商品', headline: '标题' }[presetId];

console.log(`\n【${zh}】${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`);
console.log(`通道：${provider.name}`);
if (result.blocked.length) {
  console.log(`审核拒绝：${result.blocked.join(', ')}`);
  process.exit(0);
}
console.log(
  `到达 ${result.reach} 人 · 停下 ${countBy((r) => r?.stopped)} · 乐见 ${countBy((r) => r?.tone === 1)} · 反感 ${countBy((r) => r?.tone === -1)} · ` +
    `花费 $${result.usd.toFixed(4)} · ${result.seconds.toFixed(1)}s`,
);
for (const wave of result.waves) {
  console.log(`  第 ${wave.index + 1} 波：${wave.size}/${wave.asked} 人，情绪 ${wave.mood >= 0 ? '+' : ''}${wave.mood.toFixed(2)}，${wave.travels ? '继续传播' : '到此为止'}`);
}
if (result.said && Object.keys(result.said.lists).length) {
  for (const [list, part] of Object.entries(result.said.lists)) {
    // totals 是概率的和，不是人数：按真实回答的总量归一成份额再显示。
    const real = Object.entries(part.totals)
      .filter(([id]) => id !== 'cant_tell')
      .reduce((sum, [, value]) => sum + value, 0);
    const rows = Object.entries(part.totals)
      .filter(([id]) => id !== 'cant_tell')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    console.log(`  问小镇[${list}]：${rows.map(([id, value]) => `${id} ${((value / (real || 1)) * 100).toFixed(0)}%`).join(', ')}`);
  }
}
if (Object.keys(result.checks).length) {
  console.log(`  Jev 的解读：${Object.entries(result.checks).map(([id, p]) => `${id}=${p}`).join(', ')}`);
}

// -- 存档 -------------------------------------------------------------------------

const outDir = path.join(here, '..', 'output', 'checks');
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `${Date.now()}-${presetId}.json`);
fs.writeFileSync(
  file,
  JSON.stringify(
    {
      presetId,
      pool: 'zh',
      text,
      keys,
      reactions: Array.from(result.reactions),
      waves: result.waves,
      checks: result.checks,
      unlisted: result.unlisted,
      said: result.said,
      usd: result.usd,
    },
    null,
    2,
  ),
);
console.log(`  已存：output/checks/${path.basename(file)}`);
