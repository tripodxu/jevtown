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
import { crowd } from '../public/shared/personas.js';
import { exposureBands } from '../public/shared/feed.js';
import { pickableGroups, reconcileAudience, pickLabelZh, segments } from '../public/shared/summary.js';
import { pickProvider, ask as askJev } from '../public/shared/jev.js';
import { createMockAsk } from '../public/shared/mock.js';
import { AUDIENCE_STATE_ZH, CALIBRATE_ZH, calibrateSayZh, segmentValueZh } from '../public/shared/labels.js';

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
const positional = args.filter((arg, index) => !arg.startsWith('--') && !/^--(preset|prices|max-waves|audience|picked)$/.test(args[index - 1] ?? ''));
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

// -- 作者自述的受众（R35）----------------------------------------------------------
// 和站点同构：一句话 + 挑中的段 id（`attribute:value`，逗号分隔）。挑不到的 id 会被丢掉并
// 在这里报出来——CLI 没有清单可点，作者手打错一个 id，报告里就少一行而他不知道少在哪。
// 不传这两个参数时存档里不写 audience 字段，旧流程一字不变。

const saidInput = (option('audience') ?? '').trim();
const pickedInput = (option('picked') ?? '').split(',').map((id) => id.trim()).filter(Boolean);
const pickableIds = new Set(pickableGroups(crowd('zh')).map((one) => one.id));
const pickedGroups = [...new Set(pickedInput)];
const unknownPicked = pickedGroups.filter((id) => !pickableIds.has(id));
if (unknownPicked.length) console.error(`  忽略 ${unknownPicked.length} 个不存在的段 id：${unknownPicked.join(', ')}（段 id 见 npm run check -- --audience x --picked interest:photography）`);
const knownPicked = pickedGroups.filter((id) => pickableIds.has(id));
const audience = saidInput || knownPicked.length ? { said: saidInput.slice(0, 200), picked: knownPicked } : null;

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
    `Jev 调用 ${result.requests} 次 / ${result.ms}ms 模型耗时 · 花费 $${result.usd.toFixed(4)} · ${result.seconds.toFixed(1)}s`,
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

// -- 对账：作者说给谁的 vs 实际停在哪 -----------------------------------------------
// 只做对账，不改分发。这里算出来的数与报告里那一节同源（reconcileAudience 是同一个函数），
// 所以终端与页面上不会出现两个口径。

if (audience) {
  const byId = new Map(pickableGroups(crowd('zh')).map((one) => [one.id, one]));
  const said = reconcileAudience(segments(presetId, keys, Uint8Array.from(result.reactions), crowd('zh')), knownPicked, { presetId });
  console.log(`  「这段话是给谁的」：${audience.said || '（没写自述）'}`);
  if (knownPicked.length) console.log(`    你挑的 ${knownPicked.length} 组：${knownPicked.map((id) => pickLabelZh(byId.get(id))).join(' · ')}`);
  for (const row of said.rows) {
    console.log(`    [${AUDIENCE_STATE_ZH[row.state]}] ${pickLabelZh({ attribute: row.attribute, zh: segmentValueZh(row.attribute, row.value) })}：${row.stopped}/${row.size}（${Math.round((row.stopped / (row.size || 1)) * 100)}% · ${row.lift.toFixed(2)}×）`);
  }
  if (said.unsaidMore) console.log(`    还有 ${said.unsaidMore} 组也显著停下来，这次没列。`);
}

// -- 对账：Jev 开局押的，兑现了吗 --------------------------------------------------
// 第 1 波那 600 个人是 Jev 按 exposure 挑的，这里把那份打分与后来实际发生的并排放在一起。
// 终端与页面同源（都是 exposureBands），所以两边不会出现两个口径。零新增调用。

const bands = exposureBands(presetId, keys, result.scores, Uint8Array.from(result.reactions), crowd('zh'));
console.log(`\n【${CALIBRATE_ZH.title}】${calibrateSayZh(bands)}`);
console.log(`  ${CALIBRATE_ZH.townNote.replace('%1', String(bands.town.reached)).replace('%2', String(bands.town.stopped)).replace('%3', String(bands.town.glad))}`);
for (const row of bands.bands) {
  const rate = (row.reached ? row.stopped / row.reached : 0);
  console.log(
    `    第 ${String(row.band).padStart(2)} 档  exposure ${row.low.toFixed(3)}–${row.high.toFixed(3)} · ${String(row.people).padStart(5)} 人 · ` +
      `读到 ${String(row.reached).padStart(5)} · 停下 ${(rate * 100).toFixed(1).padStart(5)}% · 乐见 ${((row.reached ? row.glad / row.reached : 0) * 100).toFixed(1).padStart(5)}% · ` +
      `相对全城 ${row.stoppedLift.toFixed(2)}×`,
  );
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
      waveOf: Array.from(result.waveOf),
      waves: result.waves,
      checks: result.checks,
      unlisted: result.unlisted,
      // 开局那份打分：报告里「Jev 押得准吗」这一节要靠它重算 exposure。
      // 以前不存档，于是旧存档回放时那一节只能空着——这是补上，不是改格式。
      scores: result.scores,
      said: result.said,
      decisions: result.decisions,
      followUp: result.followUp,
      prices: result.prices ?? null,
      // 终端与站点同构：{said, picked}。null 时不写这个字段，旧存档的回放一字不变。
      audience: audience ?? undefined,
      usd: result.usd,
    },
    null,
    2,
  ),
);
console.log(`  已存：output/checks/${path.basename(file)}`);
