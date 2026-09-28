// 视图渲染：app.js（实时检查）与 showcase.js（示例回放）共用。
// 输入形状 = GET /api/post/:v 的 payload（replay.js 能从存档 JSON 拼出同一形状）。
import { PRESETS, LOOKS, lookOf } from './shared/presets.js';
import { drawGrid, attachTooltip } from './grid.js';
import {
  REACTIONS_ZH, REASONS_ZH, HOOKS_ZH, COMMENTS_ZH, SEGMENT_ZH, segmentValueZh, CHECKS_ZH, LIST_ZH, FOLLOWUP_LISTING_ZH, reportStageZh, BLOCKED_ZH, presetNoun, TERRAIN_VERDICT_ZH, TERRAIN_SAY_ZH, directionZh,
} from './shared/labels.js';
import { moodLine, demandChart, funnel, reportBars, fmtMs } from './charts.js';
import { rankedAnswers, demandCurve } from './shared/summary.js';
import { decodeBytes } from './shared/bytes.js';

export const PRESET_NOUN = presetNoun;
export const readCheck = (p) => (p >= 0.7 ? 'yes' : p <= 0.3 ? 'no' : 'unclear');
export const esc = (value) => String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const stat = (value, label) => `<div class="stat"><b>${typeof value === 'number' ? value.toLocaleString() : value}</b><span>${label}</span></div>`;
export { stat };

/** 把一页结果渲染进容器 el（卡片本体）。 */
export function renderCheck(el, result) {
  el.hidden = false;
  const presetId = result.post.preset;
  const html = [`<h2>${esc(PRESET_NOUN(presetId))} · 检查结果</h2>`];

  html.push('<div class="blocked-note" style="border-color:var(--line)">');
  html.push(`<div>文本：${esc(result.post.text.slice(0, 80))}${result.post.text.length > 80 ? '…' : ''}</div>`);
  if (result.unlisted?.length) html.push(`<div class="hint">未列入公共流：${esc(result.unlisted.map((id) => BLOCKED_ZH[id] ?? id).join('、'))}</div>`);
  html.push('</div>');

  html.push(overview(result));
  html.push(reportView(result));
  html.push(decisionsView(result));
  html.push(terrainView(result));
  html.push(wavesView(result));
  html.push(countsView(result));
  html.push('<h3>小镇地图</h3><div class="map-bar"><button class="ghost" type="button" data-terrain aria-pressed="false">看聚集地形</button><span class="hint">成片 = 这一片人朝着同一个方向表态；零散 = 各看各的。</span></div><div class="map-wrap"><canvas class="grid" role="img" aria-label="小镇反应地图：一万个格子，每格一个人格的反应（悬停可看详情）"></canvas><div class="legend"></div></div>');
  html.push(jevReading(result));
  html.push(segmentsView(result));
  html.push(saidView(result));
  html.push(followUpView(result));
  html.push(voicesView(result));

  el.innerHTML = html.join('');

  buildToc(el);

  const bytes = decodeBytes(result.looks);
  const canvas = el.querySelector('.grid');
  drawGrid(canvas, bytes, presetId);
  attachTooltip(canvas, bytes, presetId);
  el.querySelector('.legend').innerHTML = reactionLegend(presetId);
  wireTerrain(el, result, canvas, bytes, presetId);
}

/** 结果页小目录：给每个 h3 发 id，顶部生成锚点 pill 行（长报告一跳直达）。 */
function buildToc(el) {
  const headings = [...el.querySelectorAll('h3')];
  headings.forEach((h, i) => { h.id = `sec-${i}`; });
  const nav = document.createElement('nav');
  nav.className = 'toc';
  nav.setAttribute('aria-label', '报告目录');
  nav.innerHTML = headings.map((h, i) => `<a href="#sec-${i}">${esc(h.textContent)}</a>`).join('');
  el.querySelector('h2').after(nav);
}

function overview(result) {
  const c = result.counters;
  return `<h3>总览</h3><div class="stats">` +
    stat(c.reach, 'Jev 逐格判定') +
    stat(c.stopped, '停下来') +
    stat(c.glad, '乐见') +
    stat(c.sorry, '反感') +
    stat(`$${(result.spent?.usd ?? 0).toFixed(3)}`, '本次花费') +
    '</div>';
}

