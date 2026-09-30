// 人格头像：确定性 identicon 的行为约定。纯字符串构建，Node 直接测。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avatarSvg } from '../public/avatar.js';

test('avatarSvg：同一 id 永远同一张脸（确定性）', () => {
  assert.equal(avatarSvg('zh', 4321), avatarSvg('zh', 4321));
  assert.notEqual(avatarSvg('zh', 4321), avatarSvg('zh', 4322), '不同 id 大概率不同脸');
});

test('avatarSvg：镜像对称——每个出现的列 x 必有配对列 4-x', () => {
  for (const id of [0, 1, 777, 4321, 9999]) {
    const svg = avatarSvg('zh', id);
    const counts = new Map();
    for (const match of svg.matchAll(/<rect x="(\d+)"/g)) {
      const x = Number(match[1]) / 8; // 像素 → 格列
      counts.set(x, (counts.get(x) ?? 0) + 1);
    }
    let total = 0;
    for (const [x, n] of counts) {
      total += n;
      if (x === 2) continue; // 中列自成对称
      assert.equal(counts.get(4 - x), n, `列 ${x} 与 ${4 - x} 必须成对（id ${id}）`);
    }
    assert.ok(total >= 4, `id ${id} 的格子太少，不成脸`);
    assert.ok(total <= 30, `id ${id} 的格子太多，糊成一团`);
  }
});

test('avatarSvg：颜色只取主题令牌，尺寸可调', () => {
  const svg = avatarSvg('zh', 4321, { size: 32 });
  assert.ok(svg.includes('var(--accent)'), '格子墨水 = 主题强调色');
  assert.ok(svg.includes('var(--card-2)'), '底 = 卡片次级底色');
  assert.ok(!/#[0-9a-f]{3,8}/i.test(svg), '不许有硬编码色值');
  assert.ok(svg.includes('width="32"'));
  assert.ok(svg.includes('aria-label'), '可访问名就位');
});
