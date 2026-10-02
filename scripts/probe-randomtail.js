// 一次性探针（scripts/ 是 CLI，console.log 豁免 lint）：产品里那条随机尾巴能不能当对照组？
//
// feed.js 的 WAVES 每一条都带一个 random 尾巴：WAVES = [{size:600,random:100},{size:1500,random:150},
// {size:3000,random:300},{size:全城,random:0}]。第 1 波 600 人里，500 人是 exposure 最高的，
// **另外 100 人是从剩下的人里随机塞进来的**——换句话说，产品每一波都自带一个随机对照组，
// 只是从来没人报过它。这是真随机，不是分档这种事后切出来的伪对照。
//
// 问的是：Jev 自己挑的那 500 人，和同一条尾巴上随机跟来的 100 人，停下率差多少？
//
// 用法：node scripts/probe-randomtail.js [--real] --preset listing 存档.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crowd } from '../public/shared/personas.js';
import { openingRequest, openingAnswers } from '../public/shared/requests.js';
import { exposure, firstWave, mood, travels } from '../public/shared/feed.js';
import { pickProvider, ask as askJev } from '../public/shared/jev.js';
import { createMockAsk } from '../public/shared/mock.js';
import { rng, hash32 } from '../public/shared/rng.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(here, '..', '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}
const args = process.argv.slice(2);
const archiveAt = args.findIndex((arg) => arg.endsWith('.json'));
if (archiveAt < 0) {
  console.error('用法：node scripts/probe-randomtail.js [--real] --preset listing 存档.json');
  process.exit(1);
}
const archive = JSON.parse(fs.readFileSync(args[archiveAt], 'utf8'));
const presetId = archive.presetId;
const picked = pickProvider(process.env);
const send = args.includes('--real') && picked ? (request) => askJev(picked, request) : createMockAsk();

const people = crowd(archive.pool ?? 'zh');
const bytes = Uint8Array.from(archive.reactions);
const preset = archive; // reactions 的键在 keys 里，下面用 PRESETS 拿 stopped/tone
const { PRESETS } = await import('../public/shared/presets.js');
const reactionsOf = PRESETS[presetId].reactions;
const keys = archive.keys ?? Object.keys(reactionsOf);
const toneOf = (byte) => (byte ? (reactionsOf[keys[byte - 1]]?.tone ?? 0) : null);
const stoppedOf = (byte) => Boolean(byte && reactionsOf[keys[byte - 1]]?.stopped);

const out = await send(openingRequest(presetId, archive.text));
const scores = openingAnswers(out.answers).scores;
console.log(`\n【${presetId}】${archive.text}`);
console.log(`通道：${args.includes('--real') && picked ? `真实 ${picked.name}` : 'mock'} · $${out.usd.toFixed(4)} · ${Object.keys(scores).length} 组`);

// 存档里的波次名单：reactions 数组第 i 格是 0 就是没到达过，而 plan 存的是每波抽中的人。
// 存档没存名单，所以这里用同种子重算第 1 波，并报告重算与存档的 mood 是否对得上。
const wave1 = firstWave(people, scores, presetId, rng(hash32('waves', archive.pool ?? 'zh', `probe.${hash32(presetId, archive.text)}`)));
const reached1 = wave1.filter((who) => bytes[who.id]);
console.log(`存档 ${archive.waves.length} 波 · 第 1 波重算 ${wave1.length} 人、其中存档里有反应 ${reached1.length} 人`);

const ranked = [...people].sort((a, b) => exposure(b, scores, presetId) - exposure(a, scores, presetId) || a.id - b.id);
const rankOf = new Map(ranked.map((who, at) => [who.id, at]));
const chosen = wave1.filter((who) => rankOf.get(who.id) < 500 && bytes[who.id]);
const tail = wave1.filter((who) => rankOf.get(who.id) >= 500 && bytes[who.id]);
// 第 500 名那个值上可能站着好几个人（切线打平），他们被塞进哪一边都是随机的——数出来。
const cut = exposure(ranked[499], scores, presetId);
const onCut = wave1.filter((who) => Math.abs(exposure(who, scores, presetId) - cut) < 1e-12);
const cutInChosen = onCut.filter((who) => rankOf.get(who.id) < 500).length;

const rate = (rows, test) => `${rows.filter((who) => test(bytes[who.id])).length}/${rows.length}`;
const stop = (who) => stoppedOf(bytes[who.id]);
const glad = (who) => toneOf(bytes[who.id]) === 1;
console.log(`\n随机对照组（每波塞进来的随机尾巴） vs Jev 自己挑的人（第 1 波，存档里有反应的人）`);
console.log(`  Jev 挑的 500 人里到达 ${chosen.length}：停下 ${rate(chosen, stop)}（${(chosen.filter(stop).length / Math.max(1, chosen.length) * 100).toFixed(1)}%）· 乐见 ${rate(chosen, glad)} · 情绪 ${mood(presetId, chosen.map((who) => keys[bytes[who.id] - 1])).toFixed(3)}`);
console.log(`  随机跟来的 ${tail.length} 人：停下 ${rate(tail, stop)}（${(tail.filter(stop).length / Math.max(1, tail.length) * 100).toFixed(1)}%）· 乐见 ${rate(tail, glad)} · 情绪 ${mood(presetId, tail.map((who) => keys[bytes[who.id] - 1])).toFixed(3)}`);
console.log(`  切线打平的人 ${onCut.length} 个，其中落在 Jev 那边的 ${cutInChosen} 个（这些人归属随机，污染上限 ±${Math.abs(cutInChosen - onCut.length / 2)} 人）`);
console.log(`  这条尾巴会不会续传：Jev 挑的那半 ${travels(presetId, chosen.map((who) => keys[bytes[who.id] - 1]))} · 随机那半 ${travels(presetId, tail.map((who) => keys[bytes[who.id] - 1]))}`);
console.log(`  （${preset.usd ? `存档花了 $${archive.usd.toFixed(4)}` : ''}）`);
