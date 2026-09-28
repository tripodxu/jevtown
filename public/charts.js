// 轻量图谱：无依赖，返回 HTML/SVG 字符串，由 render.js 组装进报告页。
// 折线/面积用 SVG（清晰、可缩放），漏斗与条形用 DOM（复用主题令牌与等宽数字）。
import { GLAD_ENOUGH } from './shared/feed.js';

const esc = (value) => String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/** 情绪轨迹折线（SVG）。points: 数字数组，x 即序号。 */
export function moodLine(points, { width = 560, height = 130 } = {}) {
  if (!points.length) return '';
  if (points.length === 1) {
    const v = points[0];
    const tier = v >= GLAD_ENOUGH ? '绿色（传播）' : v >= 0 ? '蓝色（持平）' : '红色（负面）';
    return `<svg class="chart" viewBox="0 0 ${width} 90" role="img" aria-label="唯一一波的情绪为 ${v.toFixed(2)}">
      <circle cx="${width / 2}" cy="38" r="6" fill="var(--accent)" />
      <text x="${width / 2}" y="20" text-anchor="middle" class="chart-num">唯一一波 · 情绪 ${v >= 0 ? '+' : ''}${v.toFixed(2)}（${tier}）</text>
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
    .map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5" fill="var(--accent)" /><text x="${x(i).toFixed(1)}" y="${(y(v) - 9).toFixed(1)}" text-anchor="middle" class="chart-num">${v >= 0 ? '+' : ''}${v.toFixed(2)}</text>`)
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
    .map((s, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(s.buyers).toFixed(1)}" r="3.5" fill="var(--map-green)" /><text x="${x(i).toFixed(1)}" y="${(y(s.buyers) - 9).toFixed(1)}" text-anchor="middle" class="chart-num">${s.buyers} 人</text>`)
    .join('');
  const labels = steps.map((s, i) => `<text x="${x(i).toFixed(1)}" y="${height - 6}" text-anchor="middle" class="chart-axis">¥${esc(s.price)}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="价格阶梯需求曲线：价位越低，愿意买的人越多">
    <path d="${area}" fill="var(--map-green)" opacity="0.12" />
    <line x1="${pad.l}" y1="${y(0).toFixed(1)}" x2="${width - pad.r}" y2="${y(0).toFixed(1)}" class="chart-zero" />
    <path d="${line}" fill="none" stroke="var(--map-green)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    ${dots}${labels}
  </svg>`;
}

/** 波次漏斗（DOM）。waves: [{ index, size, asked, mood, travels }]。 */
export function funnel(waves) {
  if (!waves.length) return '';
  const max = Math.max(...waves.map((w) => w.size), 1);
  const rows = waves.map((wave) => {
    const tier = wave.mood >= GLAD_ENOUGH ? 'go' : wave.mood >= 0 ? 'hold' : 'drop';
    const width = Math.max(6, Math.round((wave.size / max) * 100));
    const label = wave.index === waves.length - 1 && !wave.travels ? '检查结束' : wave.travels ? '继续传播' : '停在这里';
    return `<div class="frow">
      <span class="flabel">第 ${wave.index + 1} 波</span>
      <span class="fbar"><i class="f${tier}" style="width:${width}%"></i></span>
      <span class="fnum">${wave.size.toLocaleString()} 人 · 情绪 ${wave.mood >= 0 ? '+' : ''}${wave.mood.toFixed(2)} · ${label}</span>
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
 */
export function shareChart(samples, { width = 900, height = 150, window: win = 60 } = {}) {
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
  const legend = `<text x="${width - pad.r + 8}" y="${pad.t + 14}" class="chart-axis" fill="var(--map-green)">● 乐见 ${(gladOf(last) * 100).toFixed(0)}%</text>
    <text x="${width - pad.r + 8}" y="${pad.t + 32}" class="chart-axis" fill="var(--muted)">● 中性 ${((1 - gladOf(last) - sorryOf(last)) * 100).toFixed(0)}%</text>
    <text x="${width - pad.r + 8}" y="${pad.t + 50}" class="chart-axis" fill="var(--map-red)">● 反感 ${(sorryOf(last) * 100).toFixed(0)}%</text>
    <text x="${width - pad.r + 8}" y="${pad.t + 74}" class="chart-axis">覆盖 ${reach.toLocaleString()} 人</text>`;
  const labels = `<text x="${x(0).toFixed(1)}" y="${height - 6}" class="chart-axis">开始</text>
    <text x="${x(data.length - 1).toFixed(1)}" y="${height - 6}" text-anchor="end" class="chart-axis">现在</text>`;
  return `<svg class="chart ekg" viewBox="0 0 ${width} ${height}" role="img" aria-label="态度占比随时间发展：乐见、中性、反感各占已判定人数的比例">
    <path d="${band(neutralTopOf, sorryTopOf)}" fill="var(--map-blue)" opacity="0.28" />
    <path d="${band(sorryTopOf, gladOf)}" fill="var(--map-red)" opacity="0.5" />
    <path d="${band(gladOf, () => 0)}" fill="var(--map-green)" opacity="0.5" />
    ${legend}${labels}
  </svg>`;
}

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
  return `<svg class="chart ekg" viewBox="0 0 ${width} ${height}" role="img" aria-label="滚动监控曲线，当前 ${format(last)}${unit}">
    ${grid}
    <path d="${area}" fill="${color}" opacity="0.13" />
    <path d="${pts}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" />
    <circle cx="${x(data.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="3" fill="${color}" />
    <text x="${width - pad.r + 8}" y="${pad.t + 12}" class="ekg-now" fill="${color}">${format(last)}${unit}</text>
    <text x="${width - pad.r + 8}" y="${pad.t + 28}" class="chart-axis">峰 ${format(Math.max(...data))}</text>
  </svg>`;
}
