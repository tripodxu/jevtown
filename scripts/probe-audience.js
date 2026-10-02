// 阈值探针：audience 的三个闸门到底该定在哪？
//
// partsOf 用三件事决定「你说的受众」是谁（public/shared/feed.js:420-430）：
//   NAMED_FROM = 0.5   part:* 这道 noul 读到多高，才算「描述点了这个维度」
//   PART_FROM  = 0.5   某个维度里最高的那组要到多高，这个维度才算数
//   PASS_SHARE = 0.7   在计数的维度里，一组要到最高的 0.7 倍才算数
// 三行注释都写着 "Not measured yet"，scripts/ 下也没有 probe.js——拍脑袋的数直接当闸门，
// 「给年轻人」可能砍掉三千人，也可能只剩三十人。本探针把它们量出来。
//
// 量法（对每一对「描述 × 人群」）让 Jev 答两件事：
//   1. 这描述说的是哪种人（audienceRequest 的 83 组 FIT 分）
//   2. 这个群里真的有多少人是那种人（本地算：镇子里符合条件的人数 / 该组总人数）
// 然后看 Jev 的分和真比例对不对得上。Jev 答不出「你写了年轻人」，阈值再准也没用。
//
// 用法：node scripts/probe-audience.js --real              （量一组描述）
//       node scripts/probe-audience.js --real --all        （量下面全部描述）
//       node scripts/probe-audience.js                     （默认 mock，零花费）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audienceRequest, audienceAnswers } from '../public/shared/requests.js';
import { partsOf, audienceOf } from '../public/shared/feed.js';
import { crowd } from '../public/shared/personas.js';
import { pickProvider, ask as askJev } from '../public/shared/jev.js';
import { createMockAsk } from '../public/shared/mock.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(here, '..', '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

const args = process.argv.slice(2);
const picked = pickProvider(process.env);
const real = args.includes('--real') && picked;
if (args.includes('--real') && !picked) console.error('没有 key，退回 mock');
const send = real ? (request) => askJev(picked, request) : createMockAsk();

/**
 * 每条描述配一个「它真正说的是谁」的判据：本地数出来的真人数/该组人数。
 * 这一栏是这轮唯一的地基：Jev 的分如果对不上真比例，阈值定在哪都没用。
 */
const DESCRIPTIONS = [
  { text: '给正在攒钱买第一台笔记本电脑的上班族看：学生党刚工作，预算三五千。', wants: { budget: ['tight', 'average'] } },
  { text: '给 25 到 34 岁、正在看房或者刚租房的人看。', wants: { age: ['a25', 'a35'] } },
  { text: '给刚生孩子的年轻父母。', wants: { shopping: ['kids'], age: ['a25', 'a35'] } },
  { text: '给爱喝茶的中老年人看。', wants: { age: ['a60', 'a45'] } },
  { text: '给爱打游戏的人看。', wants: { interest: 'gaming' } },
  { text: '给做设计与摄影的人看。', wants: { field: ['design', 'media'] } },
  { text: '给所有二十多岁的人看。', wants: { age: ['a18', 'a25'] } },
  { text: '给准备买自行车代步的人看。', wants: { shopping: ['bicycle'] } },
  { text: '给退休了在公园下棋的老年人看。', wants: { age: ['a60'] } },
  { text: '给在中小厂上班、担心裁员的人看。', wants: { field: ['it'] } },
  { text: '给爱养花种菜的人看。', wants: { interest: 'gardening' } },
  { text: '给爱美妆、买护肤品的人看。', wants: { interest: 'beauty', shopping: ['beauty'] } },
];

/** 镇子里「属于这种人」的真比例：每一维都要命中，兴趣是三个里有一个就算（人格的兴趣不是主次）。 */
const people = crowd('zh');
const fitOf = (who, wants) => {
  if (wants.age && !wants.age.includes(who.ageGroup)) return false;
  if (wants.field && !wants.field.includes(who.field)) return false;
  if (wants.budget && !wants.budget.includes(who.budget)) return false;
  if (wants.shopping && !wants.shopping.includes(who.shopping)) return false;
  if (wants.interest && !who.interests.includes(wants.interest)) return false;
  return true;
};
/** 组 → 组里有多少人属于「那种人」。分母是该组全体（组本身也可能整体偏斜）。 */
const truthOf = (groupId, wants) => {
  const [part, value] = groupId.split(':');
  const inGroup = people.filter((who) => (part === 'interest' ? who.interests.includes(value) : part === 'field' ? who.field === value : part === 'age' ? who.ageGroup === value : part === 'budget' ? who.budget === value : who.shopping === value));
  if (!inGroup.length) return { share: 0, n: 0 };
  return { share: inGroup.filter((who) => fitOf(who, wants)).length / inGroup.length, n: inGroup.length };
};

