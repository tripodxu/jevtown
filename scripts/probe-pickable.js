// 上一版把维度当成 84 项——漏了性格与城市，而真实存档里「城市：昆明」就是显著停下组之一
// （1.56×）。作者挑不到城市，就会为一条他压根没法表达的话背「你没说的」。
// 这一版逐维数 personas 里的真值（含 city.zh 这个对象字段），并给出「挑了也等得到反应」的下限。
import { crowd } from '../public/shared/personas.js';
import { SEGMENT_ZH } from '../public/shared/labels.js';

const people = crowd('zh');
/** 与 summary.js 的 SEGMENTS 一一对应 —— 报告里出现的维度，就是作者能挑的维度。 */
const VALUES_OF = {
  interest: (w) => w.interests,
  field: (w) => [w.field],
  age: (w) => [w.ageGroup],
  temper: (w) => [w.temper],
  budget: (w) => [w.budget],
  shopping: (w) => (w.shopping === 'nothing' ? [] : [w.shopping]),
  city: (w) => [w.city.zh],
};
const PICK_FLOOR = 400; // 挑了也等得到反应的人数下限
let total = 0;
let totalBig = 0;
console.log('维度        取值数  ≥400人  最大人数   最小人数');
for (const [dim, valuesOf] of Object.entries(VALUES_OF)) {
  const counts = new Map();
  for (const w of people) for (const v of valuesOf(w)) counts.set(v, (counts.get(v) ?? 0) + 1);
  const n = counts.size;
  const big = [...counts.values()].filter((c) => c >= PICK_FLOOR).length;
  const sizes = [...counts.values()];
  total += n;
  totalBig += big;
  console.log(`  ${(SEGMENT_ZH[dim] ?? dim).padEnd(8)} ${String(n).padStart(4)} ${String(big).padStart(7)} ${String(Math.max(...sizes)).padStart(9)} ${String(Math.min(...sizes)).padStart(9)}`);
}
console.log(`  ${'合计'.padEnd(8)} ${String(total).padStart(4)} ${String(totalBig).padStart(7)}`);

// city 是 {en, zh}：段 id 用 zh，所以挑列表的 id 必须也是 zh —— 否则挑中的 id 在 segments() 里查不到。
console.log('\ncity 字段是对象，segments() 用的值是 city.zh：');
console.log('  样例：', people[0].city.zh, '/', people[1].city.zh, '/', people[2].city.zh);
console.log('  不同 zh 数：', new Set(people.map((w) => w.city.zh)).size);
const bigCities = new Map();
for (const w of people) bigCities.set(w.city.zh, (bigCities.get(w.city.zh) ?? 0) + 1);
console.log(`  ≥400 人的城市：${[...bigCities.values()].filter((c) => c >= PICK_FLOOR).length} 个`);

// 六个维度若不按人数筛，清单有多长；若筛，多长。
console.log(`\n筛选输入框要面对的全量清单：${total} 项 —— 一次全展出来没人勾得完（这是走输入框过滤的理由）。`);
console.log(`按 ≥${PICK_FLOOR} 人筛过之后：${totalBig} 项 —— 仍然靠输入框过滤，但作者常挑的那几个一定在里面。`);
