// 「这段话是给谁的」的对账：作者挑的组 vs 实际停下的组。
//
// 基数据只用真实存档 public/examples/iphone-listing-v1.json 里 Jev 真的判出来的 10 000 个字节。
// 不用假字节：假反应会让每个组的 lift 都趋近 1，topSegments 恒返回空（scripts/probe-match.js 记着
// 那一版就是这么白跑一遍才得出「0 个显著组」）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { crowd } from '../public/shared/personas.js';
import {
  segments, topSegments, minSegment, SEGMENT_DIMS, pickableGroups, reconcileAudience, filterGroups, pickLabelZh,
} from '../public/shared/summary.js';
import { AUDIENCE_ZH, AUDIENCE_STATE_ZH, audienceSayZh } from '../public/shared/labels.js';
import { audienceView } from '../public/render.js';
import { PRESETS } from '../public/shared/presets.js';

const raw = JSON.parse(fs.readFileSync(new URL('../public/examples/iphone-listing-v1.json', import.meta.url), 'utf8'));
const presetId = raw.presetId ?? 'listing';
const keys = raw.keys ?? Object.keys(PRESETS[presetId].reactions);
const people = crowd(raw.pool ?? 'zh');
const bytes = Uint8Array.from(raw.reactions);
const all = segments(presetId, keys, bytes, people);

test('清单：七维全在，一个都不许漏（spec 的风险一节）', () => {
  assert.deepEqual([...SEGMENT_DIMS], ['interest', 'field', 'age', 'temper', 'budget', 'shopping', 'city']);
  const dims = new Set(pickableGroups(people).map((one) => one.id.split(':')[0]));
  for (const dim of SEGMENT_DIMS) assert.ok(dims.has(dim), `清单漏了 ${dim} 这一维`);
});

test('清单：115 项、每项是 attribute:value 且能在 segments() 里查到', () => {
  const list = pickableGroups(people);
  assert.equal(list.length, 115);
  const found = new Set(all.map((s) => `${s.attribute}:${s.value}`));
  for (const one of list) assert.ok(found.has(one.id), `${one.id} 不在 segments() 的输出里，查不到就永远对不上账`);
});

test('清单：城市项用中文名（personas 里 city 是 {en, zh} 对象，segments() 取 zh）', () => {
  const cities = pickableGroups(people).filter((one) => one.id.startsWith('city:'));
  assert.equal(cities.length, 24);
  assert.ok(cities.every((one) => /^[一-龥]+$/.test(one.value)), '城市项必须是中文名，不是 en');
});

test('清单：中文标签单点，表单与报告共用一个写法', () => {
  const phone = pickableGroups(people).find((one) => one.id === 'shopping:phone');
  assert.equal(pickLabelZh(phone), '想买：手机');
  assert.equal(pickLabelZh(pickableGroups(people).find((one) => one.id.startsWith('city:'))).startsWith('城市：'), true);
});

test('对账：挑的 ∧ 显著 = hit；挑的 ∧ 不显著 = miss', () => {
  const view = reconcileAudience(all, ['shopping:phone', 'age:a25', 'interest:gardening'], { presetId });
  const at = (state, id) => view.rows.find((row) => row.id === id && row.state === state);
  assert.ok(at('hit', 'shopping:phone'), '手机是 16.81× 的显著组，挑了它就该对上');
  assert.ok(at('hit', 'age:a25'), '25–34 岁 lift 1.76×，挑了它就该对上');
  // 养花组在真实数据里 lift < 1.3
  const gardening = all.find((s) => s.attribute === 'interest' && s.value === 'gardening');
  assert.ok(gardening && gardening.stoppedLift < 1.3, '前提变了：养花组现在显著了，测试要改');
  assert.ok(at('miss', 'interest:gardening'), '挑了但不显著的组要进「没等到」');
});

