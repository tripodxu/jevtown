// 假 Jev：不需要 key 的确定性替身，让整个小镇在本地离线可跑、测试不花钱。
// 思路来自上游的 test/fake-jev.js（MIT），但答案由文本特征 + 人格属性计算而来，
// 所以 mock 模式下的小镇也有真实的样貌：对口兴趣的人会停下，广告腔会被划走。
// 用法：const ask = createMockAsk(); const { answers } = await ask(request);

import { persona } from './personas.js';
import { INTEREST, TEMPER } from './vocab.js';
import { PRESETS, ASKS, CANT_TELL } from './presets.js';
import { unit } from './rng.js';

/** 请求种类，按它的问题形状判断（与上游 fake-jev.js 的 kindOf 同一思路）。 */
export function mockKindOf({ questions }) {
  const first = Object.values(questions)[0];
  if (first.type === 'score') return 'opening';
  if ('negotiable' in first.criteria || 'p0' in first.criteria) return 'follow-up';
  if (Object.values(ASKS).some(({ ask }) => first.instructions.endsWith(ask))) return 'closing';
  return 'wave';
}

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** 文本的"卖相"：有具体内容、有数字、有行动词的文本更容易让人停下。0..1 */
function quality(text) {
  let q = 0.25;
  if (text.length >= 40) q += 0.2;
  if (/\d/.test(text)) q += 0.2;
  if (/[！!？?]/.test(text)) q += 0.1;
  if (/(联系|私信|下单|点击|回复|来拿|低价|包邮|转)/.test(text)) q += 0.15;
  return clamp01(q);
}

/** 文本是否点名了某个兴趣（中文或英文标签都算）。 */
function mentionsInterest(text, interestId) {
  const item = INTEREST[interestId];
  return Boolean(item) && (text.includes(item.zh) || text.toLowerCase().includes(item.en.toLowerCase()));
}

const INSULT = /(傻逼|傻B|滚蛋|废物|去死|脑残|垃圾人)/;
const GIBBERISH = /^[\s\w]{1,6}$/;

/** opening 请求的一个答案：score 0..4 / noul 0..1。 */
function mockOpeningAnswer(text, id, question) {
  if (id.startsWith('unlisted:')) {
    const reason = id.slice('unlisted:'.length);
    if (reason === 'insult') return { noul: INSULT.test(text) ? 0.95 : 0.02 };
    if (reason === 'gibberish') return { noul: GIBBERISH.test(text.trim()) ? 0.9 : 0.02 };
    return { noul: 0.02 };
  }
  if (id.startsWith('check:')) {
    const check = id.slice('check:'.length);
    if (check === 'concrete') return { noul: /\d/.test(text) ? 0.9 : 0.25 };
    if (check === 'point_first') return { noul: /^(出|售|转|卖|转让|自用)/.test(text.trim()) ? 0.85 : 0.3 };
    if (check === 'ask') return { noul: /(联系|私信|下单|点击|回复|评论区|快递|自提|包邮)/.test(text) ? 0.85 : 0.3 };
    return { noul: 0.4 };
  }
  // 传播算法的 score 问题：<属性>:<值>
  const [attribute, value] = id.split(':');
  if (attribute === 'interest') {
    if (mentionsInterest(text, value)) return { score: 3 + (text.length < 120 ? 1 : 0) };
    return { score: Math.floor(unit('mock-score', text, id) * 2.4) };
  }
  if (attribute === 'age') return { score: Math.floor(unit('mock-age', text, id) * 2.2) };
  return { score: Math.floor(unit('mock-attr', text, id) * 1.6) };
}

/**
 * wave 请求里一个人格的反应概率：对口兴趣、文本卖相、性格共同决定。
 * 返回 { 反应id: 概率 }，形状与 Jev 的 answers 一致。
 */
