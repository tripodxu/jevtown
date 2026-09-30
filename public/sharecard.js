// 分享卡片：把一次检查的关键读数与小镇地图快照合成 1200×630 的 PNG（R20）。
// 颜色取当前主题令牌的 computed 值（卡片随主题）；数据全部来自既有报告 payload，
// 不做任何新计算、不新增 Jev 调用。命令式 canvas 绘制——与 charts.js 的 SVG 字符串路线不同源。
import { TERRAIN_VERDICT_ZH } from './shared/labels.js';

const cssVar = (name, fallback) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

const FONT_BODY = '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
const FONT_MONO = '"Cascadia Mono", Consolas, monospace';

/**
 * 合成分享卡片。view = GET /api/post 的 payload；mapCanvas = 报告里的反应地图画布。
 * 返回离屏 canvas（调用方负责 toBlob/下载）。
 */
export function renderShareCard(view, mapCanvas) {
  const W = 1200;
  const H = 630;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const bg = cssVar('--bg', '#0d1017');
  const card = cssVar('--card', '#151b27');
  const text = cssVar('--text', '#e9e4d8');
  const muted = cssVar('--muted', '#9aa3b2');
  const accent = cssVar('--accent', '#e0604a');
  const hairline = cssVar('--hairline-strong', 'rgba(233,228,216,0.2)');

  // 底与卡
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = card;
  roundRect(ctx, 40, 40, W - 80, H - 80, 24);
  ctx.fill();
  ctx.strokeStyle = hairline;
  ctx.lineWidth = 1;
  roundRect(ctx, 40, 40, W - 80, H - 80, 24);
  ctx.stroke();

  // 标题区：预设名词 + 文本摘录（≤2 行）
  const presetZh = { post: '帖子', listing: '闲置转让', product: '商品文案', headline: '标题' }[view.post.preset] ?? '检查';
  ctx.fillStyle = muted;
  ctx.font = `600 20px ${FONT_BODY}`;
  ctx.fillText('中文小镇 · 由 Jev 逐格判定', 90, 108);
  ctx.fillStyle = text;
  ctx.font = `700 40px ${FONT_BODY}`;
  wrapText(ctx, view.post.text, 90, 168, 620, 52, 2);

  // KPI：逐格判定 / 停下 / 乐见 / 反感
  const kpis = [
    [view.counters.reach, 'Jev 逐格判定'],
    [view.counters.stopped, '停下来'],
    [view.counters.glad, '乐见'],
    [view.counters.sorry, '反感'],
  ];
  kpis.forEach(([value, label], i) => {
    const x = 90 + i * 155;
    ctx.fillStyle = i === 0 ? text : i === 2 ? cssVar('--map-green', '#3ddc84') : i === 3 ? cssVar('--map-red', '#ff5c5c') : text;
    ctx.font = `600 44px ${FONT_MONO}`;
    ctx.fillText(Number(value).toLocaleString(), x, 380);
    ctx.fillStyle = muted;
    ctx.font = `500 18px ${FONT_BODY}`;
    ctx.fillText(label, x, 412);
  });

  // 地形判定一行（标签走 labels.js 单源，别再造一份措辞）
  const verdict = view.terrain && view.terrain.morans !== null
    ? (TERRAIN_VERDICT_ZH[view.terrain.verdict] ?? '')
    : '';
  if (verdict) {
    ctx.fillStyle = accent;
    ctx.font = `600 20px ${FONT_BODY}`;
    ctx.fillText(`这次反应${verdict}`, 90, 486);
  }

  // 出处行
  ctx.fillStyle = muted;
  ctx.font = `16px ${FONT_BODY}`;
  ctx.fillText(`jevtown · ${new Date(view.post.created_at).toLocaleDateString('zh-CN')}`, 90, 610);

  // 右侧：地图快照（原画布 drawImage，含边框）
  if (mapCanvas) {
    ctx.save();
    roundRect(ctx, 740, 105, 420, 420, 16);
    ctx.clip();
    ctx.drawImage(mapCanvas, 740, 105, 420, 420);
    ctx.restore();
    ctx.strokeStyle = hairline;
    roundRect(ctx, 740, 105, 420, 420, 16);
    ctx.stroke();
  }

  return canvas;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 逐字换行的简化中文折行（按测量宽度），maxLines 截断加省略号。 */
function wrapText(ctx, content, x, y, maxWidth, lineHeight, maxLines) {
  let line = '';
  let lines = 0;
  for (const ch of content) {
    if (ctx.measureText(line + ch).width > maxWidth) {
      lines += 1;
      ctx.fillText(line, x, y + (lines - 1) * lineHeight);
      line = ch;
      if (lines >= maxLines) {
        ctx.fillText('……', x, y + (lines - 1) * lineHeight);
        return;
      }
    } else {
      line += ch;
    }
  }
  if (line) ctx.fillText(line, x, y + lines * lineHeight);
}