test('对账：没挑的显著组进 unsaid，且不因为不在清单里就被丢掉', () => {
  const view = reconcileAudience(all, ['shopping:phone'], { presetId });
  const said = view.rows.filter((row) => row.state === 'unsaid');
  const stopped = topSegments(all, 'stopped', 8).filter((s) => s.attribute !== 'shopping' || s.value !== 'phone');
  for (const seg of stopped) {
    assert.ok(said.some((row) => row.id === `${seg.attribute}:${seg.value}`), `${seg.attribute}:${seg.value} 漏了`);
  }
  assert.ok(said.length >= 6);
});

test('对账：cold 只收 size ≥ 400 的，且按 lift 降序、最多 8 行', () => {
  const view = reconcileAudience(all, [], { presetId });
  const cold = view.rows.filter((row) => row.state === 'cold');
  assert.ok(cold.length > 0 && cold.length <= 8);
  assert.ok(cold.every((row) => row.size >= 400), `出现了 ${cold.length - cold.filter((r) => r.size >= 400).length} 个小组`);
  const lifts = cold.map((row) => row.lift);
  assert.deepEqual(lifts, [...lifts].sort((a, b) => b - a));
});

test('对账：一个组都不挑时，没有 hit/miss，表头说的是「你没挑组」', () => {
  const view = reconcileAudience(all, [], { presetId });
  assert.equal(view.rows.filter((row) => row.state === 'hit' || row.state === 'miss').length, 0);
  assert.equal(view.pickedCount, 0);
  assert.equal(view.readable, true);
  assert.equal(audienceSayZh(view), '你没挑组：这一节在说你写的话引来了谁');
});

test('对账：挑的组里有显著的，表头数出「几组里几组」', () => {
  const view = reconcileAudience(all, ['shopping:phone', 'age:a25', 'interest:gardening'], { presetId });
  assert.equal(view.pickedCount, 3);
  assert.equal(view.hitCount, 2);
  assert.equal(audienceSayZh(view), '你说的 3 组里有 2 组真停下来了');
});

test('对账：挑的组零显著时，表头说清「实际停下来的是你没挑的」', () => {
  const view = reconcileAudience(all, ['interest:gardening'], { presetId });
  assert.equal(audienceSayZh(view), '你挑的 1 组一个都没显著停下来，实际停下来的是你没挑的');
});

test('对账：挑到不存在的组时不算数，也不让它把结论说歪', () => {
  const view = reconcileAudience(all, ['interest:gardening', 'nosuch:zzz', 'shopping:phone', 'shopping:phone'], { presetId });
  assert.equal(view.pickedCount, 2, '重复的 shopping:phone 只算一次，不认识的 id 不算');
  assert.equal(view.hitCount, 1);
  assert.equal(audienceSayZh(view), '你说的 2 组里有 1 组真停下来了');
});

test('对账：segments() 什么都没收上来时表头说「还没读出人群分布」而不是空表', () => {
  const view = reconcileAudience([], ['shopping:phone'], { presetId });
  assert.deepEqual(view.rows, []);
  assert.equal(view.readable, false);
  assert.equal(audienceSayZh(view), '这次一个组都没读出来，还对不了账');
});

test('对账：作者挑的组按他挑的顺序排在最前（他挑的第一组就该是第一行）', () => {
  const view = reconcileAudience(all, ['interest:gardening', 'shopping:phone'], { presetId });
  assert.deepEqual(view.rows.slice(0, 2).map((row) => row.id), ['interest:gardening', 'shopping:phone']);
});

test('对账：picked 不是数组（存档被手改过）时不炸，按一个都没挑算', () => {
  const view = reconcileAudience(all, 'shopping:phone', { presetId });
  assert.equal(view.pickedCount, 0);
  assert.equal(audienceSayZh(view), '你没挑组：这一节在说你写的话引来了谁');
});

// -- 文案表 --------------------------------------------------------------------

