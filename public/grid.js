// 100×100 的小镇地图：一个人格一个点。未到达的人融入底色，到达的按反应上色。
// 颜色分两层：反应六色是数据墨水（presets.js 的 LOOKS，全主题不变）；
// 底板与网格取自主题的 CSS 变量（--map-well），所以切主题时整张地图要重绘。
// 实时地图逐批判定走 paintDelta：只补画新点亮的格子，不刷满一万格；
// 报告地图可再传一个 terrain（shared/spatial.js 的成片格子），给它们描环。
import { LOOKS, lookOf, PRESETS } from './shared/presets.js';
import { persona } from './shared/personas.js';
import { INTEREST, JOB, TEMPER, BUDGET } from './shared/vocab.js';
import { REACTIONS_ZH } from './shared/labels.js';

const CELL = 4;
const GRID = 100;
// 已画过的画布登记在案：主题切换时逐张重绘；painted = 上次真正画上去的字节快照，
// 实时地图靠它做增量补画，不必每批判定就刷满一万格。
const drawn = new Map();
// 差分画布另册登记：它没有悬停档案、不走 drawn 的字节快照与增量逻辑，
// 但主题切换时 redrawMaps 必须也按新令牌重画它——否则差分图留着上个主题的墨水。
const deltas = new Map();

const cssVar = (name, fallback) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

export function drawGrid(canvas, bytes, presetId, terrain = null) {
  // 修剪掉已断连的旧画布（反复渲染结果区时防泄漏），再登记新的。
  for (const [old] of drawn) if (!old.isConnected) drawn.delete(old);
  drawn.set(canvas, { bytes, presetId, terrain, painted: null, well: '' });
  paint(canvas, drawn.get(canvas));
}

/** 主题切换后调用：把登记过的地图全部按新令牌重画一遍。 */
export function redrawMaps() {
  for (const [canvas, entry] of drawn) {
    if (canvas.isConnected) paint(canvas, entry);
  }
  for (const [canvas, codes] of deltas) {
    if (canvas.isConnected) drawDelta(canvas, codes);
  }
}

/**
 * 增量重画：只补画与上次快照不同的格子，返回补画了几格。
 * 画布没登记、换了字节数组或换了预设时退回全量 drawGrid。
 */
export function paintDelta(canvas, bytes, presetId, terrain = null) {
  const entry = drawn.get(canvas);
  if (!entry || entry.bytes !== bytes || entry.presetId !== presetId || entry.terrain !== terrain || !entry.painted) {
    drawGrid(canvas, bytes, presetId, terrain);
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

// 聚集地形：给 spatial.js 标出的成片格子描一圈环——绿=成片的乐见，红=成片的反感。
// 环色取主题的数据墨水（--map-green / --map-red），所以换主题重画时环也跟着走。
function ringTerrain(ctx, terrain) {
  if (!terrain) return;
  ctx.lineWidth = 1;
  const ring = (ids, color) => {
    if (!ids?.length) return;
    ctx.strokeStyle = color;
    // 内缩半像素：环正好压在格子边界上，不会被相邻格的填充盖掉
    for (const id of ids) ctx.strokeRect((id % GRID) * CELL + 0.5, Math.floor(id / GRID) * CELL + 0.5, CELL - 1, CELL - 1);
  };
  ring(terrain.hot, cssVar('--map-green', '#3ddc84'));
  ring(terrain.cold, cssVar('--map-red', '#ff5c5c'));
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
  ringTerrain(ctx, entry.terrain);
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

// -- 两版之差的发散配色 ----------------------------------------------------------
// 绿=变好、红=变差，幅度大的画满、幅度小的与底板掺半。
// 墨水仍取主题数据墨水（--map-green / --map-red），所以四个主题各自成立。
// 刻意不用 LOOKS：那是"这个人做了什么反应"的色板，这里是"相对上一版变了多少"的量表，
// 语义不同——用同一套颜色会让读者把"变了"误读成"是哪种反应"。

/** 两个 #rrggbb 按 t（0..1）线性掺，返回 #rrggbb。t=0 全 a，t=1 全 b。 */
const mixHex = (a, b, t) => {
  const left = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const right = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${left.map((v, i) => Math.round(v + (right[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
};

/**
 * 差分地图。codes 来自 shared/spatial.js 的 crowdDelta（code = delta + 3，0 = 不可比）：
 * 1 = 大幅变差、2 = 小幅变差、3 = 没变、4 = 小幅变好、5 = 大幅变好。
 * 返回画了几个格子。
 *
 * 画布登记进 deltas（不进 drawn）：没有"这个人是谁"的档案可悬停、没有增量路径，
 * 但主题切换时 redrawMaps 要按新令牌把它重画一遍。
 */
export function drawDelta(canvas, codes) {
  for (const [old] of deltas) if (!old.isConnected) deltas.delete(old); // 清掉已断连的旧画布
  deltas.set(canvas, codes);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = GRID * CELL * dpr;
  canvas.height = GRID * CELL * dpr;
  canvas.style.width = `${GRID * CELL}px`;
  canvas.style.maxWidth = '100%';
  canvas.style.height = 'auto';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const well = cssVar('--map-well', '#0a0d13');
  ctx.fillStyle = well;
  ctx.fillRect(0, 0, GRID * CELL, GRID * CELL);
  const green = cssVar('--map-green', '#3ddc84');
  const red = cssVar('--map-red', '#ff5c5c');
  // 下标即 code：0 不可比、3 无变化，两头留给"半档"与"满档"
  const inks = [null, mixHex(well, red, 1), mixHex(well, red, 0.5), null, mixHex(well, green, 0.5), mixHex(well, green, 1)];
  let touched = 0;
  for (let id = 0; id < codes.length; id++) {
    const ink = inks[codes[id]];
    if (!ink) continue;
    ctx.fillStyle = ink;
    ctx.fillRect((id % GRID) * CELL, Math.floor(id / GRID) * CELL, CELL - 1, CELL - 1);
    touched += 1;
  }
  return touched;
}
