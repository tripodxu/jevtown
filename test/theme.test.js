// 四套主题的令牌对比度（R30）。令牌是手调的，调完没人看得见数字——这次把 WCAG AA
// 写成断言：任何一次「为了好看把灰调浅」都会在这里失败，而不是等用户投诉。
// 背景取四套主题各自最暗/最亮的表面（--inset 最深，--card-2 次之），逐对算相对亮度。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

/**
 * 按 CSS 块取令牌。 night 是 `:root,` + `:root[data-theme="night"] {` 合并块，
 * 其余是单选择器块——从选择器锚点回退到最近的 `{`，再切到块尾的 `}`。
 */
const blockOf = (theme) => {
  const anchor = css.indexOf(`:root[data-theme="${theme}"] {`);
  assert.notEqual(anchor, -1, `styles.css 里找不到主题块：${theme}`);
  const start = css.lastIndexOf('{', anchor);
  return css.slice(start + 1, css.indexOf('}', anchor));
};

/**
 * 主题块 + 基础 `:root` 块里的令牌，值解析成字面十六进制。
 * 声明值可能是 `#rrggbb`，也可能是 `var(--别的令牌)`（面版墨水在暗色主题里就是这么写的：
 * 面就是地图墨水本身）。`var()` 一路跟到字面值，跟不到就抛错——宁可在测试里炸，
 * 也不要静默跳过某个令牌然后报一个假的通过。
 */
