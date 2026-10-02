// 对账表的真样张：不是手写的示例，是拿真实存档跑出来的数字。
//
// 设计稿里那张表（4/4 视频 41/287、礼物 3/441 …）是按形状编的，不是算出来的。这里逐行算出来，
// 替换掉它——报告里出现的数必须是真数，哪怕不好看。
import fs from 'node:fs';
import { crowd } from '../public/shared/personas.js';
import { segments, topSegments } from '../public/shared/summary.js';
import { PRESETS } from '../public/shared/presets.js';
import { SEGMENT_ZH, segmentValueZh } from '../public/shared/labels.js';

const raw = JSON.parse(fs.readFileSync(new URL('../public/examples/iphone-listing-v1.json', import.meta.url), 'utf8'));
const presetId = raw.presetId ?? 'listing';
const keys = Object.keys(PRESETS[presetId].reactions);
const all = segments(presetId, keys, Uint8Array.from(raw.reactions), crowd(raw.pool ?? 'zh'));
const idOf = (s) => `${s.attribute}:${s.value}`;

const stopped = topSegments(all, 'stopped', 8);
const stoppedButFlat = all.filter((s) => s.stopped >= 8 && s.stoppedLift < 1.3);
console.log(`段总数 ${all.length}`);
console.log(`停下 ≥8 人的段：${all.filter((s) => s.stopped >= 8).length} 个，其中 lift ≥1.3 显著的 ${stopped.length} 个，lift <1.3 的 ${stoppedButFlat.length} 个`);

// 作者会挑哪几组？这一条示例挑两个：「想买手机的人」和「25–34 岁」。
const PICKED = ['shopping:phone', 'age:a25'];
const byId = new Map(all.map((s) => [idOf(s), s]));
const line = (tag, s) => {
  const share = s.size ? s.stopped / s.size : 0;
  return `  ${tag.padEnd(9)}${`${SEGMENT_ZH[s.attribute]}：${segmentValueZh(s.attribute, s.value)}`.padEnd(22)}${`${s.stopped} / ${s.size}`.padStart(10)}（${String(Math.round(share * 100)).padStart(2)}%）· ${s.stoppedLift.toFixed(2)}×`;
};

console.log('\n作者挑了：' + PICKED.map((id) => `${id}（${byId.get(id) ? SEGMENT_ZH[byId.get(id).attribute] + '：' + segmentValueZh(byId.get(id).attribute, byId.get(id).value) : '组不存在'}）`).join(' + '));
console.log('\n【对上了】挑的 ∧ lift≥1.3');
for (const id of PICKED) {
  const s = byId.get(id);
  if (!s) { console.log(`  ${id} 组不存在`); continue; }
  console.log(line(s.stoppedLift >= 1.3 ? '对上了' : '没等到', s));
}
console.log('\n【没说的】没挑 ∧ lift≥1.3');
for (const s of stopped.filter((s) => !PICKED.includes(idOf(s)))) console.log(line('没说的', s));
console.log('\n【两边都冷】没挑 ∧ lift<1.3 ∧ size≥400');
const cold = all
  .filter((s) => !PICKED.includes(idOf(s)) && s.stoppedLift < 1.3 && s.size >= 400)
  .sort((a, b) => b.stoppedLift - a.stoppedLift)
  .slice(0, 8);
console.log(`  （size≥400 的冷组共 ${all.filter((s) => !PICKED.includes(idOf(s)) && s.stoppedLift < 1.3 && s.size >= 400).length} 个，这里取 lift 最高的 8）`);
for (const s of cold) console.log(line('两边都冷', s));
console.log(`\n表头结论：挑的 2 组里 ${PICKED.filter((id) => byId.get(id)?.stoppedLift >= 1.3).length} 组显著停下。`);
