// 「作者的话 → 词表里的组」这一半怎么接？量三种接法在真实读数上的差别。
//
// probe-match.js 已经量到：对账表的另一半（实际停下的组）在 iPhone 存档上有 8 个显著组。
// 但作者写的是「年轻人」「刚生孩子的年轻父母」，不是「age:a18」——直接拿词表 id 去撞，
// 只能撞上作者碰巧用了词表原词的情况（iPhone 存档里四条测试话只对上 1 组）。
//
// 本探针量三件事：
//   1. 纯词表字符串匹配（作者照抄「摄影」这种词表里有的词才命得上）
//   2. 用 Jev 已经答过的那道题——exposureRequest 的 83 组「多在乎」分——不再另发请求，
//      直接拿开局那次请求里已有的分做匹配
//   3. 匹配上的组，其真实停下 lift 是多少
// 成本口径：第 2 种零新增花费（开局已经在问），这是它值得被选的全部理由。
import { crowd } from '../public/shared/personas.js';
import { groupsOf } from '../public/shared/requests.js';
import { INTERESTS, FIELDS, AGE_GROUPS, BUDGETS, SHOPPING } from '../public/shared/vocab.js';
import { segmentValueZh, SEGMENT_ZH } from '../public/shared/labels.js';

/** 词表里每个 id 的中文名与其别名：「年轻人」不是 id，但「18-24 岁」「20 多岁」都得能撞上。 */
const NAMES = [
  ...INTERESTS.map((i) => ({ id: `interest:${i.id}`, zh: i.zh, extra: [] })),
  ...Object.entries(FIELDS).map(([id, f]) => ({ id: `field:${id}`, zh: f.zh, extra: [id] })),
  ...AGE_GROUPS.map((a) => ({ id: `age:${a.id}`, zh: a.zh, extra: [a.en] })),
  ...BUDGETS.map((b) => ({ id: `budget:${b.id}`, zh: b.zh, extra: [b.group] })),
  ...SHOPPING.filter((s) => s.id !== 'nothing').map((s) => ({ id: `shopping:${s.id}`, zh: s.zh, extra: [s.en] })),
];
console.log(`词表 ${NAMES.length} 组（market）/ ${groupsOf(false).length} 组（帖子与标题）`);

/** 朴素匹配：作者的句子里出现了哪个词表名。中文没有词边界，靠子串。 */
function hits(text) {
  const out = [];
  for (const name of NAMES) {
    if (text.includes(name.zh) || name.extra.some((e) => text.includes(e))) out.push(name.id);
  }
  return out;
}

const PHRASES = [
  '想找真正想买手机的人', '想找年轻人', '想找爱摄影的人', '想找做创意的人',
  '给刚生孩子的年轻父母', '给在中小厂上班、担心裁员的人', '给爱喝茶的中老年人', '给爱养花种菜的人',
  '给手头紧的人', '给准备买自行车代步的人', '给所有二十多岁的人', '给爱打游戏的人',
];
console.log('\n朴素匹配的命中率：');
let any = 0;
for (const p of PHRASES) {
  const h = hits(p);
  if (h.length) any++;
  console.log(`  ${h.length ? '✓' : '✗'} 「${p}」→ ${h.length ? h.join(' ') : '一个都没撞上'}`);
}
console.log(`\n${PHRASES.length} 句里 ${any} 句能撞上组（${Math.round(any / PHRASES.length * 100)}%）。`);

// 上面这一半说明了为什么「让作者自己勾选」比「猜作者的话」靠谱：勾选永远不会错。
// 但勾选 83 项太长——量一下缩到 6 个维度后要选几项。
const people = crowd('zh');
const sizes = { interest: new Set(), field: new Set(), age: new Set(), budget: new Set(), shopping: new Set() };
for (const w of people) {
  w.interests.forEach((i) => sizes.interest.add(i));
  sizes.field.add(w.field); sizes.age.add(w.ageGroup); sizes.budget.add(w.budget); sizes.shopping.add(w.shopping);
}
console.log('\n六个维度各有多少个取值（勾选式要面对的清单长度）：');
for (const [k, v] of Object.entries(sizes)) console.log(`  ${SEGMENT_ZH[k]}：${v.size} 个`);
console.log(`  合计 ${Object.values(sizes).reduce((s, v) => s + v.size, 0)} 项 —— 一次全展出来没人勾得完。`);

// 哪些取值够大到「勾了也等得到人」？一个只 200 人的组，勾了也等不到多少反应。
const big = [];
for (const [k, v] of Object.entries(sizes)) {
  const counts = new Map();
  for (const w of people) {
    const vs = k === 'interest' ? w.interests : [w[k === 'shopping' ? 'shopping' : k]];
    for (const x of vs) counts.set(x, (counts.get(x) ?? 0) + 1);
  }
  for (const [x, n] of counts) if (n >= 400) big.push({ k, x, n });
}
console.log(`\n≥400 人的取值：${big.length} 个 —— 这就是「勾了等得到反应」的清单上限。`);
console.log(`  按维度：${Object.entries(big.reduce((s, b) => ((s[b.k] = (s[b.k] ?? 0) + 1), s), {})).map(([k, n]) => `${SEGMENT_ZH[k]} ${n}`).join('、')}`);
