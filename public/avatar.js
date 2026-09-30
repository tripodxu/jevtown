// 人格头像：由 persona id 确定性生成的 5×5 镜像徽章（经典 identicon——左 3 列生成、
// 右 2 列镜像，对称才像一张"脸"）。同一 id 永远同一张脸，与引擎的确定性纪律同源。
// 颜色只取主题令牌：格子 = --accent 的浓淡（hash 决定），底 = --card-2，四主题自动跟随。
import { hash32 } from './shared/rng.js';

export function avatarSvg(pool, id, { size = 40 } = {}) {
  let bit = hash32('avatar', pool, id) >>> 0;
  const nextBit = () => {
    bit = (bit * 1103515245 + 12345) >>> 0; // LCG：从 seed 走出格子位流
    return (bit >>> 16) & 255;
  };
  const cells = [];
  for (let x = 0; x < 3; x++) {
    for (let y = 0; y < 5; y++) {
      const v = nextBit();
      if (v < 110) continue; // ~43% 留空，脸才有形状
      const opacity = (0.35 + (v % 55) / 100).toFixed(2); // 0.35–0.89 的 accent 浓淡
      for (const cx of [x, 4 - x]) {
        cells.push(`<rect x="${cx * 8}" y="${y * 8}" width="8" height="8" style="fill:var(--accent);opacity:${opacity}" />`);
      }
    }
  }
  return `<svg class="avatar" viewBox="0 0 40 40" width="${size}" height="${size}" role="img" aria-label="人格头像（程序生成）">` +
    `<rect width="40" height="40" rx="10" style="fill:var(--card-2)" />${cells.join('')}</svg>`;
}