test('文案：四个状态各有中文，结论句由标签表给出而不是渲染层拼', () => {
  assert.deepEqual(Object.keys(AUDIENCE_STATE_ZH), ['hit', 'miss', 'unsaid', 'cold']);
  assert.deepEqual(Object.values(AUDIENCE_STATE_ZH), ['对上了', '没等到', '没说的', '两边都冷']);
  assert.equal(audienceSayZh({ pickedCount: 3, hitCount: 2, rows: [], readable: true }), AUDIENCE_ZH.hit.replace('%1', '3').replace('%2', '2'));
  assert.equal(audienceSayZh({ pickedCount: 1, hitCount: 0, rows: [], readable: true }), AUDIENCE_ZH.miss.replace('%1', '1'));
  assert.equal(audienceSayZh({ pickedCount: 0, hitCount: 0, rows: [], readable: true }), AUDIENCE_ZH.none);
  assert.equal(audienceSayZh({ pickedCount: 3, hitCount: 2, rows: [], readable: false }), AUDIENCE_ZH.nothing);
});

test('文案：表头与表单提示全在标签表里（AGENTS.md：界面文案单点）', () => {
  for (const key of ['title', 'saidLabel', 'pickLabel', 'filterLabel', 'hint', 'coldNote', 'notFound', 'more', 'pickedCount', 'picked', 'dropped']) {
    assert.ok(typeof AUDIENCE_ZH[key] === 'string' && AUDIENCE_ZH[key].length > 0, `AUDIENCE_ZH.${key} 缺`);
  }
});

test('清单过滤：一两个字母按词首找，别让「a」把全库都撞出来（R36）', () => {
  const list = pickableGroups(people);
  const hay = (one) => `${one.zh} ${one.id} ${one.value}`.toLowerCase();
  // 全子串时 'ai' 会同时命中 anime 与 ai_tools，作者想找 AI 工具却先看到「动漫」。
  const ai = filterGroups(list, 'ai').list;
  assert.equal(ai.length, 1, `「ai」只该命中 AI 工具，却来了 ${ai.length} 个：${ai.map((h) => h.zh).join(' ')}`);
  assert.equal(ai[0].id, 'interest:ai_tools');
  // 边界匹配不能把真正对得上的挡掉：多词 id 里 'games' / 'anime' / 'phone' 都得能搜到。
  for (const [q, id] of [['games', 'interest:games'], ['anime', 'interest:anime'], ['phone', 'shopping:phone']]) {
    assert.ok(filterGroups(list, q).list.some((h) => h.id === id), `「${q}」没命中 ${id}`);
  }
  // 单字母 'a'：全子串会撞出 47 项里 38 个；按词首只剩以 a 开头的词。
  const flood = list.filter((one) => hay(one).includes('a')).length;
  const a = filterGroups(list, 'a').list;
  assert.ok(a.length < flood, `「a」还是全子串：命中 ${a.length}，而含字母 a 的有 ${flood} 个`);
  assert.ok(a.every((h) => new RegExp('(?<![a-z0-9])a', 'i').test(hay(h))), `「a」给出了没有 a 词首的项：${a.map((h) => h.id).join(' ')}`);
  assert.ok(a.some((h) => h.id === 'interest:ai_tools'), '「a」该命中 AI 工具');
});

// -- 清单过滤 ------------------------------------------------------------------

test('过滤：命中的是中文名而不是 id（「摄影」在中文里，id 写的是 photography）', () => {
  const hits = filterGroups(pickableGroups(people), '摄影').list;
  assert.ok(hits.length > 0, '中文名一个都没命中');
  assert.ok(hits.every((one) => one.zh.includes('摄影')), `命中的中文名里没有「摄影」：${hits.map((h) => h.zh).join(' ')}`);
  assert.ok(hits.some((one) => one.id === 'interest:photography'));
});

