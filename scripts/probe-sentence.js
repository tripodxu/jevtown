// 一次性探针：删掉一句，Jev 会不会改口？（scripts/ 是 CLI，console.log 豁免 lint）
//
// 点子叫「逐句承重」：把文本切句，每句问一次「若删掉这句，这群人还在乎吗」——
// 变体写在 instructions 里，state 保持原样，于是 83 组 × N 句全在**同一个**请求里问完。
// 承重 = 原分 − 删掉后的分。正 = 这句在撑（删了更不在乎），负 = 这句在挡路。
//
// 为什么值得试：point_first 这类「哪句最重要」的问题，Jev 在 post/product 上答 0.5 左右
//（docs/measurements.md）——它答不出「第一句是否重要」。但消融不给它判断题，给它差分题：
// 同一段话删一句，两次读数的差。这是它不需要「理解重要性」就能算的东西。
//
// 用法：node scripts/probe-sentence.js --preset listing "文本"        （默认 mock，零花费）
//       node scripts/probe-sentence.js --real --preset listing "文本"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { groupsOf, MAX_TEXT_CHARS } from '../public/shared/requests.js';
import { PRESETS } from '../public/shared/presets.js';
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
const option = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const VALUE_FLAGS = new Set(['preset']);
const text = args
  .filter((arg, index) => !arg.startsWith('--') && !VALUE_FLAGS.has((args[index - 1] ?? '').replace(/^--/, '')))
  .join(' ')
  .trim();
const presetId = option('preset') ?? 'listing';
if (!PRESETS[presetId] || !text) {
  console.error('用法：node scripts/probe-sentence.js --preset listing "文本" [--real]');
  process.exit(1);
}

const picked = pickProvider(process.env);
const real = args.includes('--real') && picked;
if (args.includes('--real') && !picked) console.error('没有 key，退回 mock');
const send = real ? (request) => askJev(picked, request) : createMockAsk();

/**
 * 切句：先按句末标点切；一段里如果逗号够多（中文的逗号常常就是断句），再按逗号/顿号切一刀。
 * 太短的碎片并进前一句而不是放弃拆分——「电池 86%」自己撑不起什么，但它和「128G」是同一件事。
 * 切得太碎比切得太粗更糟：每句一个请求，钱翻倍。
 */
const BARE = (part) => part.replace(/\s/g, '').length;
function sentences(text) {
  const coarse = text
    .split(/(?<=[。！？!?；;\n])/)
    .map((part) => part.trim())
    .filter(Boolean);
  const pieces = [];
  for (const part of coarse) {
    const commas = (part.match(/[，,、]/g) ?? []).length;
    if (commas < 2) {
      pieces.push(part);
      continue;
    }
    for (const piece of part.split(/(?<=[，,、])/).map((p) => p.trim()).filter(Boolean)) {
      // 6 字以下并进上一句：一句要有话说得完的量
      if (pieces.length && BARE(piece) < 6) pieces[pieces.length - 1] += piece;
      else pieces.push(piece);
    }
  }
  const out = [];
  for (const part of pieces) {
    if (out.length && BARE(part) < 4) out[out.length - 1] += part;
    else out.push(part);
  }
  return out.length ? out : [text];
}

const preset = PRESETS[presetId];
const groups = groupsOf(preset.market);
const sentencesOfText = sentences(text);

/**
 * 读数：一个 score 请求的答案 → 每个 attribute 的 0..1 分。
 * `since` 是 instructions 的前缀：消融那一路要说清「这句被删了」，但那句话本身的措辞也会
 * 改变读数，所以另跑一路 CONTROL（原文 + 同样的措辞）把这份措辞的影响量出来，减掉。
 */
const scoresOf = (answers) =>
  Object.fromEntries(groups.map(([id]) => [id, (answers[`v:${id}`]?.score ?? 0) / 4]));
const CRITERIA = ['Not at all', 'Barely', 'Some of them would stop for it', 'Most of them would stop for it', 'It is written exactly for them'];
const howMuch = (group, since) => ({ type: 'score', instructions: `${since}How much would ${group} care about this ${preset.noun}?`, criteria: CRITERIA });

async function read(variantText, since) {
  const questions = Object.fromEntries(groups.map(([id, group]) => [`v:${id}`, howMuch(group, since)]));
  const result = await send({ state: { seen_in: preset.seenIn, [preset.noun]: variantText.slice(0, MAX_TEXT_CHARS) }, questions });
  return { scores: scoresOf(result.answers), usd: result.usd, tokens: result.tokens };
}
const charge = (result) => {
  usd += result.usd;
  tokens += result.tokens;
};