console.log('—— ' + (real ? `真实 ${picked.name}` : 'mock') + ` · 镇子 ${people.length} 人 ——`);
const all = [];
for (const { text, wants } of DESCRIPTIONS) {
  const result = await send(audienceRequest(text));
  const { scores, named } = audienceAnswers(result.answers);
  console.log(`\n【${text.slice(0, 30)}${text.length > 30 ? '…' : ''}】花费 $${result.usd.toFixed(4)} · ${result.requests ?? 1} 次`);
  console.log(`  Jev 说它点名了：${named.length ? named.join('、') : '（没有）'}`);
  const rows = [];
  for (const [id, score] of Object.entries(scores)) {
    const truth = truthOf(id, wants);
    if (truth.n < 30) continue; // 少于 30 人的组，真比例本身是噪声
    rows.push({ id, score, ...truth });
  }
  rows.sort((a, b) => b.score - a.score);
  for (const row of rows.slice(0, 6)) {
    const zh = row.id.includes(':') ? row.id.split(':')[1] : row.id;
    console.log(`    ${zh.padEnd(30)} Jev ${row.score.toFixed(3)}  真 ${(row.share * 100).toFixed(1)}%  ${row.n} 人`);
  }
  for (const row of rows.slice(-3)) {
    const zh = row.id.includes(':') ? row.id.split(':')[1] : row.id;
    console.log(`    ${zh.padEnd(30)} Jev ${row.score.toFixed(3)}  真 ${(row.share * 100).toFixed(1)}%  ${row.n} 人  ← 最低`);
  }
  // 现成的闸门现在真的会留下多少人：partsOf(0.5, 0.7) + audienceOf。不量就不知道这三个
  // 拍脑袋的数在真实读数上等于什么——它们眼下是没人走过的死代码。
  const parts = partsOf(scores, named);
  const kept = parts ? audienceOf(people, parts) : [];
  const keptTruth = kept.filter((who) => fitOf(who, wants)).length / Math.max(1, kept.length);
  console.log(`  现闸门 partsOf(0.5, 0.7) → ${parts ? JSON.stringify(parts) : 'null（描述作废）'} · 留下 ${kept.length} 人（${(kept.length / people.length * 100).toFixed(1)}%）· 其中真是那种人的 ${(keptTruth * 100).toFixed(1)}%`);
  all.push({ text, wants, named, scores, rows, parts, kept: kept.length, keptTruth });
}

// 汇总：Jev 的分能不能当「像不像那种人」的代理？按真比例排序，看秩次差多少。
const paired = all.flatMap((a) => a.rows).filter((r) => r.n >= 30);
const spearman = (() => {
  if (paired.length < 10) return null;
  const rankOf = (values) => {
    const idx = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const ranks = new Array(values.length);
    idx.forEach(([, i], r) => { ranks[i] = r + 1; });
    return ranks;
  };
  const a = rankOf(paired.map((r) => r.score));
  const b = rankOf(paired.map((r) => r.share));
  const n = paired.length;
  const d2 = a.reduce((s, r, i) => s + (r - b[i]) ** 2, 0);
  return { n, rho: 1 - (6 * d2) / (n * (n * n - 1)) };
})();
console.log(`\n—— 汇总：${paired.length} 个「组 × 描述」配对 ——`);
if (spearman) console.log(`  Jev 分与真比例的秩相关 rho = ${spearman.rho.toFixed(3)}`);
const banded = [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1.01]];
for (const [lo, hi] of banded) {
  const inBand = paired.filter((r) => r.share >= lo && r.share < hi);
  if (!inBand.length) continue;
  const mean = inBand.reduce((s, r) => s + r.score, 0) / inBand.length;
  console.log(`  真比例 ${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%  ${String(inBand.length).padStart(3)} 组  Jev 分均值 ${mean.toFixed(3)}`);
}
const top = paired.filter((r) => r.share >= 0.6);
const rest = paired.filter((r) => r.share < 0.6);
if (top.length && rest.length) console.log(`  真比例 ≥60% 的组 Jev 分均值 ${(top.reduce((s, r) => s + r.score, 0) / top.length).toFixed(3)}，<60% 的 ${(rest.reduce((s, r) => s + r.score, 0) / rest.length).toFixed(3)}`);

// 噪声底：同一句描述、同一个请求，再问一遍。两次之差全是抖动——闸门跨不过它就等于随机。
// partsOf 的 PART_FROM / PASS_SHARE 都是拿分数比大小，所以噪声底直接决定这两个数能定多细。
console.log('\n—— 噪声底：同一请求复读一遍 ——');
const fliers = [DESCRIPTIONS[1], DESCRIPTIONS[4], DESCRIPTIONS[10]];
for (const { text, wants } of fliers) {
  const first = audienceAnswers((await send(audienceRequest(text))).answers);
  const second = audienceAnswers((await send(audienceRequest(text))).answers);
  const ids = Object.keys(first.scores);
  const diffs = ids.map((id) => Math.abs(first.scores[id] - (second.scores[id] ?? 0)));
  const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  const sorted = [...diffs].sort((a, b) => a - b);
  console.log(`  「${text.slice(0, 14)}…」平均绝对差 ${mean.toFixed(4)} · 中位 ${sorted[Math.floor(sorted.length / 2)].toFixed(4)} · 最大 ${sorted.at(-1).toFixed(4)}`);
}
console.log(`\n花费：每条描述一次请求，上面已逐条列出。`);

// 最后一件必须量的：part:* 那五道 noul。「给刚生孩子的年轻父母」明明点了年龄和兴趣，
// Jev 却一个维度都没点名——partsOf 于是返回 null，对账表整个是空的。NAMED_FROM = 0.5
// 定在 noul 的哪一档，得看它答了什么。
console.log('\n—— part:* 五道 noul 的读数（NAMED_FROM = 0.5 是闸门）——');
for (const text of [DESCRIPTIONS[2].text, DESCRIPTIONS[1].text, DESCRIPTIONS[4].text, '写给刚生孩子的年轻父母。', '写给刚开始养猫的年轻人。']) {
  const answers = (await send(audienceRequest(text))).answers;
  const reads = Object.entries(answers)
    .filter(([id]) => id.startsWith('part:'))
    .map(([id, answer]) => `${id.slice(5)} ${(answer.noul ?? 0).toFixed(3)}`);
  const above = Object.entries(answers).filter(([id, a]) => id.startsWith('part:') && (a.noul ?? 0) >= 0.5).map(([id]) => id.slice(5));
  console.log(`  「${text.slice(0, 16)}」${reads.join(' · ')}  → 点名 ${above.length ? above.join('、') : '（没有）'}`);
}