test('过滤：输入「岁」只给年龄段（五个年龄段的中文名都带「岁」）', () => {
  const hits = filterGroups(pickableGroups(people), '岁').list;
  assert.equal(hits.length, 5);
  assert.ok(hits.every((one) => one.attribute === 'age'), `混进了别的维度：${hits.map((h) => h.id).join(' ')}`);
});

test('过滤：英文 id 的任一段也认（「phone」→ 想买：手机）', () => {
  assert.ok(filterGroups(pickableGroups(people), 'phone').list.some((one) => one.id === 'shopping:phone'));
});

test('过滤：输入「昆明」只给那个城市；输入 id 本身也认', () => {
  const list = pickableGroups(people);
  assert.deepEqual(filterGroups(list, '昆明').list.map((one) => one.id), ['city:昆明']);
  assert.ok(filterGroups(list, 'shopping:phone').list.some((one) => one.id === 'shopping:phone'));
});

test('过滤：空输入返回空数组（不是全量——115 项一次全展出来没人勾得完）', () => {
  assert.deepEqual(filterGroups(pickableGroups(people), ''), { list: [], total: 0 });
  assert.deepEqual(filterGroups(pickableGroups(people), '   '), { list: [], total: 0 });
});

test('过滤：输入没有对应项时返回空数组，UI 就显示「没找到」而不是空框', () => {
  assert.deepEqual(filterGroups(pickableGroups(people), '外星人').list, []);
});

test('过滤：命中超过 40 项时截断并标出总数（不让一次搜索刷出 115 行）', () => {
  const hits = filterGroups(pickableGroups(people), 'a');
  assert.ok(hits.list.length <= 40);
  assert.ok(hits.total >= hits.list.length);
});

// -- 渲染 ----------------------------------------------------------------------

test('渲染：没有 audience 时整节不渲染（旧存档一字不变）', () => {
  assert.equal(audienceView({ post: { preset: presetId }, segments: { stopped: [] } }), '');
});

test('渲染：四状态各有行，标签与 lift 都在行里', () => {
  const picked = ['shopping:phone', 'interest:gardening'];
  const view = reconcileAudience(all, picked, { presetId });
  const html = audienceView({
    post: { preset: presetId },
    audience: { ...view, said: '给想买手机的人', picked },
  });
  assert.match(html, /<h3>/);
  assert.match(html, /给想买手机的人/);
  for (const zh of Object.values(AUDIENCE_STATE_ZH)) assert.ok(html.includes(zh), `缺 ${zh}`);
  assert.match(html, /16\.81/, 'lift 要在行里');
  assert.match(html, /想买：手机/);
});

test('渲染：说错了 id 时不把作者的话原样吐出去（转义）', () => {
  const picked = ['interest:gardening'];
  const view = reconcileAudience(all, picked, { presetId });
  const html = audienceView({
    post: { preset: presetId },
    audience: { ...view, said: '<script>alert(1)</script>', picked },
  });
  assert.ok(!html.includes('<script>'), '自述必须过 esc');
  assert.ok(html.includes('&lt;script&gt;'));
});

test('渲染：只写自述没挑组时也出这一节（那是一个合法答案）', () => {
  const view = reconcileAudience(all, [], { presetId });
  const html = audienceView({ post: { preset: presetId }, audience: { ...view, said: '给所有人', picked: [] } });
  assert.match(html, /给所有人/);
  assert.match(html, /你没挑组/);
  assert.ok(!html.includes('两边都冷') || html.includes('两边都冷'), '冷组照列');
});

test('渲染：显著组超过 8 个时只列 8 个，并说清还有几个', () => {
  const view = reconcileAudience(all, [], { presetId });
  assert.ok(view.unsaid > 8, `前提变了：真实存档的显著组只有 ${view.unsaid} 个，不再需要截断`);
  const html = audienceView({ post: { preset: presetId }, audience: { ...view, said: '', picked: [] } });
  assert.equal(view.rows.filter((row) => row.state === 'unsaid').length, 8);
  assert.match(html, /还有 5 组/);
});