function reportView(result) {
  const report = result.report;
  if (!report?.stages?.length) return '';
  const t = report.totals;
  const provider = report.provider ? `<span class="chip">${esc(report.provider)}</span>` : '';
  return `<h3>Jev 调用报告</h3>
    <div class="stats">
      ${stat(t.requests, '模型请求')}
      ${stat(t.tokens.toLocaleString(), '输入 tokens')}
      ${stat(`$${t.usd.toFixed(4)}`, '花费')}
      ${stat(fmtMs(t.ms), '模型耗时')}
    </div>
    <div class="report-meta">${provider}<span class="hint">分阶段明细（条长 = ${t.usd > 0 ? '花费' : '耗时'}占比）</span></div>
    ${reportBars(report.stages, reportStageZh)}`;
}

function decisionsView(result) {
  const list = result.decisions;
  if (!list?.length) return '';
  const cards = list.map((d) => {
    const entries = Object.entries(d.probabilities).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const max = entries[0]?.[1] ?? 1;
    const bars = entries.map(([reaction, p]) => {
      const isDrawn = reaction === d.reaction;
      return `<div class="seg dseg${isDrawn ? ' drawn' : ''}"><span class="label">${esc(REACTIONS_ZH[reaction] ?? reaction)}</span>` +
        `<span class="bar2"><i style="width:${Math.max(3, Math.round((p / max) * 100))}%;background:${isDrawn ? 'var(--accent)' : 'var(--muted)'}"></i></span>` +
        `<span class="num">p=${p.toFixed(2)}</span></div>`;
    }).join('');
    return `<div class="decision">
      <div class="dline">${esc(d.line)}</div>
      <div class="dask">${esc(d.ask)}</div>
      ${bars}
      <div class="dverdict">Jev 判定：<b>${esc(REACTIONS_ZH[d.reaction] ?? d.reaction)}</b></div>
    </div>`;
  }).join('');
  return `<h3>Jev 的决策现场（真实问句与概率分布 · 抽样 ${list.length} 例）</h3><div class="decisions">${cards}</div>`;
}

/**
 * 人群地形：这次的反应是连成片的还是零散的（shared/spatial.js 的判定）。
 * 判不出来也照样说"看不出"——不藏，并把统计量与置换次数摆出来，让人自己判断。
 */
function terrainView(result) {
  const t = result.terrain;
  if (!t || t.morans === null) return '';
  const verdict = TERRAIN_VERDICT_ZH[t.verdict] ?? t.verdict;
  const z = t.z === null ? '' : `，置换检验 z = ${t.z >= 0 ? '+' : ''}${t.z.toFixed(1)}`;
  const where = [
    t.hot?.length ? `成片的乐见集中在地图${directionZh(t.hotAt)}（${t.hot.length} 格）` : '',
    t.cold?.length ? `成片的反感在${directionZh(t.coldAt)}（${t.cold.length} 格）` : '',
  ].filter(Boolean).join('；');
  // 整张地图的判定与局部成片是两回事：整体"零散"照样可能有中央一小撮人一起叫好，
  // 所以这一句用"不过"另起，不与上面的判定打架。
  const local = where ? `不过${esc(where)}。` : '';
  return `<h3>人群地形</h3><div class="terrain-read">
    <span class="chip ${t.verdict}">${verdict}</span>
    <div class="terrain-say">这次的反应<em>${verdict}</em>。${TERRAIN_SAY_ZH[t.verdict] ?? ''}</div>
    <div class="hint">判定格 ${t.judged.toLocaleString()} · 相邻对 ${t.edges.toLocaleString()} · Moran's I = ${t.morans.toFixed(3)}（把地图随机打乱 ≈ 0，越正越成片、越负越零散${z}）。${local}</div>
  </div>`;
}

function wavesView(result) {
  if (!result.waves?.length) return '';
  const line = moodLine(result.waves.map((w) => w.mood));
  return `<h3>传播波次与情绪轨迹</h3>${funnel(result.waves)}${line}`;
}