const tokensOf = (theme) => {
  const raw = {};
  for (const block of [baseBlock, blockOf(theme)]) {
    for (const line of block.split(/\r?\n/)) {
      const m = line.match(/^\s*(--[a-z0-9-]+):\s*([^;]+);/);
      if (m) raw[m[1]] = m[2].trim();
    }
  }
  const resolve = (name, depth = 0) => {
    const value = raw[name];
    assert.ok(value, `styles.css 里没有令牌 ${name}`);
    if (value.startsWith('#')) return value;
    assert.ok(depth < 8, `令牌 ${name} 的 var() 套得太深，怕是有环`);
    const ref = value.match(/^var\(\s*(--[a-z0-9-]+)/);
    assert.ok(ref, `令牌 ${name} 的值既不是十六进制也不是 var()：${value}`);
    return resolve(ref[1], depth + 1);
  };
  const out = {};
  for (const name of Object.keys(raw)) {
    if (/^(#[0-9a-fA-F]{3,8}\b|var\()/.test(raw[name])) out[name] = resolve(name);
  }
  return out;
};

/** `:root { ... }` 基础块：只有地图墨水与暗色主题的面版缺省值。 */
const baseBlock = (() => {
  const start = css.indexOf(':root {');
  return css.slice(start + 1, css.indexOf('}', start));
})();

const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

const THEMES = ['night', 'bulletin', 'instrument', 'classic'];
const SURFACES = ['--bg', '--card', '--card-2', '--inset'];
const INK = ['--text', '--muted', '--accent', '--ok', '--bad'];

test('四套主题的文字/表面令牌对全部 ≥ 4.5:1（WCAG AA）', () => {
  for (const theme of THEMES) {
    const t = tokensOf(theme);
    for (const surface of SURFACES) {
      assert.ok(t[surface], `${theme} 缺 ${surface}`);
      for (const ink of INK) {
        const r = contrast(t[ink], t[surface]);
        assert.ok(r >= 4.5, `${theme} ${ink}(${t[ink]}) 在 ${surface}(${t[surface]}) 上只有 ${r.toFixed(2)}:1`);
      }
    }
    assert.ok(contrast(t['--btn-ink'], t['--btn-bg']) >= 4.5, `${theme} 按钮文字不足 4.5:1`);
  }
});

test('令牌完整性：每套主题都有文本、表面与地图底板', () => {
  for (const theme of THEMES) {
    const t = tokensOf(theme);
    for (const name of ['--bg', '--card', '--card-2', '--inset', '--text', '--muted', '--accent', '--map-well']) {
      assert.ok(t[name], `${theme} 缺 ${name}`);
    }
  }
});

// 面版墨水（--face-*，见 public/inks.js）：四个信号色是条/堆叠段/图例点/图表的颜色，
// 全部直接压在卡片表面上，所以按非文字图形的 3:1 判。背景级三色（dark/scrolled/hollow）
// 本身就是"越不显眼越好"的背景语义，只断言它们齐备，不设下限——断言下限反而会逼着人
// 把"没轮到他"的格子调亮，那正是它们该退掉的地方。
const FACE_SIGNAL = ['--face-stopped', '--face-glad', '--face-spreads', '--face-sorry'];
const FACE_BACK = ['--face-dark', '--face-scrolled', '--face-hollow'];

test('面版信号墨水在四种表面上全部 ≥ 3:1（非文字图形）', () => {
  for (const theme of THEMES) {
    const t = tokensOf(theme);
    for (const surface of ['--bg', '--card', '--card-2', '--inset']) {
      for (const ink of FACE_SIGNAL) {
        assert.ok(t[ink], `${theme} 缺 ${ink}`);
        const r = contrast(t[ink], t[surface]);
        assert.ok(r >= 3, `${theme} ${ink}(${t[ink]}) 在 ${surface}(${t[surface]}) 上只有 ${r.toFixed(2)}:1`);
      }
    }
  }
});

// R35 的对账节新增了一处文字用色：`.aud-tag` 边框直接用了 `--face-glad`，而 `.aud-state`
// 的四个状态小标题是 12.5px 的文字——它们都在 --card-2 上，都得按文字 4.5:1 判，不能借用
// 上一组 3:1 的图形豁免。
test('对账节的两处新墨水在 --card-2 上过文字级 4.5:1（R35 的 .aud-tag / .aud-state）', () => {
  for (const theme of THEMES) {
    const t = tokensOf(theme);
    for (const ink of ['--face-glad', '--muted']) {
      const r = contrast(t[ink], t['--card-2']);
      assert.ok(r >= 4.5, `${theme} ${ink}(${t[ink]}) 在 --card-2(${t['--card-2']}) 上只有 ${r.toFixed(2)}:1`);
    }
  }
});

test('面版墨水七色齐备，且地图底板墨水在地图上仍过 3:1（地图那条路径没被面版改坏）', () => {
  for (const theme of THEMES) {
    const t = tokensOf(theme);
    for (const name of [...FACE_SIGNAL, ...FACE_BACK]) {
      assert.ok(t[name], `${theme} 缺 ${name}`);
    }
    const map = tokensOf(theme);
    for (const [ink, name] of [['--map-blue', 'stopped'], ['--map-green', 'glad'], ['--map-yellow', 'spreads'], ['--map-red', 'sorry']]) {
      const r = contrast(map[ink], map['--map-well']);
      assert.ok(r >= 3, `${theme} 地图 ${name}(${map[ink]}) 在底板(${map['--map-well']}) 上只有 ${r.toFixed(2)}:1`);
    }
  }
});

// ------------------------------------------------------------------
// 排版纪律（R33）。这些不是对比度，是「看不见但一坏就毁掉一栏数字」的东西，
// 所以也钉死：对比度坏了有人抱怨，列宽错了只会被当成「风格」。
// ------------------------------------------------------------------

const bodyBlock = (() => {
  const start = css.indexOf('body {');
  assert.notEqual(start, -1, 'styles.css 里找不到 body 块');
  return css.slice(start, css.indexOf('}', start));
})();

test('数字对齐不靠字体运气：body 打开 tabular-nums（R33）', () => {
  // --font-mono 的兜底项是通用 monospace，在部分 Android/旧环境会落到比例数字字体，
  // 于是表格列左右晃。17 处数据字体用这个栈，所以对齐必须由 CSS 兜底而不是碰运气。
  assert.match(bodyBlock, /font-variant-numeric:\s*tabular-nums/);
  // 全站只许有一处，且值必须是 tabular-nums：多写一处就是有人局部改回去的意思。
  const hits = css.match(/font-variant-numeric:\s*[a-z-]+/g) ?? [];
  assert.equal(hits.length, 1, `font-variant-numeric 出现了 ${hits.length} 次：${hits.join(' | ')}`);
  assert.match(hits[0], /tabular-nums/);
});

/** 取某个媒体查询块里的规则文本（按 max-width 升序取第一个匹配到的）。 */
const mediaBlock = (width) => {
  const at = css.indexOf(`@media (max-width: ${width}px) {`);
  assert.notEqual(at, -1, `styles.css 里找不到 @media (max-width: ${width}px)`);
  const start = css.indexOf('{', at);
  let depth = 0;
  for (let i = start; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}' && (depth -= 1) === 0) return css.slice(start + 1, i);
  }
  throw new Error('@media 块没有收尾');
};

// .arow 是 R32 的逐句承重一行：标号 + 原句 + 双向条 + 人话 + 组数。
// 宽屏五列；1080px 以下句子会被压到 ~120px（一句 20 字中文折成八行），所以那里
// 必须改成「句子占满整行 + 条与数字另起一行」；760px 以下再逐格落下。
test('逐句承重那一行在中等宽度不被挤碎（R33）', () => {
  assert.match(css, /\.arow \{[^}]*grid-template-columns: 76px/, '宽屏基线仍是五列的左起固定列');
  const mid = mediaBlock(1080);
  assert.match(mid, /\.arow \{[^}]*grid-template-columns:/, '1080px 那一档要改列');
  assert.match(mid, /\.arow \.apart \{[^}]*grid-row: 1/, '句子要提到第一行独占宽度');
  assert.match(mid, /\.arow \.atwin \{[^}]*grid-row: 2/, '条落到第二行，不与句子抢宽度');
  assert.match(mid, /\.arow \.fnum \{[^}]*grid-row: 3/, '组数单独一行：它有 18 个字符宽，与条并排会两边都挤短');
  const narrow = mediaBlock(760);
  assert.match(narrow, /\.arow \.apart \{[^}]*grid-column: 2/, '窄屏句子缩进让开标号，同行可读');
  assert.match(narrow, /\.arow \.fsay \{[^}]*grid-row: 3/, '人话自己一行');
});

test('正文行长落在可读区间：容器不超 1050px（craft floor）', () => {
  const max = Number(bodyBlock.match(/max-width:\s*(\d+)px/)?.[1]);
  assert.ok(max, 'body 的 max-width 没写成 px 字面量');
  // 15px 汉字一行约 15px 宽 → 1050 - 40(padding) - 48(.plate padding) ≈ 64 字，
  // 等效 128 西文字符，仍在 65–75ch 的舒适区外面一点但不到越界。
  // 断言的是「上限」而不是某个精确值：再宽就该出现一行读不到底的正文。
  assert.ok(max <= 1050, `容器 ${max}px 太宽，正文一行会超过 70 个汉字`);
  assert.ok(max >= 720, `容器 ${max}px 太窄，两栏仪表会挤`);
});

test('正文行长可读 + 数据一律等宽：令牌与规则没有被拆开', () => {
  // body 用 font: 15px/1.7 var(--font-body) 简写，行高写在简写里不是独立声明。
  assert.match(bodyBlock, /font:\s*15px\/1\.[6-9]/, '正文行高 1.7 附近，太紧读不动 15px 中文');
  assert.match(css, /--font-mono:\s*ui-monospace/, '数据字体栈以 ui-monospace 起头，保证数字等宽');
  // 等宽栈的兜底必须留着最后一个通用 monospace：把它换成别的会掉到比例数字字体。
  assert.match(css, /--font-mono:[^;]*\bmonospace\s*;/);
});
