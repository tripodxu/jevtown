#!/usr/bin/env node
// 生成 public/shared/personas-pack.js：全城人格的预计算包（R19）。
// 动机：isolate 冷启动现场算 1 万人格 ~130ms CPU，免费档单请求 10ms CPU 装不下；
// 解码同量数据 ~20ms。改词表或 personaCompute 后**必须重跑本脚本**——
// test/personas.test.js 的全城对拍用例守护一致性（不重跑 = 红）。
import { writeFileSync } from 'node:fs';
import { personaCompute, CROWD } from '../public/shared/personas.js';
import { JOBS, TEMPERS, BUDGETS, SPENDING, SHOPPING, POOLS, INTERESTS } from '../public/shared/vocab.js';

const indexOfId = (list, id) => list.findIndex((item) => item.id === id);

const pack = {};
for (const pool of Object.keys(POOLS)) {
  const flat = new Array(CROWD * 12);
  for (let id = 0; id < CROWD; id++) {
    const who = personaCompute(pool, id);
    const b = id * 12;
    const names = POOLS[pool][who.gender];
    const slots = [
      names.findIndex(([en]) => en === who.name.en),
      who.age,
      who.gender === 'male' ? 1 : 0,
      POOLS[pool].cities.findIndex(([en]) => en === who.city.en),
      indexOfId(JOBS, who.job),
      indexOfId(INTERESTS, who.interests[0]),
      indexOfId(INTERESTS, who.interests[1]),
      indexOfId(INTERESTS, who.interests[2]),
      indexOfId(TEMPERS, who.temper),
      indexOfId(BUDGETS, who.budget),
      indexOfId(SPENDING, who.spending),
      indexOfId(SHOPPING, who.shopping),
    ];
    slots.forEach((value, offset) => {
      if (value < 0) throw new Error(`pool ${pool} id ${id}：槽 ${offset} 找不到下标（词表缺项？）`);
      flat[b + offset] = value;
    });
  }
  pack[pool] = { flat };
}

const out = `// 生成文件：scripts/pack-personas.mjs（勿手改）。全城人格的预计算包（R19）。
// 解码 ~20ms 替代现场计算 ~130ms；改词表或 personaCompute 后重跑生成脚本，
// test/personas.test.js 的全城对拍守护一致性。
export const PERSONAS_PACK = ${JSON.stringify(pack)};
`;
writeFileSync(new URL('../public/shared/personas-pack.js', import.meta.url), out);
console.log(`已生成 personas-pack.js（${(out.length / 1024).toFixed(0)}KB，${Object.keys(pack).length} 个 pool）`);
