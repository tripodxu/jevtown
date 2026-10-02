// 一次性探针（scripts/ 是 CLI，console.log 豁免 lint）：R37 头号教训的回归检查。
//
// `exposure` 是 Jev 开局那份预测，也是第 1 波唯一排序依据。它对每人累加的是
// `WEIGHT_OF_PART × score³`，所以两条不变量必须同时成立：
//   1. 权重不等：shopping 是 age/budget 的 2.5 倍、interest/field 的 1.5 倍。
//      权重写错（比如把 1.5 写成 1.0）在单组上完全看不出来——那 0.2×score³ 要等
//      分数够高、且那一组能进 top-N 时才现形，单档实测根本发现不了。
//   2. 立方必须真的在用：score=0.4 时立方占 0.064，线性占 0.4。线性的话
//      整张表会被中低分人群压死，档 1 和档 10 的差距会塌掉。
//
// 为什么这个检查在仓库里而不是只写在 MEMORY.md 里：上一轮我改 MEMORY.md 时把
// `$l[7..11]` 当成「文件中段」写回去了，实际是「第 8 到 12 行」，1,170 行历史只剩 84 行。
// 数值不变量不该只活在记忆日志里——它得有一条能跑的断言。
// 复现：`node scripts/probe-weight-invariant.js`
import assert from 'node:assert/strict';
import { exposure, firstWave, exposureAll, exposureBands } from '../public/shared/feed.js';
import { crowd } from '../public/shared/personas.js';
import { groupsOf } from '../public/shared/requests.js';
import { PRESETS } from '../public/shared/presets.js';
import { rng, hash32 } from '../public/shared/rng.js';

// 人格字段名照抄 `personas.js crowd()` 的真结构：ageGroup 是 id（a18/a25/…，不是「25-34」），
// 购物是 `shopping`（不是 shop），城市没有 tier 字段。
// 这就是为什么测试查询不能凭中文直觉写——AGE_GROUP.zh 是「25-34 岁」，id 是 a25。
const who = {
  pool: 'zh',
  id: 1,
  x: 10,
  y: 20,
  name: 'probe',
  gender: 'f',
  age: 30,
  ageGroup: 'a25',
  city: { en: 'Beijing', zh: '北京' },
  job: 'engineer',
  field: 'it',
  interests: ['photography', 'gaming'],
  temper: 'lurker',
  budget: 'tight',
  spending: 'often',
  shopping: 'phone',
};

const one = (id, score) => ({ [id]: score });

// 1. 权重比：只让一个维度非零，其余维度分 0，逐组比即可消去其他权重。
//    **权重是整体进三次方里的**（cubeTable: `(weights[i] * scores[ids[i]]) ** 3`），
//    所以单维读数是 (w × score)³，不是 w × score³。判断顺序时要按 (w × score)³ 比，
//    不是按 w 比——score=0.9 时 age(0.6) 的读数 0.157 比 interest(1) 的 0.729 低，
//    但那是立方造成的，不是权重表错了。
const cases = [
  ['interest', 'interest:photography', 0.9],
  ['field', 'field:it', 0.9],
  ['age', 'age:a25', 0.9],
  ['shopping', 'shopping:phone', 0.9],
  ['budget', 'budget:tight', 0.9],
];
const got = {};
for (const [name, id, score] of cases) got[name] = exposure(who, one(id, score), 'listing');

// 权重是整体进三次方的：读数必须精确等于 (w × score)³。这一条把五个维度一次钉死，
// 权重表和「立方包住权重还是权重包住立方」两个疑问都不留余地。
const expected = { interest: 1, field: 1, age: 0.6, shopping: 1.5, budget: 0.6 };
for (const [name, id, score] of cases) {
  const want = (expected[name] * score) ** 3;
  assert.ok(
    Math.abs(got[name] - want) < 1e-9,
    `${name} 单维度读数应等于 (${expected[name]} × ${score})³ = ${want.toFixed(9)}，实测 ${got[name]}`,
  );
  console.log(`${name.padEnd(9)} exposure ${got[name].toFixed(6)} · 期望 (${expected[name]} × ${score})³ = ${want.toFixed(6)}`);
}

