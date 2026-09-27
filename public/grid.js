// 100×100 的小镇地图：一个人格一个点。未到达的人融入底色，到达的按反应上色。
// 颜色分两层：反应六色是数据墨水（presets.js 的 LOOKS，全主题不变）；
// 底板与网格取自主题的 CSS 变量（--map-well），所以切主题时整张地图要重绘。
import { LOOKS, lookOf, PRESETS } from './shared/presets.js';
import { persona } from './shared/personas.js';
import { INTEREST, JOB, TEMPER, BUDGET } from './shared/vocab.js';
import { REACTIONS_ZH } from './shared/labels.js';

const CELL = 4;
const GRID = 100;
// 已画过的画布登记在案：主题切换时逐张重绘。
const drawn = new Map();

const cssVar = (name, fallback) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

export function drawGrid(canvas, bytes, presetId) {
  drawn.set(canvas, { bytes, presetId });
  paint(canvas, bytes, presetId);
}

/** 主题切换后调用：把登记过的地图全部按新令牌重画一遍。 */
export function redrawMaps() {
  for (const [canvas, args] of drawn) {
    if (canvas.isConnected) paint(canvas, args.bytes, args.presetId);
  }
}

function paint(canvas, bytes, presetId) {
  const keys = Object.keys(PRESETS[presetId].reactions);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = GRID * CELL * dpr;
  canvas.height = GRID * CELL * dpr;
  canvas.style.width = `${GRID * CELL}px`;
  canvas.style.height = `${GRID * CELL}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = cssVar('--map-well', '#0a0d13');
  ctx.fillRect(0, 0, GRID * CELL, GRID * CELL);
  for (let id = 0; id < bytes.length; id++) {
    const byte = bytes[id];
    if (!byte) continue;
    const look = lookOf(presetId, keys[byte - 1]);
    ctx.fillStyle = LOOKS[look] ?? LOOKS.dark;
    ctx.fillRect((id % GRID) * CELL, Math.floor(id / GRID) * CELL, CELL - 1, CELL - 1);
  }
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
    const x = Math.floor((event.clientX - rect.left) / CELL);
    const y = Math.floor((event.clientY - rect.top) / CELL);
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
      `反应：<b>${reaction}</b>`;
    tooltip.style.display = 'block';
    tooltip.style.left = `${event.clientX + 14}px`;
    tooltip.style.top = `${event.clientY + 14}px`;
  });
  canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
}
