// 哪一句在撑：把文本切句，逐句删掉再让 Jev 读一遍，看读数差多少。
//
// 为什么这样问：Jev 在这个项目里只被问过「这群人多在乎它」和「这个人会怎么做」，
// 都没有落在文本自身的某一句上。唯一问过的地方 TEXT_CHECKS.point_first 答不出
//（docs/measurements.md 记着答案都在 0.5 附近）。所以不给它判断题，给它差分题——
// 同一批人、同一套问题，删掉第 i 句再读一遍。它不需要「理解哪句重要」就能算这个。
//
// 为什么统计量是组间拉得开度而不是均值：实测（scripts/probe-sentence.js，真跑 typesafe）
// 婴儿车 listing 三句的均值全是 0.0003 / −0.0068 / −0.0018，噪声底 0.0046——
// 几乎读不出来。但同一句在「育儿」组是 +0.445、在「学生」组是 −0.175。
// 一组人买、一组人掉头，均值抵平成 0，信号其实还在。三段文本的组间差距都在 45–134 倍噪声。
//
// 为什么必须跑对照路：消融那一路的 instructions 要点明「删掉了哪句」，而那句话本身的
// 措辞就会改变读数——实测措辞本身 0.011–0.020，比一部分句子的信号还大。
// 对照路（原文 + 同样句式的措辞）与消融路相减，这份影响就抵消掉了。
import { PRESETS } from './presets.js';
import { groupsOf, MAX_TEXT_CHARS } from './requests.js';

export { MAX_TEXT_CHARS };

/** 一段文本最多切几句。切得太碎比切得太粗更糟——每句一次请求，钱翻倍。 */
export const MAX_ABLATION_SENTENCES = 6;
/** 组间差距要压过噪声底这么多倍才算「拉得开」。实测最小 45.7 倍，定 1 会让每句都通过。 */
export const SPREAD_OVER_NOISE = 6;
/** 「这一句对几组人真的不是抖动」——判据取 3 倍噪声。 */
export const STRONG_OVER_NOISE = 3;

const BARE = (part) => part.replace(/\s/g, '').length;

/**
 * 切句：先按句末标点切；一段里逗号 ≥2 再按逗号/顿号切一刀（中文的逗号常常就是断句）。
 * 太短的碎片并进上一句而不是放弃拆分——「电池 86%」自己撑不起什么，但它和「128G」是同一件事。
 * 超过 MAX_ABLATION_SENTENCES 句时，把余下的全部并进最后一句。
 */
export function sentences(text, max = MAX_ABLATION_SENTENCES) {
  const coarse = String(text ?? '')
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
  if (out.length > max) {
    const kept = out.slice(0, max - 1);
    kept.push(out.slice(max - 1).join(''));
    return kept;
  }
  return out.length ? out : [String(text ?? '')];
}

/** 和 requests.js:exposureRequest 同一套 CARE，只把 instructions 换成消融那一路的说法。 */
const CARE = ['Not at all', 'Barely', 'Some of them would stop for it', 'Most of them would stop for it', 'It is written exactly for them'];

/**
 * 一路消融读数：83 组各一道 score，全部在同一个请求里问完（83 道题一次请求，不是 83 次）。
 * `since` 是 instructions 的前缀。
 */
export function ablationRequest(presetId, text, since = '') {
  const preset = PRESETS[presetId];
  if (!preset) throw new Error(`unknown preset: ${presetId}`);
  const questions = Object.fromEntries(
    groupsOf(preset.market).map(([id, group]) => [id, { type: 'score', instructions: `${since}How much would ${group} care about this ${preset.noun}?`, criteria: CARE }]),
  );
  return { state: { seen_in: preset.seenIn, [preset.noun]: String(text ?? '').slice(0, MAX_TEXT_CHARS) }, questions };
}

/** 一路读数的答案 → 每个组的 0..1 分。CARE 五档，最后一档是 4。 */
export function ablationScores(answers, presetId) {
  return Object.fromEntries(groupsOf(PRESETS[presetId].market).map(([id]) => [id, (answers[id]?.score ?? 0) / (CARE.length - 1)]));
}

/** 「假设刚写好，每句都在」——CONTROL 与 NOISE 两路共用的措辞，和消融那一路同句式。 */
export const ALL_IN = 'Suppose this has just been written, with every sentence in it. ';
/** 消融那一路的措辞：点明删的是哪句。 */
export const leftOut = (part) => `Suppose this has just been written, and the sentence "${part}" was left out. `;

const avg = (values) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0);
const round4 = (value) => Math.round(value * 1e4) / 1e4;

