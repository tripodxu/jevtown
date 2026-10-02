// 轻量图谱：无依赖，返回 HTML/SVG 字符串，由 render.js 组装进报告页。
// 折线/面积用 SVG（清晰、可缩放），漏斗与条形用 DOM（复用主题令牌与等宽数字）。
import { GLAD_ENOUGH } from './shared/feed.js';
import { lookOf } from './shared/presets.js';
import { signed } from './shared/labels.js';
import { FACE_INKS } from './inks.js';

const esc = (value) => String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/** 悬停读数的换算参数（app.js 的容器委托用；改 pad 记得同步这里）。 */
export const CHART_PADS = {
  roll: { l: 10, r: 54 },
  share: { l: 10, r: 120 },
};

/** 情绪轨迹折线（SVG）。points: 数字数组，x 即序号。 */
export function moodLine(points, { width = 560, height = 130 } = {}) {
  if (!points.length) return '';
  if (points.length === 1) {
    const v = points[0];
    const tier = v >= GLAD_ENOUGH ? '绿色（传播）' : v >= 0 ? '蓝色（持平）' : '红色（负面）';
    return `<svg class="chart" viewBox="0 0 ${width} 90" role="img" aria-label="唯一一波的情绪为 ${v.toFixed(2)}">
      <circle cx="${width / 2}" cy="38" r="6" fill="var(--accent)" />
      <text x="${width / 2}" y="20" text-anchor="middle" class="chart-num">唯一一波 · 情绪 ${signed(v, 2)}（${tier}）</text>
      <text x="${width / 2}" y="70" text-anchor="middle" class="chart-axis">第 1 波 · 只跑了一波，没有轨迹可画</text>
    </svg>`;
  }
  const pad = { l: 40, r: 14, t: 14, b: 26 };
  const lo = Math.min(-0.1, ...points) - 0.05;
  const hi = Math.max(0.1, ...points) + 0.05;
  const x = (i) => pad.l + (i / (points.length - 1)) * (width - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (height - pad.t - pad.b);
  const path = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const zero = y(0);
  const dots = points
    .map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5" fill="var(--accent)" /><text x="${x(i).toFixed(1)}" y="${(y(v) - 9).toFixed(1)}" text-anchor="middle" class="chart-num">${signed(v, 2)}</text>`)
    .join('');
  const labels = points.map((_, i) => `<text x="${x(i).toFixed(1)}" y="${height - 6}" text-anchor="middle" class="chart-axis">第 ${i + 1} 波</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="各波次情绪轨迹">
    <line x1="${pad.l}" y1="${zero.toFixed(1)}" x2="${width - pad.r}" y2="${zero.toFixed(1)}" class="chart-zero" />
    <line x1="${pad.l}" y1="${(zero - (zero - y(lo)) * 0).toFixed(1)}" x2="${pad.l}" y2="${y(hi).toFixed(1)}" class="chart-axis-line" />
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    ${dots}${labels}
  </svg>`;
}

/** 需求曲线（SVG 面积图）。steps: [{ price, buyers, revenue }]。 */
export function demandChart(steps, { width = 560, height = 140 } = {}) {
  if (steps.length < 2) return '';
  const pad = { l: 44, r: 14, t: 16, b: 26 };
  const maxBuyers = Math.max(...steps.map((s) => s.buyers), 1);
  const x = (i) => pad.l + (i / (steps.length - 1)) * (width - pad.l - pad.r);
  const y = (v) => pad.t + (1 - v / maxBuyers) * (height - pad.t - pad.b);
  const line = steps.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.buyers).toFixed(1)}`).join(' ');
  const area = `${line} L${x(steps.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const dots = steps
    .map((s, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(s.buyers).toFixed(1)}" r="3.5" fill="var(--face-glad)" /><text x="${x(i).toFixed(1)}" y="${(y(s.buyers) - 9).toFixed(1)}" text-anchor="middle" class="chart-num">${s.buyers} 人</text>`)
    .join('');
  const labels = steps.map((s, i) => `<text x="${x(i).toFixed(1)}" y="${height - 6}" text-anchor="middle" class="chart-axis">¥${esc(s.price)}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="价格阶梯需求曲线：价位越低，愿意买的人越多">
    <path d="${area}" fill="var(--face-glad)" opacity="0.12" />
    <line x1="${pad.l}" y1="${y(0).toFixed(1)}" x2="${width - pad.r}" y2="${y(0).toFixed(1)}" class="chart-zero" />
    <path d="${line}" fill="none" stroke="var(--face-glad)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    ${dots}${labels}
  </svg>`;
}

/**
 * 每波反应构成（DOM 堆叠条）：一根条 = 一波，段色 = 面版反应墨水（FACE_INKS，与地图图例同源同色相）。
 * 这里用类别色是语义正确的——它就是"什么反应"，不是量表（区别于传播层的单色渐满）。
 * 段画在 --inset 上，所以用面版而不是地图版墨水：浅色主题里亮墨水 1.1–2.4:1，读不出来（inks.js 头注）。
 * mix 来自 summary.js 的 waveMix（各波同序）；段标题承载精确计数，窄屏由 .seg 家族规则兜底。
 */
export function waveMixChart(mix) {
  const rows = mix.waves.map(({ wave, size, mix: parts }) => {
    const segs = parts
      .map((part) => {
        const color = FACE_INKS[lookOf(mix.presetId, part.reaction)];
        const pct = Math.round(part.share * 100);
        return `<i style="width:${Math.max(2, part.share * 100)}%;background:${color}" ` +
          `title="第 ${wave} 波 · ${esc(part.zh)} ${part.count.toLocaleString()} 人（${pct}%）"></i>`;
      })
      .join('');
    const top = parts.slice(0, 2).map((part) => `${esc(part.zh)} ${Math.round(part.share * 100)}%`).join(' · ');
    return `<div class="seg"><span class="label">第 ${wave} 波 · ${size.toLocaleString()} 人</span>` +
      `<span class="bar2 mix">${segs}</span><span class="num">${top}</span></div>`;
  });
  return `<div class="funnel">${rows.join('')}</div>`;
}

/** 波次漏斗（DOM）。waves: [{ index, size, asked, mood, travels }]。 */
export function funnel(waves) {  if (!waves.length) return '';
  const max = Math.max(...waves.map((w) => w.size), 1);
  const rows = waves.map((wave) => {
    const tier = wave.mood >= GLAD_ENOUGH ? 'fgo' : wave.mood >= 0 ? 'fhold' : 'fdrop';
    const width = Math.max(6, Math.round((wave.size / max) * 100));
    const label = wave.index === waves.length - 1 && !wave.travels ? '检查结束' : wave.travels ? '继续传播' : '停在这里';
    return `<div class="frow">
      <span class="flabel">第 ${wave.index + 1} 波</span>
      <span class="fbar"><i class="f${tier}" style="width:${width}%"></i></span>
      <span class="fnum">${wave.size.toLocaleString()} 人 · 情绪 ${signed(wave.mood, 2)} · ${label}</span>
    </div>`;
  });
  return `<div class="funnel">${rows.join('')}</div>`;
}

/** 调用报告的分阶段条形（DOM）。stages: [{ stage, n, usd, tokens, ms }]，bar 取费用占比（无费用时取耗时占比）。 */
export function reportBars(stages, nameOf) {
  const totalUsd = stages.reduce((sum, s) => sum + s.usd, 0);
  const metricOf = totalUsd > 0 ? (s) => s.usd : (s) => s.ms;
  const total = stages.reduce((sum, s) => sum + metricOf(s), 0) || 1;
  const rows = stages.map((s) => {
    const width = Math.max(4, Math.round((metricOf(s) / total) * 100));
    return `<div class="frow">
      <span class="flabel">${esc(nameOf(s.stage))}</span>
      <span class="fbar"><i style="width:${width}%"></i></span>
      <span class="fnum">${s.n} 次请求 · ${s.tokens.toLocaleString()} tok · ${fmtMs(s.ms)}${s.usd ? ` · $${s.usd.toFixed(4)}` : ''}</span>
    </div>`;
  });
  return `<div class="funnel">${rows.join('')}</div>`;
}

export const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);

/**
 * 运行心电图：滚动窗口面积折线（任务管理器 CPU 曲线的风格）。
 * samples 最新在末尾；窗口取末尾 window 个点；yMax 不给则按数据自适应。
 */
/**
 * 态势占比图（堆叠面积，y 归一化）：覆盖人数为分母，乐见/中性/反感三条带随时间演变。
 * samples: [{ glad, sorry, judged }]，最新在末尾；judged=0 的点按全中性画。
 * width 由调用方按容器实测宽度传进来（见 app.js 的 updateCharts）——固定 viewBox 会被窄屏缩小。
 */
export function shareChart(samples, { width = 560, height = 150, window: win = 60 } = {}) {
  const data = samples.slice(-win);
  if (data.length < 2) return `<div class="chart-empty">积累样本中……</div>`;
  const pad = { l: 10, r: 120, t: 12, b: 22 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const x = (i) => pad.l + (i / (data.length - 1)) * innerW;
  const y = (share) => pad.t + (1 - Math.min(1, Math.max(0, share))) * innerH;
  const band = (topOf, bottomOf) => {
    const up = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(topOf(d)).toFixed(1)}`).join(' ');
    const down = [...data.keys()].reverse().map((i) => `L${x(i).toFixed(1)},${y(bottomOf(data[i])).toFixed(1)}`).join(' ');
    return `${up} ${down} Z`;
  };
  const gladOf = (d) => (d.judged ? d.glad / d.judged : 0);
  const sorryOf = (d) => (d.judged ? d.sorry / d.judged : 0);
  const neutralTopOf = (d) => 1;
  const sorryTopOf = (d) => gladOf(d) + sorryOf(d);
  const last = data[data.length - 1];
  const reach = last.judged;
  // 带状面积：中性/反感/乐见三层。填充是同一片域的成分，不是三样独立的东西，
  // 所以压到半档再用描边收口——0.5 的填充在暗底上只有 2.1–3.0:1（实测），读不出边界。
  const legend = `<text x="${width - pad.r + 8}" y="${pad.t + 14}" class="chart-axis" fill="var(--face-glad)">● 乐见 ${(gladOf(last) * 100).toFixed(0)}%</text>
    <text x="${width - pad.r + 8}" y="${pad.t + 32}" class="chart-axis" fill="var(--muted)">● 中性 ${((1 - gladOf(last) - sorryOf(last)) * 100).toFixed(0)}%</text>
    <text x="${width - pad.r + 8}" y="${pad.t + 50}" class="chart-axis" fill="var(--face-sorry)">● 反感 ${(sorryOf(last) * 100).toFixed(0)}%</text>
    <text x="${width - pad.r + 8}" y="${pad.t + 74}" class="chart-axis">覆盖 ${reach.toLocaleString()} 人</text>`;
  const labels = `<text x="${x(0).toFixed(1)}" y="${height - 6}" class="chart-axis">开始</text>
    <text x="${x(data.length - 1).toFixed(1)}" y="${height - 6}" text-anchor="end" class="chart-axis">现在</text>`;
  return `<svg class="chart ekg" data-chart="share" viewBox="0 0 ${width} ${height}" role="img" aria-label="态度占比随时间发展：乐见、中性、反感各占已判定人数的比例">
    <path d="${band(neutralTopOf, sorryTopOf)}" fill="var(--face-stopped)" opacity="0.5" />
    <path d="${band(sorryTopOf, gladOf)}" fill="var(--face-sorry)" opacity="0.7" />
    <path d="${band(gladOf, () => 0)}" fill="var(--face-glad)" opacity="0.7" />
    ${legend}${labels}
  </svg>`;
}

/** 滚动窗口面积折线。width 同上，由调用方按容器实测宽度传入。 */
export function rollingChart(samples, { width = 420, height = 110, window: win = 48, yMax, color = 'var(--accent)', unit = '', format = (v) => Math.round(v) } = {}) {
  const data = samples.slice(-win);
  if (!data.length) return `<div class="chart-empty">等待第一批数据……</div>`;
  const pad = { l: 10, r: 54, t: 12, b: 10 };
  const top = yMax ?? Math.max(...data, 1);
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const x = (i) => pad.l + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v) => pad.t + (1 - Math.min(v, top) / top) * innerH;
  const pts = data.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${pts} L${x(data.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const last = data[data.length - 1];
  // 横向网格三线，纵轴不画刻度（右侧大数字读数即可）
  const grid = [0.25, 0.5, 0.75].map((f) => {
    const gy = (pad.t + f * innerH).toFixed(1);
    return `<line x1="${pad.l}" y1="${gy}" x2="${pad.l + innerW}" y2="${gy}" class="chart-zero" opacity="0.45" />`;
  }).join('');
  return `<svg class="chart ekg" data-chart="roll" viewBox="0 0 ${width} ${height}" role="img" aria-label="滚动监控曲线，当前 ${format(last)}${unit}">
    ${grid}
    <path d="${area}" fill="${color}" opacity="0.13" />
    <path d="${pts}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" />
    <circle cx="${x(data.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="3" fill="${color}" />
    <text x="${width - pad.r + 8}" y="${pad.t + 12}" class="ekg-now" fill="${color}">${format(last)}${unit}</text>
    <text x="${width - pad.r + 8}" y="${pad.t + 28}" class="chart-axis">峰 ${format(Math.max(...data))}</text>
  </svg>`;
}

// 一页最多 4 张报告卡都会带切片图，渐变defs 的 id 必须逐图唯一，否则后来者引用到别人的渐变
let sliceSeq = 0;

/**
 * 人群切片热力图（SVG）：40 个兴趣街区（5 个年龄段 × 8 列兴趣）的乐见占比。
 * 占比是顺序量表：fill = color-mix(绿 N% → 底板)，吃 CSS 变量，四主题自动跟随、无需重绘；
 * 样本不足的格子不给颜色（虚线框）；格下两行小字在窄屏（格子 < 56px）隐藏，细节交给
 * <title> 悬停。data 来自 shared/summary.js 的 sliceHeatmap。
 */
export function sliceChart(data, { width = 940 } = {}) {
  if (!data.judged) return '';
  const cols = 8;
  const pad = { l: 66, r: 4, t: 4, b: 36 };
  const gap = 6;
  const cellW = Math.floor((width - pad.l - pad.r - (cols - 1) * gap) / cols);
  const fillH = 34;
  const label = cellW >= 56;
  const rowH = fillH + (label ? 34 : 12);
  const height = data.rows.length * rowH + pad.b;
  const x = (col) => pad.l + col * (cellW + gap);
  const y = (row) => pad.t + row * rowH;
  const ramp = `slice-ramp-${(sliceSeq += 1)}`;
  const cells = data.rows
    .map((row, r) =>
      row.cells
        .map((cell, c) => {
          const empty = cell.share == null;
          // 热力格画在 --card 上，用面版墨水对卡片掺（浅色主题里 --map-green 在卡片上只有 1.4–1.7:1）。
          // 空格子给 --card-2 的虚线框，不用地图底板——那会把浅色主题的浅卡片掏出一个深洞。
          const fill = empty ? 'var(--card-2)' : `color-mix(in srgb, var(--face-glad) ${Math.round(cell.share * 100)}%, var(--card-2))`;
          const title = `${row.zh} · ${cell.zh}：判定 ${cell.judged.toLocaleString()} 人 · ` +
            (empty ? '判定太少，不下结论' : `乐见 ${Math.round(cell.share * 100)}%（全城 ${Math.round(data.cityShare * 100)}%）`);
          const text = label
            ? `<text x="${x(c) + cellW / 2}" y="${y(r) + fillH + 13}" text-anchor="middle" class="chart-axis" style="fill:var(--text)">${esc(cell.zh)}</text>` +
              `<text x="${x(c) + cellW / 2}" y="${y(r) + fillH + 27}" text-anchor="middle" class="chart-num">${empty ? '判定少' : `乐见 ${Math.round(cell.share * 100)}%`}</text>`
            : '';
          return `<g><title>${esc(title)}</title>` +
            `<rect x="${x(c)}" y="${y(r)}" width="${cellW}" height="${fillH}" rx="5" style="fill:${fill};stroke:var(--hairline${empty ? '-strong' : ''});stroke-width:1;${empty ? 'stroke-dasharray:3 3;' : ''}" />` +
            text + '</g>';
        })
        .join(''),
    )
    .join('');
  const rowLabels = data.rows
    .map((row, r) => `<text x="${pad.l - 8}" y="${y(r) + fillH / 2 + 4}" text-anchor="end" class="chart-axis">${esc(row.zh)}</text>`)
    .join('');
  const legendY = pad.t + data.rows.length * rowH + 14;
  const legend = `<defs><linearGradient id="${ramp}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="var(--card-2)" /><stop offset="1" stop-color="var(--face-glad)" />
    </linearGradient></defs>
    <rect x="${pad.l}" y="${legendY}" width="120" height="8" rx="4" style="fill:url(#${ramp});stroke:var(--hairline);stroke-width:1" />
    <text x="${pad.l + 128}" y="${legendY + 8}" class="chart-num">乐见占比 0 → 100%</text>
    <text x="${width - pad.r}" y="${legendY + 8}" text-anchor="end" class="chart-num">虚线 = 判定不足 ${data.minSample} 人 · 全城乐见 ${Math.round(data.cityShare * 100)}%</text>`;
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="人群切片热力图：40 个兴趣街区的乐见占比">${rowLabels}${cells}${legend}</svg>`;
}
