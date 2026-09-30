// 视图渲染：app.js（实时检查）与 showcase.js（示例回放）共用。
// 输入形状 = GET /api/post/:v 的 payload（replay.js 能从存档 JSON 拼出同一形状）。
import { PRESETS, LOOKS, lookOf } from './shared/presets.js';
import { drawGrid, attachTooltip, drawDelta, drawReach, reachInk } from './grid.js';
import {
  REACTIONS_ZH, REASONS_ZH, HOOKS_ZH, COMMENTS_ZH, SEGMENT_ZH, segmentValueZh, CHECKS_ZH, LIST_ZH, FOLLOWUP_LISTING_ZH, reportStageZh, BLOCKED_ZH, presetNoun, TERRAIN_VERDICT_ZH, TERRAIN_SAY_ZH, DELTA_SAY_ZH, directionZh,
} from './shared/labels.js';
import { moodLine, demandChart, funnel, reportBars, fmtMs } from './charts.js';
import { rankedAnswers, demandCurve } from './shared/summary.js';
import { decodeBytes } from './shared/bytes.js';
import { crowdDelta } from './shared/spatial.js';

export const PRESET_NOUN = presetNoun;
export const readCheck = (p) => (p >= 0.7 ? 'yes' : p <= 0.3 ? 'no' : 'unclear');
export const esc = (value) => String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const stat = (value, label) => `<div class="stat"><b>${typeof value === 'number' ? value.toLocaleString() : value}</b><span>${label}</span></div>`;
export { stat };

/** 把一页结果渲染进容器 el（卡片本体）。 */
export function renderCheck(el, result) {
  el.hidden = false;
  // 图表的 viewBox 宽度跟着容器走：固定宽度在窄屏会把 11px 的标注缩到 4px。
  const chartWidth = Math.min(940, Math.max(300, el.clientWidth - 56));
  const presetId = result.post.preset;
  const html = [`<h2>${esc(PRESET_NOUN(presetId))} · 检查结果</h2>`];

  html.push('<div class="source-text">');
  html.push(`<div>文本：${esc(result.post.text.slice(0, 80))}${result.post.text.length > 80 ? '…' : ''}</div>`);
  if (result.unlisted?.length) html.push(`<div class="hint">未列入公共流：${esc(result.unlisted.map((id) => BLOCKED_ZH[id] ?? id).join('、'))}</div>`);
  html.push('</div>');

  html.push(overview(result));
  html.push(reportView(result));
  html.push(decisionsView(result));
  html.push(terrainView(result));
  html.push(wavesView(result, chartWidth));
  html.push(countsView(result));
  // 地图三视图：反应（恒有）/ 传播（逐人波次数据在时）/ 聚集地形（有成片格子时）。
  // 数据不在就摘掉对应按钮——旧存档没有 waveOf，传播按钮优雅缺席。
  html.push('<h3>小镇地图</h3><div class="map-bar"><div class="mapswitch" role="group" aria-label="地图视图">' +
    '<button type="button" data-map-mode="reaction" aria-pressed="true">反应图</button>' +
    (result.reach && result.waves?.length ? '<button type="button" data-map-mode="reach" aria-pressed="false">传播</button>' : '') +
    '<button type="button" data-map-mode="terrain" aria-pressed="false">聚集地形</button>' +
    '</div><button class="ghost" type="button" data-replay hidden>重播传播</button>' +
    '<span class="hint" data-map-hint></span></div>' +
    '<div class="map-wrap"><canvas class="grid" role="img" aria-label="小镇地图：一万个格子，每格一个人格（悬停可看详情）"></canvas><div class="legend"></div></div>');
  html.push(jevReading(result));
  html.push(segmentsView(result));
  html.push(saidView(result));
  html.push(followUpView(result, chartWidth));
  html.push(voicesView(result));

  el.innerHTML = html.join('');

  buildToc(el);

  const bytes = decodeBytes(result.looks);
  const canvas = el.querySelector('.grid');
  attachTooltip(canvas, bytes, presetId);
  wireMapModes(el, result, canvas, bytes, presetId);
}

/** 报告目录：给每个 h3 发一组**本卡独有**的 id，顶部生成锚点 pill 行（长报告一跳直达）。
 *  一页上最多有 4 张报告卡（结果 / 对比 / 两张示例），id 必须逐卡唯一——
 *  否则点目录会跳到另一张卡的同名小节。 */
