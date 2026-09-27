// 100×100 的小镇地图：一个人格一个点，颜色与 presets.js 的 LOOKS 一致。
// 悬停时按需计算人格（shared/personas.js 直接在浏览器里跑，无构建步骤）。
import { LOOKS, lookOf, PRESETS } from './shared/presets.js';
import { persona } from './shared/personas.js';
import { INTEREST, JOB, TEMPER, BUDGET } from './shared/vocab.js';
import { REACTIONS_ZH } from './shared/labels.js';

const CELL = 4;
const GRID = 100;

export function drawGrid(canvas, bytes, presetId) {
  const keys = Object.keys(PRESETS[presetId].reactions);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = GRID * CELL * dpr;
  canvas.height = GRID * CELL * dpr;
  canvas.style.width = `${GRID * CELL}px`;
  canvas.style.height = `${GRID * CELL}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = LOOKS.dark;
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
  const tooltip = document.getElementById('tooltip');
  canvas.addEventListener('mousemove', (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / CELL);
    const y = Math.floor((event.clientY - rect.top) / CELL);
    const visible = x >= 0 && x < GRID && y >= 0 && y < GRID;
    if (!visible) { tooltip.style.display = 'none'; return; }
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
