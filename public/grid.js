// 100×100 的小镇地图：一个人格一个点。未到达的人融入底色，到达的按反应上色。
// 颜色分两层：反应六色是数据墨水（presets.js 的 LOOKS，全主题不变）；
// 底板与网格取自主题的 CSS 变量（--map-well），所以切主题时整张地图要重绘。
// 实时地图逐批判定走 paintDelta：只补画新点亮的格子，不刷满一万格。
import { LOOKS, lookOf, PRESETS } from './shared/presets.js';
import { persona } from './shared/personas.js';
import { INTEREST, JOB, TEMPER, BUDGET } from './shared/vocab.js';
import { REACTIONS_ZH } from './shared/labels.js';

const CELL = 4;
const GRID = 100;
// 已画过的画布登记在案：主题切换时逐张重绘；painted = 上次真正画上去的字节快照，
// 实时地图靠它做增量补画，不必每批判定就刷满一万格。
const drawn = new Map();

const cssVar = (name, fallback) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

export function drawGrid(canvas, bytes, presetId) {
  // 修剪掉已断连的旧画布（反复渲染结果区时防泄漏），再登记新的。
  for (const [old] of drawn) if (!old.isConnected) drawn.delete(old);
  drawn.set(canvas, { bytes, presetId, painted: null, well: '' });
  paint(canvas, drawn.get(canvas));
}

/** 主题切换后调用：把登记过的地图全部按新令牌重画一遍。 */
export function redrawMaps() {
  for (const [canvas, entry] of drawn) {
    if (canvas.isConnected) paint(canvas, entry);
  }
}

/**
 * 增量重画：只补画与上次快照不同的格子，返回补画了几格。
 * 画布没登记、换了字节数组或换了预设时退回全量 drawGrid。
 */
export function paintDelta(canvas, bytes, presetId) {
  const entry = drawn.get(canvas);
  if (!entry || entry.bytes !== bytes || entry.presetId !== presetId || !entry.painted) {
    drawGrid(canvas, bytes, presetId);
    return bytes.length;
  }
  const keys = Object.keys(PRESETS[presetId].reactions);
  const ctx = canvas.getContext('2d');
  let touched = 0;
  for (let id = 0; id < bytes.length; id++) {
    if (bytes[id] === entry.painted[id]) continue;
    entry.painted[id] = bytes[id];
    fillCell(ctx, presetId, entry.well, id, bytes[id], keys);
    touched += 1;
  }
  return touched;
}

// 一格：字节 0 铺底板（还没轮到它），否则按反应取数据墨水。
function fillCell(ctx, presetId, well, id, byte, keys) {
  ctx.fillStyle = byte ? (LOOKS[lookOf(presetId, keys[byte - 1])] ?? LOOKS.dark) : well;
  ctx.fillRect((id % GRID) * CELL, Math.floor(id / GRID) * CELL, CELL - 1, CELL - 1);
}

function paint(canvas, entry) {
  const { bytes, presetId } = entry;
  const keys = Object.keys(PRESETS[presetId].reactions);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = GRID * CELL * dpr;
  canvas.height = GRID * CELL * dpr;
  canvas.style.width = `${GRID * CELL}px`;
  canvas.style.maxWidth = '100%';
  canvas.style.height = 'auto';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  entry.well = cssVar('--map-well', '#0a0d13');
  ctx.fillStyle = entry.well;
  ctx.fillRect(0, 0, GRID * CELL, GRID * CELL);
  for (let id = 0; id < bytes.length; id++) {
    if (!bytes[id]) continue;
    fillCell(ctx, presetId, entry.well, id, bytes[id], keys);
  }
  entry.painted = bytes.slice(); // 快照，供 paintDelta 做增量
}

/** 悬停提示：id → 人格档案 + 它的反应。 */
export function attachTooltip(canvas, bytes, presetId) {
  const keys = Object.keys(PRESETS[presetId].reactions);
  let tooltip = document.getElementById('tooltip');
  if (!tooltip) {
    tooltip = Object.assign(document.createElement('div'), { id: 'tooltip', role: 'status' });
    document.body.append(tooltip);
  }
  canvas.addEventListener('mousemove', (event) => {
    const rect = canvas.getBoundingClientRect();
    const scale = GRID / rect.width; // CSS 压缩后的实际比例
    const x = Math.floor((event.clientX - rect.left) * scale);
    const y = Math.floor((event.clientY - rect.top) * scale);
    const inside = x >= 0 && x < GRID && y >= 0 && y < GRID;
    if (!inside) { tooltip.style.display = 'none'; return; }
    const id = y * GRID + x;
    const who = persona('zh', id);
    const byte = bytes[id];
    const reaction = byte ? REACTIONS_ZH[keys[byte - 1]] ?? keys[byte - 1] : '没看到这条';
    tooltip.innerHTML =
      `<b>${who.name.zh}</b>，${who.age}岁，${JOB[who.job]?.zh ?? who.job}，${who.city.zh}<br>` +
      `兴趣：${who.interests.map((i) => INTEREST[i]?.zh ?? i).join('、')}<br>` +
      `${TEMPER[who.temper]?.zh} · ${BUDGET[who.budget]?.zh}<br>` +
      `Jev 判定：<b>${reaction}</b>`;
    tooltip.style.display = 'block';
    tooltip.style.left = `${event.clientX + 14}px`;
    tooltip.style.top = `${event.clientY + 14}px`;
  });
  canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
}