let usd = 0;
let tokens = 0;

// 基线：原封不动的一段话，被问「这群人有多在乎它」。
const base = await read(text, '');
charge(base);
// 对照：同一段话，同样的措辞，只是不删任何东西——它与基线的差就是措辞本身的影响。
const control = await read(text, 'Suppose this has just been written, with every sentence in it. ');
charge(control);

// 消融：删掉第 i 句，其余原样。每句一批问题——state 里是被删掉之后的话，instructions 里点明删的是哪句。
// delta 减掉对照（= 对照 − 基线），减掉的是「我说了删了一句这件事」本身对读数的影响。
const variants = [];
let worded = 0;
for (const [i, part] of sentencesOfText.entries()) {
  const variantText = sentencesOfText.filter((_, j) => j !== i).join('');
  const read2 = await read(variantText, `Suppose this ${preset.noun} has just been written, and the sentence "${part}" was left out. `);
  charge(read2);
  const deltas = groups.map(([id, group]) => ({
    id,
    group,
    delta: control.scores[id] - read2.scores[id],
    worded: base.scores[id] - control.scores[id],
  }));
  worded = Math.max(worded, deltas.reduce((s, d) => s + Math.abs(d.worded), 0) / deltas.length);
  const mean = deltas.reduce((s, d) => s + d.delta, 0) / deltas.length;
  const abs = deltas.reduce((s, d) => s + Math.abs(d.delta), 0) / deltas.length;
  variants.push({ i: i + 1, part, mean, abs, deltas });
}
// 噪声底：再问一遍「原文 + 同样的措辞」。上一次 control 之上再加一次同样条件的复读，
// 两者之差全是抖动——承重小于它就说明不了什么。
const again = await read(text, 'Suppose this has just been written, with every sentence in it. ');
charge(again);
const noiseDeltas = groups.map(([id]) => ({ delta: control.scores[id] - again.scores[id] }));
const noise = noiseDeltas.reduce((s, d) => s + Math.abs(d.delta), 0) / noiseDeltas.length;

console.log(`【${presetId}】${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`);
console.log(`通道：${real ? `真实 ${picked.name}` : 'mock'} · ${groups.length} 组 × ${sentencesOfText.length} 句`);
console.log(`切句：\n${sentencesOfText.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}`);
console.log(`逐句承重（正 = 这句在撑，删了更不在乎；负 = 删掉更好。均值可能抵平成 0，组与组之间的差距才是重点）`);
for (const v of variants) {
  const sign = (n) => (n >= 0 ? '+' : '');
  const top = [...v.deltas].sort((a, b) => b.delta - a.delta)[0];
  const bottom = [...v.deltas].sort((a, b) => a.delta - b.delta)[0];
  // 承重要压过噪声底才算数：|mean| 与噪声的比值是它有多少不是抖动。
  const readable = Math.abs(v.mean) > noise ? `压过噪声 ${(Math.abs(v.mean) / noise).toFixed(1)}×` : '读不出来';
  // 83 组里有几组的变化压过了自己的噪声？均值可以是 0 而信号还在——一组人来买、一组人掉头，抵平了。
  const strong = v.deltas.filter((d) => Math.abs(d.delta) > noise * 3).length;
  const spread = top.delta - bottom.delta;
  const readable2 = spread > noise * 6 ? `拉得开 ${(spread / noise).toFixed(1)}×` : '拉不开';
  console.log(`  第 ${v.i} 句 承重 ${sign(v.mean)}${v.mean.toFixed(4)} · ${readable} · ${readable2} · 压过自身噪声 3× 的组 ${strong}/${v.deltas.length}`);
  console.log(`      最吃：${top.group} ${sign(top.delta)}${top.delta.toFixed(3)} ｜ 最不在乎：${bottom.group} ${sign(bottom.delta)}${bottom.delta.toFixed(3)}`);
  console.log(`      「${v.part.slice(0, 40)}${v.part.length > 40 ? '…' : ''}」`);
}
console.log(`\n噪声底：同样的问题复读一遍，平均绝对变 ${noise.toFixed(4)}（承重小于它读不出东西）`);
console.log(`措辞本身：同样的问题换个问法，平均绝对变 ${worded.toFixed(4)}（已从承重里减掉）`);
console.log(`花费 $${usd.toFixed(4)} · tokens ${tokens} · 请求 ${variants.length + 3} 次`);