function countsView(result) {
  const presetId = result.post.preset;
  const reach = Math.max(1, result.counters.reach);
  const rows = Object.entries(result.counters.byReaction)
    .filter(([, count]) => count)
    .sort((a, b) => b[1] - a[1]);
  const max = rows[0]?.[1] ?? 1;
  const bars = rows.map(([reaction, count]) => {
    const look = lookOf(presetId, reaction);
    const width = Math.max(3, Math.round((count / max) * 100));
    return `<div class="seg"><span class="label">${esc(REACTIONS_ZH[reaction] ?? reaction)}</span>` +
      `<span class="bar2"><i style="width:${width}%;background:${LOOKS[look]}"></i></span>` +
      `<span class="num">${count.toLocaleString()} · ${Math.round((count / reach) * 100)}%</span></div>`;
  });
  return `<h3>反应分布（占到达人数）</h3>${bars.join('')}`;
}

function liftOf(seg, key) {
  const lift = key === 'stopped' ? seg.stoppedLift : key === 'glad' ? seg.gladLift : seg.sorryLift;
  return lift >= 1.05 ? (Math.round(lift * 10) / 10).toFixed(1) : '';
}

function jevReading(result) {
  const ids = Object.keys(result.checks ?? {});
  if (!ids.length) return '';
  const chips = ids.map((id) => {
    const verdict = readCheck(result.checks[id]);
    return `<span class="chip ${verdict}">${esc(CHECKS_ZH[id] ?? id)}：${verdict === 'yes' ? '是' : verdict === 'no' ? '否' : '说不准'}（${result.checks[id]}）</span>`;
  });
  return `<h3>Jev 对文本本身的解读</h3><div class="checks">${chips.join('')}</div>`;
}

function segmentsView(result) {
  const groups = [['stopped', '谁停下了'], ['glad', '谁乐见'], ['sorry', '谁反感']];
  const html = [];
  for (const [key, title] of groups) {
    const list = result.segments?.[key] ?? [];
    if (!list.length) continue;
    html.push(`<h3>${title}（显著高于全城）</h3>`);
    for (const seg of list) {
      const share = seg.size ? seg[key] / seg.size : 0;
      // 条色对齐地图图例的语义色：停下=蓝，乐见=绿，反感=红（--map-* 是全主题不变的数据墨水）。
      const color = key === 'sorry' ? 'var(--map-red)' : key === 'glad' ? 'var(--map-green)' : 'var(--map-blue)';
      html.push(
        `<div class="seg"><span class="label">${esc(SEGMENT_ZH[seg.attribute] ?? seg.attribute)}：${esc(segmentValueZh(seg.attribute, seg.value))}</span>` +
        `<span class="bar2"><i style="width:${Math.round(share * 100)}%;background:${color}"></i></span>` +
        `<span class="num">${seg[key]} / ${seg.size}（${Math.round(share * 100)}%${liftOf(seg, key) ? ` · ${liftOf(seg, key)}×` : ""}）</span></div>`,
      );
    }
  }
  return html.join('');
}

function saidView(result) {
  const said = result.said;
  if (!said?.lists || !Object.keys(said.lists).length) return '';
  const presetId = result.post.preset;
  const html = ['<h3>小镇在说（收尾提问）</h3>'];
  for (const list of ['scrolled', 'sorry', 'hook', 'comment']) {
    const view = said.lists[list];
    if (!view) continue;
    const labels = list === 'hook' ? HOOKS_ZH[presetId] ?? {} : list === 'comment' ? COMMENTS_ZH : REASONS_ZH;
    const rows = Object.entries(view.totals)
      .filter(([id]) => id !== 'cant_tell')
      .sort((a, b) => b[1] - a[1]);
    const total = rows.reduce((sum, [, value]) => sum + value, 0) || 1;
    html.push(`<div class="said-row"><span class="what">${esc(LIST_ZH[list])} · 问了约 ${view.asked} 人：</span> `);
    html.push(rows.slice(0, 3).map(([id, value]) => {
      const picks = said.picks?.[list]?.[id]?.length;
      return `<span class="lead">${esc(labels[id] ?? id)} ${Math.round((value / total) * 100)}%${picks ? `（${picks} 人）` : ''}</span>`;
    }).join('、'));
    html.push('</div>');
  }
  return html.join('');
}

