// 实时监控：检查进行中把 Jev 的判定一笔笔画出来——地图逐批点亮、两张心电图（吞吐 / 耗时）、
// 态度占比带、调用流水表，外加给状态行用的本波 ETA。
//
// 这一整块原本长在 app.js 里（约 150 行），与「发请求 / 驱动波次」的编排挤在一起；
// app.js 是 1000 行的编排层，监控是它里面唯一一块自带状态（live）与自带 DOM 的部件，
// 抽出来之后两边各自只有一个职责。行为一字未改，只是搬了家。
import { PRESETS } from './shared/presets.js';
import { drawGrid, paintDelta } from './grid.js';
import { fmtMs, rollingChart, shareChart, CHART_PADS } from './charts.js';
import { newTally, foldBatch } from './tally.js';
import { CROWD } from './shared/personas.js';
import { $, stat } from './dom.js';

/** 当前这次检查的实时监控状态；null = 此刻没有检查在跑（图表悬停据此短路）。 */
let live = null;

/**
 * 开一次监控。seedDrawn 是续跑时已判定过的人（[{ id, reaction }]，从报告的 looks 字节还原）：
 * foldBatch 幂等（重折同一个人只改字节不动计数），已判定的人先铺回地图与统计，
 * 否则续跑地图从头黑起，前几波的成果全看不见。
 */
export function startMonitor(presetId, seedDrawn = null) {
  const reactions = PRESETS[presetId].reactions;
  const keys = Object.keys(reactions);
  live = {
    tally: newTally(CROWD),
    keys,
    tone: keys.map((id) => reactions[id]?.tone ?? 0), // 序号 → 1/0/-1
    preset: presetId,
    start: performance.now(),
    requests: 0,
    tokens: 0,
    usd: 0,
    ms: 0,
    tput: [],
    msSeries: [],
    shares: [],
    lastSample: null,
  };
  if (seedDrawn?.length) {
    foldBatch(live.tally, seedDrawn, (reaction) => keys.indexOf(reaction), (index) => live.tone[index] ?? 0);
    live.shares.push({ glad: live.tally.glad, sorry: live.tally.sorry, judged: live.tally.judged });
  }
  $('monitorBody').innerHTML = '';
  $('live').hidden = false;
  // 点了「让小镇来读」之后最想看的是地图逐批判定点亮——实时区在首屏折叠线下，
  // 不滚过去的话整段监控都是不可见的（用户盯着发帖框只看得到状态行）。
  $('live').scrollIntoView({ behavior: 'smooth' });
  drawGrid($('liveMap'), live.tally.bytes, presetId);
  updateLiveStats();
  updateCharts();
}

function updateLiveStats() {
  $('liveStats').innerHTML =
    stat(`${live.tally.judged.toLocaleString()} / ${CROWD.toLocaleString()}`, 'Jev 已判定') +
    stat(live.requests, 'Jev 请求') +
    stat(live.tokens.toLocaleString(), '输入 tokens') +
    stat(fmtMs(live.ms), '模型耗时') +
    stat(`$${live.usd.toFixed(4)}`, '累计花费');
}

function updateCharts() {
  // 同 render.js：viewBox 跟着容器走，否则窄屏把 11px 的标注缩到看不清。
  const wide = Math.min(940, Math.max(300, $('chartShare').clientWidth || 900));
  const narrow = Math.min(420, Math.max(260, $('chartTput').clientWidth || 420));
  $('chartTput').innerHTML = rollingChart(live.tput, { width: narrow, color: 'var(--accent)', unit: ' 人/s' });
  $('chartMs').innerHTML = rollingChart(live.msSeries, { width: narrow, color: 'var(--face-spreads)', unit: 'ms', format: (v) => Math.round(v) });
  $('chartShare').innerHTML = shareChart(live.shares, { width: wide });
}

/** 折一批判定：补画新点亮的格子、累计调用账、采一次心电图样本、追加一行流水。 */
export function paintBatch(batch) {
  // 增量：只走本批这 100 人，不再每批把全镇一万格重扫两遍。
  const { tally, keys, tone } = live;
  foldBatch(tally, batch.drawn ?? [], (reaction) => keys.indexOf(reaction), (index) => tone[index] ?? 0);
  paintDelta($('liveMap'), tally.bytes, live.preset);
  live.requests += 1;
  live.tokens += batch.tokens ?? 0;
  live.usd += batch.usd ?? 0;
  live.ms += batch.ms ?? 0;

  // 心电图采样：吞吐 = 本批判定数 / 距上次采样的墙钟；耗时 = 本批模型 ms
  const now = performance.now();
  const wall = live.lastSample ? (now - live.lastSample.t) / 1000 : 0;
  const judged = tally.judged;
  live.tput.push(wall > 0.05 ? (judged - live.lastSample.judged) / wall : 0);
  live.msSeries.push(batch.ms ?? 0);
  live.shares.push({ glad: tally.glad, sorry: tally.sorry, judged });
  live.lastSample = { t: now, judged };

  updateLiveStats();
  updateCharts();
  monitorRow([`第 ${batch.wave + 1} 波`, `${batch.answered} / ${batch.total}`, `${batch.ms ?? 0}ms`, `${(batch.tokens ?? 0).toLocaleString()}`, `$${live.usd.toFixed(4)}`]);
}

