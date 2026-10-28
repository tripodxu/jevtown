// DOM 小工具：渲染层到处都要用的两个一行函数。
// 此前 esc 在 render.js 与 charts.js 各存一份同实现（改一处漏一处），
// $ 则是每个模块各自重写一遍——这里收成唯一一份。

/** 按 id 取元素：本页所有脚本都在 body 末尾以模块方式加载，取得到。 */
export const $ = (id) => document.getElementById(id);

/** HTML 转义：把任意文本（人格档案、作者原话、报错串）拼进 innerHTML 前的唯一一道闸。 */
export const esc = (value) => String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/** 一枚统计数字（等宽大字 + 灰小标签）：实时监控与报告的总览共用同一枚。 */
export const stat = (value, label) =>
  `<div class="stat"><b>${typeof value === 'number' ? value.toLocaleString() : value}</b><span>${label}</span></div>`;