function followUpView(result) {
  const f = result.followUp;
  if (!f || !f.asked) return '';
  const presetId = result.post.preset;
  const html = ['<h3>追问阶段</h3>'];
  if (presetId === 'listing') {
    html.push(`<div class="said-row"><span class="what">问过 ${f.asked} 个停下的人，他们会先问卖家：</span></div>`);
    for (const row of rankedAnswers(f).slice(0, 5)) {
      html.push(`<div class="seg"><span class="label">${esc(FOLLOWUP_LISTING_ZH[row.id] ?? row.text)}</span>` +
        `<span class="bar2"><i style="width:${Math.round(row.share * 100)}%;background:var(--accent)"></i></span>` +
        `<span class="num">${Math.round(row.share * 100)}%</span></div>`);
    }
  } else if (presetId === 'product' && result.prices) {
    const curve = demandCurve(f, result.prices);
    html.push(`<div class="said-row"><span class="what">问过 ${f.asked} 个停下的人，价格阶梯上的买家数（累计）：</span></div>`);
    html.push(demandChart(curve));
    const best = [...curve].sort((a, b) => b.revenue - a.revenue)[0];
    if (best) html.push(`<div class="said-row"><span class="what">收入最高的定价：¥${best.price}（${best.buyers} 人 · ¥${best.revenue.toLocaleString()}）</span></div>`);
  }
  return html.join('');
}

function voicesView(result) {
  if (!result.voices?.length) return '';
  const cards = result.voices.map((voice) =>
    `<div class="voice"><div class="who">${esc(voice.who.name)}，${voice.who.age}岁 · ${esc(voice.who.job ?? '')} · ${esc(voice.who.city)}</div>` +
    `<div class="what">${esc(REACTIONS_ZH[voice.reaction] ?? voice.reaction)}${voice.who.temper ? ` · ${esc(voice.who.temper)}` : ''}</div></div>`,
  );
  const collapsed = cards.length > 24 ? ' collapsed' : '';
  const more = cards.length > 24
    ? `<button class="ghost" type="button" data-expand-voices>看全部 ${cards.length} 条声音</button>`
    : '';
  return `<h3>人格声音</h3><div class="voices${collapsed}">${cards.join('')}</div>${more}`;
}

/** 反应图例（地图默认态）：一个 look 一行，颜色与地图图例同源。 */
function reactionLegend(presetId) {
  const keys = Object.keys(PRESETS[presetId].reactions);
  const seen = new Set();
  const rows = [];
  for (const reaction of keys) {
    const look = lookOf(presetId, reaction);
    if (seen.has(look)) continue;
    seen.add(look);
    rows.push(`<span class="dot" style="background:${LOOKS[look]}"></span>${esc(REACTIONS_ZH[reaction] ?? reaction)}`);
  }
  return rows.join('');
}

/** 聚集地形的图例：环 = 被判为成片的格子（与地图上 ringTerrain 描的环同色）。 */
function terrainLegend(terrain) {
  const rows = [];
  if (terrain.hot?.length) rows.push('<span class="dot ring hot"></span>成片的乐见');
  if (terrain.cold?.length) rows.push('<span class="dot ring cold"></span>成片的反感');
  return rows.join('');
}

/** 地图的「聚集地形」开关：叠上 spatial.js 标出的成片格子，图例同步换。 */
function wireTerrain(el, result, canvas, bytes, presetId) {
  const btn = el.querySelector('[data-terrain]');
  const terrain = result.terrain;
  if (!btn) return;
  if (!terrain || (!terrain.hot?.length && !terrain.cold?.length)) {
    btn.remove();
    return;
  }
  const legend = el.querySelector('.legend');
  let on = false;
  btn.addEventListener('click', () => {
    on = !on;
    btn.textContent = on ? '看反应图' : '看聚集地形';
    btn.setAttribute('aria-pressed', String(on));
    drawGrid(canvas, bytes, presetId, on ? terrain : null);
    legend.innerHTML = on ? terrainLegend(terrain) : reactionLegend(presetId);
  });
}