/**
 * 四路读数 → 每句的承重。
 * BASE 原文原措辞；CONTROL 原文同措辞（CONTROL − BASE = 措辞本身的影响）；
 * 消融 i = 删掉第 i 句（CONTROL − 消融 i = 承重，措辞影响抵消）；
 * NOISE = CONTROL 再复读一遍（CONTROL − NOISE = 纯抖动）。
 * → { sentences, noise, worded, settled }
 */
export function ablationStats(parts, { base, control, noise, gone }) {
  const worded = avg(Object.keys(control).map((id) => Math.abs(base[id] - control[id])));
  const noiseFloor = avg(Object.keys(control).map((id) => Math.abs(control[id] - noise[id])));
  const out = parts.map((part, i) => {
    const variant = gone[i];
    const deltas = Object.keys(control).map((id) => ({ id, delta: round4(control[id] - variant[id]) }));
    const sorted = [...deltas].sort((a, b) => b.delta - a.delta);
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];
    const mean = round4(avg(deltas.map((d) => d.delta)));
    const spread = round4(top.delta - bottom.delta);
    const strong = deltas.filter((d) => Math.abs(d.delta) > noiseFloor * STRONG_OVER_NOISE).length;
    return {
      i: i + 1,
      part,
      mean,
      spread,
      strong,
      readable: spread > noiseFloor * SPREAD_OVER_NOISE,
      top: { id: top.id, delta: top.delta },
      bottom: { id: bottom.id, delta: bottom.delta },
      deltas,
    };
  });
  return { sentences: out, noise: round4(noiseFloor), worded: round4(worded), settled: true };
}

/**
 * 一次完整的消融。`send` 是 provider.ask，`onSent` 每路调用一次（Worker 用它记账）。
 * 失败就返回已经算出的部分并 settled:false——前面几句照样有结果，比整段白跑好。
 * → { sentences, noise, worded, settled, usd, tokens, ms, requests }
 */
export async function runAblation(send, { presetId, text, onSent, maxCalls = Infinity }) {
  const parts = sentences(text);
  const preset = PRESETS[presetId];
  const groups = groupsOf(preset.market);
  let usd = 0;
  let tokens = 0;
  let ms = 0;
  let requests = 0;
  const scores = {};
  const read = async (variantText, since, key) => {
    if (requests >= maxCalls) throw Object.assign(new Error('the ablation needs too many calls'), { fatal: true });
    // 尝试次数，不是成功次数：失败的那一次照样占了免费档的一次外呼。
    requests += 1;
    const result = await send(ablationRequest(presetId, variantText, since));
    usd += result.usd;
    tokens += result.tokens;
    ms += result.ms ?? 0;
    onSent?.(key, result);
    scores[key] = ablationScores(result.answers, presetId);
  };
  try {
    await read(text, '', 'base');
    await read(text, ALL_IN, 'control');
    for (const [i, part] of parts.entries()) await read(parts.filter((_, j) => j !== i).join(''), leftOut(part), `gone:${i}`);
    await read(text, ALL_IN, 'noise');
  } catch (error) {
    if (error.fatal || error.code === 'no_key') throw error;
    // 只交得出 base + control 时一句都算不出；否则把已读到的消融路汇总，剩下的标 false。
    const have = parts.filter((_, i) => scores[`gone:${i}`]).length;
    // 只跑成一部分时 NOISE 还没读到，拿 BASE 顶：它与 CONTROL 同文同措辞，
    // 两者之差是 0——门槛会被判成「每句都拉得开」，所以这里把 readable 压回 false。
    if (scores.base && scores.control && have) {
      const done = parts.slice(0, have);
      const stats = ablationStats(done, { base: scores.base, control: scores.control, noise: scores.base, gone: done.map((_, i) => scores[`gone:${i}`]) });
      // 没有 NOISE 就没有门槛，readable 全部压回 false——宁可说读不出，不说读得开。
      return { ...stats, sentences: stats.sentences.map((one) => ({ ...one, readable: false })), settled: false, usd, tokens, ms, requests, groups: groups.length };
    }
    return { sentences: [], noise: 0, worded: 0, settled: false, usd, tokens, ms, requests, groups: groups.length, error: error?.message ?? 'ablation failed' };
  }
  const stats = ablationStats(parts, { base: scores.base, control: scores.control, noise: scores.noise, gone: parts.map((_, i) => scores[`gone:${i}`]) });
  return { ...stats, settled: true, usd, tokens, ms, requests, groups: groups.length };
}