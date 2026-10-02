// 对账表探针（真实存档版）：拿 public/examples/iphone-listing-v1.json 里 Jev 真的判出来的
// 反应字节，跑一遍 segments + topSegments，看四状态对账表在真实数据上填不填得满。
//
// 上一版用 i*7919%reactions.length 假造反应，得出「0 个显著组」——那是假字节的必然结果：
// 所有组的 lift 趋近 1，没有组能越过 1.3。这一版换成存档里真的那 10 000 个字节。
import fs from 'node:fs';
import { crowd } from '../public/shared/personas.js';
import { segments, topSegments, minSegment } from '../public/shared/summary.js';
import { PRESETS } from '../public/shared/presets.js';
import { SEGMENT_ZH, segmentValueZh } from '../public/shared/labels.js';

const raw = JSON.parse(fs.readFileSync(new URL('../public/examples/iphone-listing-v1.json', import.meta.url), 'utf8'));
const presetId = raw.presetId ?? 'listing';
const keys = Object.keys(PRESETS[presetId].reactions);
const bytes = Uint8Array.from(raw.reactions);
const people = crowd(raw.pool ?? 'zh');
console.log(`存档：${raw.text?.slice(0, 30)}… · ${presetId} · 字节 ${bytes.length} · 非零 ${bytes.filter(Boolean).length}`);

const all = segments(presetId, keys, bytes, people);
const floor = minSegment(bytes.filter(Boolean).length);
console.log(`\n小组门槛 floor = ${floor}（reached × 0.004，上限 40、下限 15）· 段总数 ${all.length}`);
const stopped = topSegments(all, 'stopped', 8);
console.log(`\n实际停下来显著的组：${stopped.length}`);
for (const s of stopped) console.log(`  ${SEGMENT_ZH[s.attribute]}：${segmentValueZh(s.attribute, s.value)}  ${s.stopped}/${s.size}（${Math.round(s.stopped / s.size * 100)}%）lift ${s.stoppedLift.toFixed(2)}×`);

// 这一节要回答的实际问题：作者写一句「我想找的人」，最多能对上几个？
// 现在用「作者提到词表里的中文名」当命中——这是最乐观也最笨的接法，只量表的上限。
const PHRASES = [
  { text: '想找真正想买手机的人', hit: ['shopping:phone'] },
  { text: '想找年轻人', hit: [] },
  { text: '想找爱摄影的人', hit: ['interest:photography'] },
  { text: '想找做创意的人', hit: ['field:creative'] },
];
const idOf = (s) => `${s.attribute}:${s.value}`;
const byId = new Map(all.map((s) => [idOf(s), s]));
console.log('\n对账表上限（假设作者的话精准命中词表）：');
for (const { text, hit } of PHRASES) {
  const named = hit.map((id) => byId.get(id)).filter(Boolean);
  const namedStops = named.reduce((s, x) => s + x.stoppedLift, 0);
  const missed = stopped.filter((s) => !hit.includes(idOf(s)));
  console.log(`  「${text}」→ 点名 ${hit.length} 组（平均 lift ${hit.length ? (namedStops / hit.length).toFixed(2) : '—'}×）· 实际第一是 ${stopped[0] ? segmentValueZh(stopped[0].attribute, stopped[0].value) + ' ' + stopped[0].stoppedLift.toFixed(1) + '×' : '无'} · 漏掉 ${missed.length} 个显著组`);
  if (!hit.length) console.log(`      ↑「年轻人」不是词表里的任何一个 id，作者的话在表里对不上任何行——这就是真产品要解决的那一半。`);
}
console.log(`\n显著组一共 ${stopped.length} 个（全量取 8 档内）——对账表能填满 ${stopped.length} 行，其余的都在「没说的」那一档里沉底。`);
