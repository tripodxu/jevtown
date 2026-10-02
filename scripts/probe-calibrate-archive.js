// 探针：拿真实存档离线复算 R37 的十档对账表，**一次 Jev 都不调**。
//
// 存档里现在带 scores（`scripts/probe-fixarchive` 用真 Jev 重问补的，两份各约 0.0003 美元），
// 于是 exposure 能从存档重算：真实存档上「Jev 开局押的」兑现成什么样，一行代码即可复核。
//
// 用法：node scripts/probe-calibrate-archive.js [存档路径] [...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crowd } from '../public/shared/personas.js';
import { PRESETS } from '../public/shared/presets.js';
import { exposureBands } from '../public/shared/feed.js';
import { CALIBRATE_ZH, calibrateSayZh } from '../public/shared/labels.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const files = process.argv.slice(2);
const targets = files.length
  ? files
  : ['public/examples/iphone-listing-v1.json', 'public/examples/iphone-listing-v2.json'];

const people = crowd('zh');
const pct = (value) => `${(value * 100).toFixed(1)}%`;

for (const target of targets) {
  const file = path.isAbsolute(target) ? target : path.join(root, target);
  if (!fs.existsSync(file)) {
    console.error(`跳过：${target} 不存在`);
    continue;
  }
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!saved.scores) {
    console.error(`跳过：${target} 没有 scores 字段，exposure 重算不出来（这正是 R37 顺手挖出的那条发现）`);
    continue;
  }
  const keys = saved.keys ?? Object.keys(PRESETS[saved.presetId].reactions);
  const bytes = Uint8Array.from(saved.reactions);
  const out = exposureBands(saved.presetId, keys, saved.scores, bytes, people);

  console.log(`\n=== ${path.basename(file)} · ${saved.presetId} ===`);
  console.log(`文本：${saved.text}`);
  console.log(`结论：${calibrateSayZh(out)}`);
  console.log(`全城 ${out.town.people} 人 · 读到 ${out.town.reached} · 停下 ${out.town.stopped} · 乐见 ${out.town.glad}`);
  console.log(`首档/末档停下率之比 ${out.first.stoppedRatio === null ? '读不出来' : `${out.first.stoppedRatio.toFixed(2)} 倍`}`
    + ` · 乐见率之比 ${out.first.gladRatio === null ? '读不出来' : `${out.first.gladRatio.toFixed(2)} 倍`}`);
  console.log(`读得出 ${out.readable ? '是' : `否（各档要 ${out.minSample} 人以上）`} · 押平 ${out.flat ? '是' : '否'}`);
  console.log('档\texposure 区间\t人数\t读到\t停下率\t乐见率\t相对全城');
  for (const band of out.bands) {
    console.log([
      band.band,
      `${band.low.toFixed(3)}–${band.high.toFixed(3)}`,
      band.people.toLocaleString(),
      band.reached,
      pct(band.stopped / Math.max(1, band.reached)),
      pct(band.glad / Math.max(1, band.reached)),
      `${band.stoppedLift.toFixed(2)}×`,
    ].join('\t'));
  }
  console.log(CALIBRATE_ZH.bandHint);
  console.log(CALIBRATE_ZH.costNote);
}