/** 流水表追加一行（最新在最上，最多留 150 行，免得一次全城检查把 DOM 撑爆）。 */
export function monitorRow(cells, cls = '') {
  const tr = document.createElement('tr');
  if (cls) tr.className = cls;
  const sec = ((performance.now() - live.start) / 1000).toFixed(1);
  tr.innerHTML = `<td>${sec}s</td>` + cells.map((c) => `<td>${c}</td>`).join('');
  const body = $('monitorBody');
  body.prepend(tr);
  while (body.children.length > 150) body.lastChild.remove();
}

/**
 * 本波预计还要多久：拿最近几批的墙钟吞吐（含节奏化的 pause——访客等的正是墙钟）估剩余
 * 人数的时间。少于 5 秒或还测不出速率就不说；只估本波——下一波传不传、追问问多久都
 * 还是未知数，给个总 ETA 只会是在编数字。5 秒一档取整，数字不跳。
 */
export function etaSay(batch) {
  if (!live) return '';
  const now = performance.now();
  live.rateWindow ??= [];
  live.rateWindow.push({ t: now, judged: live.tally.judged });
  if (live.rateWindow.length > 6) live.rateWindow.shift();
  const first = live.rateWindow[0];
  const span = (now - first.t) / 1000;
  if (span < 2) return '';
  const rate = (live.tally.judged - first.judged) / span;
  if (rate <= 0) return '';
  const eta = (batch.total - batch.answered) / rate;
  if (eta < 5) return '';
  return ` · 预计还有 ~${Math.round(eta / 5) * 5}s`;
}

/**
 * 节奏化：让点亮过程可见。第 1 波是揭示（慢一点），之后是量（快一点）——全城广播
 * 130 批全按 180ms 会白等二十多秒，首波之后 90ms 足够看清逐批推进。
 */
export const pace = () => new Promise((resolve) => setTimeout(resolve, live && live.tally.judged >= 600 ? 90 : 180));

/** 收尾：把监控区收起来（报告接手画面）。 */
export function stopMonitor() {
  $('live').hidden = true;
  live = null;
}

// -- 图表悬停读数：容器常驻（svg 每批重建），委托挂容器上不丢 -------------------
// offsetX 不用 event.offsetX（target 可能是 svg 内部元素），一律按 svg 的 rect 换算；
// 图表只画最近一个窗口（roll 48 / share 60），读数标注的是"第 N 批"的绝对批次号。

const hoverLine = (svg, x) => {
  svg?.querySelector('.hover-line')?.remove();
  if (x == null || !svg) return;
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', x);
  line.setAttribute('x2', x);
  line.setAttribute('y1', '0');
  line.setAttribute('y2', '100%');
  line.setAttribute('class', 'hover-line');
  svg.append(line);
};

const hoverReadout = (host, text) => {
  let el = host.querySelector('.chart-read');
  if (!text) {
    el?.remove();
    return;
  }
  if (!el) {
    el = Object.assign(document.createElement('div'), { className: 'chart-read' });
    host.append(el);
  }
  el.textContent = text;
};

function wireChartHover(host, kind, readoutOf) {
  host.addEventListener('pointermove', (event) => {
    if (!live) return;
    const svg = host.querySelector('svg[data-chart]');
    if (!svg) return;
    const samples = kind === 'share' ? live.shares : kind === 'tput' ? live.tput : live.msSeries;
    const win = kind === 'share' ? 60 : 48;
    const data = samples.slice(-win);
    if (data.length < 2) return;
    const pad = CHART_PADS[kind === 'share' ? 'share' : 'roll']; // 两张折线图共用 roll 的留白
    const rect = svg.getBoundingClientRect();
    const innerW = rect.width - pad.l - pad.r;
    const frac = (event.clientX - rect.left - pad.l) / innerW;
    if (frac < 0 || frac > 1) return; // 出了绘图区就不显示读数
    const i = Math.round(frac * (data.length - 1));
    const batchNo = samples.length - data.length + i + 1;
    hoverLine(svg, (pad.l + (i / (data.length - 1)) * innerW).toFixed(1));
    hoverReadout(host, readoutOf(data[i], batchNo));
  });
  host.addEventListener('pointerleave', () => {
    hoverLine(host.querySelector('svg[data-chart]'), null);
    hoverReadout(host, '');
  });
}

wireChartHover($('chartTput'), 'tput', (v, n) => `第 ${n} 批 · ${Math.round(v)} 人/s`);
wireChartHover($('chartMs'), 'ms', (v, n) => `第 ${n} 批 · ${Math.round(v)}ms`);
wireChartHover($('chartShare'), 'share', (v, n) =>
  v.judged ? `第 ${n} 批 · 乐见 ${Math.round((v.glad / v.judged) * 100)}% · 反感 ${Math.round((v.sorry / v.judged) * 100)}%` : `第 ${n} 批`);
