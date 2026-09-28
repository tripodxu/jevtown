// 视图渲染：app.js（实时检查）与 showcase.js（示例回放）共用。
// 输入形状 = GET /api/post/:v 的 payload（replay.js 能从存档 JSON 拼出同一形状）。
import { PRESETS, LOOKS, lookOf } from './shared/presets.js';
import { drawGrid, attachTooltip } from './grid.js';
import {
  REACTIONS_ZH, REASONS_ZH, HOOKS_ZH, COMMENTS_ZH, SEGMENT_ZH, segmentValueZh, CHECKS_ZH, LIST_ZH, FOLLOWUP_LISTING_ZH, reportStageZh,
} from './shared/labels.js';
import { moodLine, demandChart, funnel, reportBars, fmtMs } from './charts.js';
import { rankedAnswers, demandCurve } from './shared/summary.js';
import { decodeBytes } from './shared/bytes.js';

const BLOCKED_ZH = {
  hate: '仇恨攻击', sexual: '露骨色情', violence: '暴力威胁',
  private_data: '他人隐私', illegal: '违法交易', insult: '辱骂人身攻击', gibberish: '无意义乱码',
};

export const PRESET_NOUN = (presetId) => ({ post: '帖子', listing: '闲置转让', product: '商品文案', headline: '标题' }[presetId] ?? presetId);
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
  html.push(wavesView(result));
  html.push(countsView(result));
  html.push('<h3>小镇地图</h3><div class="map-wrap"><canvas class="grid" role="img" aria-label="小镇反应地图：一万个格子，每格一个人格的反应（悬停可看详情）"></canvas><div class="legend"></div></div>');
  html.push(jevReading(result));
  html.push(segmentsView(result));
  html.push(saidView(result));
  html.push(followUpView(result));
  html.push(voicesView(result));

  el.innerHTML = html.join('');

  const bytes = decodeBytes(result.looks);
  const canvas = el.querySelector('.grid');
  drawGrid(canvas, bytes, presetId);
  attachTooltip(canvas, bytes, presetId);
  renderLegend(el.querySelector('.legend'), presetId);
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
  return `<h3>人格声音</h3><div class="voices">${cards.join('')}</div>`;
}

function renderLegend(el, presetId) {
  const keys = Object.keys(PRESETS[presetId].reactions);
  const seen = new Set();
  const rows = [];
  for (const reaction of keys) {
    const look = lookOf(presetId, reaction);
    if (seen.has(look)) continue;
    seen.add(look);
    rows.push(`<span class="dot" style="background:${LOOKS[look]}"></span>${esc(REACTIONS_ZH[reaction] ?? reaction)}`);
  }
  el.innerHTML = rows.join('');
}