function mockReactionProbabilities(presetId, text, who) {
  const preset = PRESETS[presetId];
  const q = quality(text);
  const match = who.interests.some((id) => mentionsInterest(text, id)) ? 1 : 0;
  const temper = TEMPER[who.temper].id;
  const noise = (unit('mock-wave', text, who.id) - 0.5) * 0.16;

  // 停下来的倾向：文本卖相 + 兴趣对口 + 性格
  let engage = 0.18 + 0.42 * q + 0.34 * match + noise;
  if (temper === 'lurker') engage -= 0.22;
  if (temper === 'enthusiast') engage += 0.12;
  if (temper === 'supporter') engage += 0.08;
  if (temper === 'skeptic') engage -= 0.1;
  if (temper === 'troll') engage += 0.04;
  engage = clamp01(engage);

  const dist = {};
  if (presetId === 'post') {
    dist.scrolled_past = 1 - engage;
    dist.read = engage * 0.34;
    dist.liked = engage * 0.3;
    dist.reposted = engage * 0.14;
    dist.followed = engage * 0.1;
    dist.disliked = engage * (temper === 'troll' ? 0.3 : 0.09);
    dist.blocked = engage * (temper === 'troll' ? 0.06 : 0.02);
  } else if (presetId === 'listing') {
    dist.scrolled_past = 1 - engage;
    dist.opened = engage * 0.4;
    dist.saved = engage * 0.16;
    dist.wrote = engage * ((q > 0.6 ? 0.34 : 0.16) + (temper === 'bargain_hunter' ? 0.1 : 0));
    dist.scam = engage * (temper === 'skeptic' ? 0.22 : 0.08);
  } else if (presetId === 'product') {
    dist.scrolled_past = 1 - engage;
    dist.looked = engage * 0.5;
    dist.cart = engage * 0.3;
    dist.bought = engage * 0.2;
  } else {
    dist.scrolled_past = 1 - engage;
    dist.glanced = engage * 0.5;
    dist.clicked = engage * (q > 0.6 ? 0.4 : 0.2);
    dist.annoyed = engage * (temper === 'nitpicker' ? 0.25 : 0.1);
  }
  // 归一化，避免浮点误差让概率总和偏离 1。
  const total = Object.values(dist).reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(Object.entries(dist).map(([id, value]) => [id, value / total]));
}

/** 和 Jev 一样形状的假回答：async (request) → { answers, tokens, usd }。 */
export function createMockAsk() {
  return async function mockAsk(request) {
    const { state, questions } = request;
    const presetId = Object.keys(PRESETS).find((id) => PRESETS[id].noun in state);
    const text = String(state[PRESETS[presetId]?.noun] ?? '');
    const kind = mockKindOf(request);
    const answers = {};
    for (const [id, question] of Object.entries(questions)) {
      if (kind === 'opening') {
        answers[id] = mockOpeningAnswer(text, id, question);
      } else if (kind === 'wave') {
        const personaId = Number(id.slice(1));
        const who = persona('zh', personaId);
        answers[id] = { probabilities: mockReactionProbabilities(presetId, text, who) };
      } else if (kind === 'follow-up') {
        // 闲置：最常问的是砍价和成色；商品：多数人看到价格就放下。
        if ('negotiable' in question.criteria) {
          answers[id] = { probabilities: { available: 0.3, negotiable: 0.34, condition: 0.2, defects: 0.1, photos: 0.06, nothing: 0.0 } };
        } else {
          // 商品价格阶梯：p0 = 哪档都不买，p1..pn = 愿付的最高档；档数由题面决定，动态分摊。
          const steps = Object.keys(question.criteria).filter((key) => /^p\d+$/.test(key) && key !== 'p0');
          const probabilities = { p0: 0.46 };
          const share = 0.54 / Math.max(1, steps.length);
          for (const step of steps) probabilities[step] = share;
          answers[id] = { probabilities };
        }
      } else {
        // 收尾提问：答案列表因人而异，取前两个真实答案按 0.6/0.3 分配，一成给 cant_tell。
        const real = Object.keys(question.criteria).filter((answer) => answer !== CANT_TELL);
        const first = real[0];
        const second = real[1];
        answers[id] = second
          ? { probabilities: { [first]: 0.6, [second]: 0.3, [CANT_TELL]: 0.1 } }
          : { probabilities: { [first]: 0.9, [CANT_TELL]: 0.1 } };
      }
    }
    // 输入 token 按问题数估算；mock 不花钱。ms 是模拟的模型耗时（让调用报告在 mock 下也有形状）。
    const count = Object.keys(questions).length;
    const tokens = count * 45 + 60;
    const ms = 45 + count * 6 + Math.floor(unit('mock-ms', count, text.length % 97) * 140);
    return { answers, tokens, usd: 0, ms };
  };
}