// 2. 立方：同一维度内，比较低分与高分的行为。
//    score=0.5 → 0.125；score=0.9 → 0.729。
const half = exposure(who, one('interest:photography', 0.5), 'listing');
const high = exposure(who, one('interest:photography', 0.9), 'listing');
assert.ok(Math.abs(high / half - 0.729 / 0.125) < 1e-9, `0.9/0.5 的比应是 0.729/0.125=${(0.729 / 0.125).toFixed(4)}，实测 ${(high / half).toFixed(4)}`);
assert.ok(Math.abs(half - 1 * 0.125) < 1e-9, `score=0.5 单维度应是 0.125，实测 ${half}`);
assert.ok(Math.abs(high - 1 * 0.729) < 1e-9, `score=0.9 单维度应是 0.729，实测 ${high}`);
console.log(`立方      0.5→${half.toFixed(6)} · 0.9→${high.toFixed(6)} · 比 ${(high / half).toFixed(4)}（期望 5.8320）`);

// 3. 维度不相交：market 预设才有 shopping/budget，非 market 预设必须查不到。
const marketIds = groupsOf(true).map(([id]) => id);
const plainIds = groupsOf(false).map(([id]) => id);
assert.ok(marketIds.length === 83, `market 应有 83 组，实测 ${marketIds.length}`);
assert.ok(plainIds.length === 60, `非 market 应有 60 组，实测 ${plainIds.length}`);
for (const id of ['shopping:phone', 'budget:tight']) {
  assert.ok(marketIds.includes(id), `market 缺 ${id}`);
  assert.ok(!plainIds.includes(id), `非 market 不该有 ${id}`);
}
console.log(`维度表    market ${marketIds.length} 组（40 interest + 15 field + 5 age + 18 shopping + 4 budget）· 非 market ${plainIds.length} 组`);

// 4. 立方带来的排序后果：第 1 波 600 人里，只有 500 人是照 exposure 排的，
//    另外 100 人是 `WAVES[0].random` 随机塞进来的（R37 顺手发现、这一轮没接的那件事）。
//    所以落在 exposure 前 1100 的人数期望是 500 + 100×(1100/10000) ≈ 511，抖动几个是正常的。
const people = crowd('zh');
const scores = {};
marketIds.forEach((id, i) => { scores[id] = (i * 0.113) % 1; });
const flat = exposureAll(people, scores, 'listing');
const order = [...flat.keys()].sort((a, b) => flat[b] - flat[a]);
const wave = firstWave(people, scores, 'listing', rng(hash32('weight-invariant')));
const inWave = new Set(wave.map((one2) => one2.id));
const head = order.slice(0, 1100);
const overlap = head.filter((id) => inWave.has(id)).length;
assert.ok(
  overlap >= 490 && overlap <= 540,
  `第 1 波应约 500 人来自 exposure 排序 + 约 11 人来自随机尾巴，实测 ${overlap}/600`,
);
console.log(`排序后果  第 1 波 600 人中 ${overlap} 人落在 exposure 前 1100（500 排序 + 100 随机尾巴）`);

// 5. exposureBands 在同一批分数上必须与 exposureAll 同源（档 1 的 low 不低于中位数）。
const keys = Object.keys(PRESETS.listing.reactions);
const bytes = new Uint8Array(people.length);
const out = exposureBands('listing', keys, scores, bytes, people);
assert.equal(out.bands.length, 10);
assert.ok(out.bands[0].low >= out.bands[4].low, '档 1 的下界不能低于中位档');
assert.equal(out.bands[0].band, 1);
assert.equal(out.bands[9].band, 10);
console.log(`对账表    档 1 ${out.bands[0].low.toFixed(3)}–${out.bands[0].high.toFixed(3)} · 档 10 ${out.bands[9].low.toFixed(3)}–${out.bands[9].high.toFixed(3)}`);

// **`(weight × score)³`，不是 `weight × score³`。** 权重整体进三次方里，所以
// 单维读数精确等于 (w × score)³。这条比「权重比等于多少」更狠：它一次把权重表和
// 「立方包住权重还是权重包住立方」两个疑问都钉死，改错任何一边都会红。
console.log('\n权重表与立方全部对上：每个维度单开时读数精确等于 (权重 × 分数)³。');