let tocSeq = 0;
function buildToc(el) {
  const headings = [...el.querySelectorAll('h3')];
  if (headings.length < 2) return;
  const uid = `r${(tocSeq += 1)}`;
  headings.forEach((h, i) => { h.id = `${uid}-sec-${i}`; });
  const nav = document.createElement('nav');
  nav.className = 'toc';
  nav.setAttribute('aria-label', '报告目录');
  nav.innerHTML = headings.map((h, i) => `<a href="#${uid}-sec-${i}">${esc(h.textContent)}</a>`).join('');
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

function wavesView(result, width) {
  if (!result.waves?.length) return '';
  const line = moodLine(result.waves.map((w) => w.mood), { width });
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

function followUpView(result, width) {
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
    html.push(demandChart(curve, { width }));
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

/** 传播层的图例：逐波一行（点色与 reachInk 同源）+ 没看到。 */
function reachLegend(result) {
  const rows = result.waves.map((wave) =>
    `<span class="dot" style="background:${reachInk(wave.index + 1)}"></span>第 ${wave.index + 1} 波 · ${wave.size.toLocaleString()} 人`);
  rows.push('<span class="dot" style="background:var(--map-well);box-shadow:inset 0 0 0 1px var(--hairline-strong)"></span>没看到');
  return rows.join('');
}

/**
 * 地图三视图：反应（恒有）/ 传播（有逐人波次数据时）/ 聚集地形（有成片格子时）。
 * 数据不在就摘掉对应按钮（旧存档没有 waveOf → 传播优雅缺席）；首帧由 apply('reaction') 画。
 * 传播层没有"这个人是谁"之外的悬停语义（它显示的是波次不是反应），悬停档案关闭。
 */
function wireMapModes(el, result, canvas, bytes, presetId) {
  const terrain = result.terrain;
  const reach = result.reach ? decodeBytes(result.reach) : null;
  const buttons = new Map([...el.querySelectorAll('[data-map-mode]')].map((b) => [b.dataset.mapMode, b]));
  if (!reach || !result.waves?.length) buttons.get('reach')?.remove();
  if (!terrain || (!terrain.hot?.length && !terrain.cold?.length)) buttons.get('terrain')?.remove();
  const legend = el.querySelector('.legend');
  const hint = el.querySelector('[data-map-hint]');
  const replayBtn = el.querySelector('[data-replay]');
  if (!legend || !hint || !buttons.size) return;

  const HINTS = {
    reaction: '一格一人格，颜色 = 它的反应；悬停看档案。',
    reach: '颜色越满 = 越晚看到；重播按波次逐步点亮。',
    terrain: '成片 = 这一片人朝着同一个方向表态；零散 = 各看各的。',
  };
  const show = {
    reaction: () => { canvas.style.cursor = ''; canvas.dataset.tipOff = ''; drawGrid(canvas, bytes, presetId); legend.innerHTML = reactionLegend(presetId); },
    terrain: () => { canvas.style.cursor = ''; canvas.dataset.tipOff = ''; drawGrid(canvas, bytes, presetId, terrain); legend.innerHTML = terrainLegend(terrain); },
    reach: () => { canvas.style.cursor = 'default'; canvas.dataset.tipOff = '1'; drawReach(canvas, reach); legend.innerHTML = reachLegend(result); },
  };
  let mode = 'reaction';
  const apply = (next) => {
    mode = next;
    for (const [name, btn] of buttons) if (btn.isConnected) btn.setAttribute('aria-pressed', String(name === mode));
    show[mode]();
    hint.textContent = HINTS[mode] ?? '';
    if (replayBtn) replayBtn.hidden = mode !== 'reach';
  };
  for (const [name, btn] of buttons) btn.addEventListener('click', () => apply(name));
  apply('reaction');

  // 重播：立即置空档再按波次逐档点亮（每档 650ms）；reduced-motion 用户跳过动画直接铺满。
  // 重播途中的定时器要清掉——连点两次不该让上一轮的档位追着这一轮跑。
  if (replayBtn && reach) {
    const maxWave = reach.reduce((max, wave) => Math.max(max, wave), 0);
    let timers = [];
    replayBtn.addEventListener('click', () => {
      if (mode !== 'reach') return;
      for (const timer of timers) clearTimeout(timer);
      timers = [];
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        drawReach(canvas, reach);
        return;
      }
      drawReach(canvas, reach, 0);
      for (let wave = 1; wave <= maxWave; wave++) {
        timers.push(setTimeout(() => { if (mode === 'reach') drawReach(canvas, reach, wave); }, wave * 650));
      }
    });
  }
}

/**
 * 两版之差：改一版再发之后，"你改的这几个词让谁改了主意"。
 * 全部在浏览器里算——两版的 looks 本来就都在内存里，不新增 Jev 调用。
 * 只对同预设的两版有意义：预设不同则反应词表不同，差值没有可比性，直接留空。
 */
export function renderDelta(el, after, before) {
  if (!before || before.post.preset !== after.post.preset) {
    el.innerHTML = '';
    return;
  }
  const presetId = after.post.preset;
  const keys = Object.keys(PRESETS[presetId].reactions);
  const d = crowdDelta(presetId, keys, decodeBytes(before.looks), decodeBytes(after.looks), {
    versionId: `${after.post.id}-${before.post.id}`,
  });
  if (!d.both) {
    el.innerHTML = '<h3>两版之差</h3><div class="delta-read"><p class="hint">两版没有任何一个人被同时判定到，没有可比的差分。</p></div>';
    return;
  }
  // 覆盖差异单独说一句：只被一版排到的人不是"变中立了"，是这次没轮到。
  const reach = d.onlyBefore || d.onlyAfter
    ? d.onlyAfter === d.onlyBefore
      ? `两版各有 ${d.onlyAfter.toLocaleString()} 个人只被自己排到。`
      : `这一版比上一版${d.onlyAfter > d.onlyBefore ? '多' : '少'}排到了 ${Math.abs(d.onlyAfter - d.onlyBefore).toLocaleString()} 个人。`
    : '两版的传播范围一样大。';
  const verdict = TERRAIN_VERDICT_ZH[d.terrain.verdict] ?? d.terrain.verdict;
  const where = [
    d.terrain.hot.length ? `成片变好集中在地图${directionZh(d.terrain.hotAt)}（${d.terrain.hot.length} 格）` : '',
    d.terrain.cold.length ? `成片变差集中在地图${directionZh(d.terrain.coldAt)}（${d.terrain.cold.length} 格）` : '',
  ].filter(Boolean).join('；');
  el.innerHTML = `<h3>两版之差</h3>
    <div class="delta-read">
      <div class="stats">
        ${stat(d.up.toLocaleString(), '变好的人')}
        ${stat(d.down.toLocaleString(), '变差的人')}
        ${stat(d.net.toLocaleString(), '净态度变化')}
        ${stat(d.both.toLocaleString(), '两版都看到的人')}
      </div>
      <div class="terrain-say">改动的分布<em>${verdict}</em>。${DELTA_SAY_ZH[d.terrain.verdict] ?? ''}</div>
      <div class="hint">差分只统计两版都被判定到的 ${d.both.toLocaleString()} 人（只被一版排到的人不算"变中立"）。${esc(reach)}${where ? `${esc(where)}。` : ''}差场的 Moran's I = ${d.terrain.morans === null ? '不可比' : d.terrain.morans.toFixed(3)}</div>
    </div>
    <div class="map-bar"><span class="hint">差分图：绿=变好，红=变差，颜色越满变化越大；底色=两版都没排到或没有变化。</span></div>
    <div class="map-wrap"><canvas class="grid diff" role="img" aria-label="差分地图：这一版相对上一版，哪些人变好、哪些人变差"></canvas><div class="legend delta-legend">${deltaLegend()}</div></div>`;
  drawDelta(el.querySelector('canvas.diff'), d.codes);
}

/** 差分图例：两档幅度 × 两个方向（与 drawDelta 的 inks 同色，半档 = 墨水与底板各半）。 */
function deltaLegend() {
  return '<span class="dot" style="background:color-mix(in srgb, var(--map-green) 50%, var(--map-well))"></span>小幅变好'
    + '<span class="dot" style="background:var(--map-green)"></span>大幅变好'
    + '<span class="dot" style="background:color-mix(in srgb, var(--map-red) 50%, var(--map-well))"></span>小幅变差'
    + '<span class="dot" style="background:var(--map-red)"></span>大幅变差';
}
