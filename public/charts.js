// 轻量图谱：无依赖，返回 HTML/SVG 字符串，由 render.js 组装进报告页。
// 折线/面积用 SVG（清晰、可缩放），漏斗与条形用 DOM（复用主题令牌与等宽数字）。
import { GLAD_ENOUGH } from './shared/feed.js';

const esc = (value) => String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/** 情绪轨迹折线（SVG）。points: 数字数组，x 即序号。 */
export function moodLine(points, { width = 560, height = 130 } = {}) {
  if (points.length < 2) return '';
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
