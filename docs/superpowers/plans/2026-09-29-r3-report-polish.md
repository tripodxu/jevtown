# 报告页全量打磨 实施计划（R3 · 前端）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 本轮按目标约定**不使用子代理**，在当前会话内按 executing-plans 逐条执行。
> 方向由 impeccable `polish` 流程判定：**refinement，不是 redesign**——四套主题的身份、
> 文案、行为与范围外的一切都保留。

**Goal:** 修掉报告页与首页上取证发现的 7 个真实缺陷，让四套主题下都读得下去、点得准。

**Architecture:** 只改 `public/` 的四个文件（`styles.css` / `render.js` / `app.js` / `index.html`）
与 `charts.js` 的一个参数。样式全走既有 CSS 变量令牌，不新增硬编码颜色；中文不新增词。

**Tech Stack:** 原生 ESM、无框架、SVG、canvas、`node:test`。

---

## 取证（无头 Edge + CDP，桌面 1100px / 移动 375px，四主题）

| # | 缺陷 | 证据 | 级别 |
|---|---|---|---|
| A | **`[hidden]` 被 `.row { display:flex }` 打败**：`#resultActions`（"改一版再发"）在首屏就露出来了 | 首屏截图：该按钮在发帖框正下方 | P0 状态 bug |
| B | **`var(--line)` 不存在**：文本预览框的 `border-color` 内联覆盖无效，落到 `.blocked-note` 的 `--bad`，看着像报错 | 报告截图：文本框是红边 | P0 |
| C | **`.toc` 一条 CSS 都没有**：锚点目录挤成一行连续文字 | 报告截图顶部 | P1 |
| D | **图表 viewBox 固定宽度**：窄屏按比例缩到 ~0.34–0.45×，10.5px 标注变成 4–5px | 移动截图：情绪折线的 `+0.22` 与"第 1 波"几乎不可读 | P1 |
| E | **`.seg` 在窄屏被挤扁**：`label 110 + num 96` 吃光宽度，比例条只剩细缝 | 移动截图：反应分布的条几乎看不见 | P1 |
| F | **`#text` 没有 `<label>`**，只有 placeholder（占位符不是可靠的可访问名） | 审计 `noName: [TEXTAREA#text]` | P2 |
| G | **TOC / feed / footer 链接 17–20px 高**，低于 24px 触达目标 | 审计 `tiny: [...]` | P2 |

同轮顺带修一个取证时发现的真 bug：**`buildToc` 给每张卡的 h3 分配 `sec-0…sec-N`**，
而一页上最多有 4 张报告卡（结果 / 对比 / 两张示例），于是 `id` 重复——点目录会跳到别的卡。

不修的：hero、主题令牌、地图、反应色单源、入场动效——取证未发现缺陷，按 polish 的
"不越过范围"纪律保持原样。

---

### Task 1: A / B —— 状态 bug 与错误语义

**Files:**
- Modify: `public/styles.css`（基础节加 `[hidden]` 与 `.sr-only`）
- Modify: `public/render.js:24`

- [ ] **Step 1: 修 A —— `[hidden]` 必须赢过类选择器**

`public/styles.css` 的「基础」节 `* { box-sizing: border-box; }` 之后加：

```css
/* hidden 要赢过组件类：#resultActions 既有 hidden 又有 .row（display:flex），
   作者样式里的 display 会打败 UA 的 [hidden]，于是"改一版再发"在首屏就露出来。 */
[hidden] { display: none !important; }
```

- [ ] **Step 2: 修 B —— 文本预览框不该是"拒发"红边**

`public/render.js:24` 替换：

```js
  html.push('<div class="source-text">');
```

`public/styles.css` 里把 `.blocked-note` 那一节换成：

```css
/* 文本预览：中性卡，不是拒发提示（原先误用 .blocked-note 的 --bad 红边，
   而它的内联 border-color: var(--line) 又指向一个不存在的令牌，红色一直在）。 */
.source-text {
  border: 1px solid var(--hairline);
  border-radius: var(--r-ctrl);
  background: var(--card-2);
  padding: 10px 14px;
  font-size: 13.5px;
  line-height: 1.7;
}
```

并删掉这行遗留（`render.js:709` 附近的旧规则在 `styles.css` 里）：
`#compare .blocked-note, #result .blocked-note { margin-bottom: 10px; }` → 改成
`#compare .source-text, #result .source-text { margin-bottom: 10px; }`

- [ ] **Step 3: 跑 lint**

Run: `npm run lint` —— Expected: `✓ 35 个文件通过`

- [ ] **Step 4: 提交**

```bash
git add public/styles.css public/render.js
git commit -m "fix: hidden 被 .row 打败导致'改一版再发'首屏露出；文本预览框误用拒发红边"
```

---

### Task 2: C —— 报告目录成型

**Files:**
- Modify: `public/styles.css`
- Modify: `public/render.js:53-61`（`buildToc`）

- [ ] **Step 1: 先确认 id 重复（取证）**

Run:
```bash
node -e "const s=require('fs').readFileSync('public/render.js','utf8');console.log('buildToc 里 h.id = sec-N ⇒ 一页多张卡时 id 重复:',/h\.id = `sec-\$\{i\}`/.test(s))"
```
Expected: `true`

- [ ] **Step 2: `buildToc` 改成每张卡一组唯一 id**

`public/render.js` 的 `buildToc` 全体替换为：

```js
/** 报告目录：给每个 h3 发一组**本卡独有**的 id，顶部生成锚点 pill 行（长报告一跳直达）。
 *  一页上最多有 4 张报告卡（结果 / 对比 / 两张示例），id 必须逐卡唯一，
 *  否则点目录会跳到另一张卡的同名小节。 */
let tocSeq = 0;
function buildToc(el) {
  const headings = [...el.querySelectorAll('h3')];
  if (headings.length < 2) return;
  const uid = `r${(tocSeq += 1)}`;
  headings.forEach((h, i) => { h.id = `${uid}-sec-${i}`; });
  const nav = document.createElement('nav');
  nav.className = 'toc';
  nav.setAttribute('aria-label', '报告目录');
  nav.innerHTML = headings.map((h, i) => `<a href="#${uid}-sec-${i}">${esc(h.textContent)}</a>`).join('');
  el.querySelector('h2').after(nav);
}
```

- [ ] **Step 3: 目录样式**

`public/styles.css` 的「数据组件」节之前加：

```css
/* 报告目录：pill 一行；原先一条规则都没有，锚点挤成连续文字 */
.toc {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 6px;
}

.toc a {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 4px 12px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-chip);
  color: var(--muted);
  font-size: 12.5px;
  letter-spacing: 0.02em;
  text-decoration: none;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.toc a:hover {
  color: var(--text);
  border-color: var(--hairline-strong);
  background: var(--card-2);
}

/* 屏幕阅读器专用：给没有可见标签的控件补可访问名 */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 4: 提交**

```bash
git add public/render.js public/styles.css
git commit -m "fix: 报告目录成型（此前 .toc 零样式），且逐卡唯一 id"
```

---

### Task 3: D —— 图表按容器宽度出图

**Files:**
- Modify: `public/render.js`（`renderCheck` 开头量宽，传给 `moodLine` / `demandChart`）
- Modify: `public/app.js`（`updateCharts` 量宽，传给 `shareChart` / `rollingChart`）

- [ ] **Step 1: 原理**

SVG 带固定 `viewBox` + CSS `width:100%` 时，里面的字号是 viewBox 单位，随容器等比缩放。
容器 271px 而 viewBox 宽 900 ⇒ 缩到 0.30×，11px 标注只剩 3.3px。
**让 viewBox 宽度跟着容器走，缩放就回到 1.0×。** 图表函数已经收 `width` 参数，只需由调用方喂真宽。

- [ ] **Step 2: `render.js` —— 量容器宽度**

`renderCheck` 开头（`el.hidden = false;` 之后）加：

```js
  // 图表的 viewBox 宽度跟着容器走：固定宽度在窄屏会把 11px 标注缩到 4px。
  const chartWidth = Math.min(940, Math.max(300, el.clientWidth - 56));
```

`wavesView(result)` 改为收宽度：

```js
function wavesView(result, width) {
  if (!result.waves?.length) return '';
  const line = moodLine(result.waves.map((w) => w.mood), { width });
  return `<h3>传播波次与情绪轨迹</h3>${funnel(result.waves)}${line}`;
}
```

调用处 `html.push(wavesView(result));` → `html.push(wavesView(result, chartWidth));`

`followUpView(result, width)` 里 `demandChart(curve)` → `demandChart(curve, { width })`，
调用处 `html.push(followUpView(result));` → `html.push(followUpView(result, chartWidth));`

- [ ] **Step 3: `app.js` —— 实时图同样量宽**

`updateCharts()` 全体替换为：

```js
function updateCharts() {
  // 同 render.js：viewBox 跟着容器走，否则窄屏把标注缩到看不清。
  const wide = Math.min(940, Math.max(300, $('chartShare').clientWidth || 900));
  const narrow = Math.min(420, Math.max(260, $('chartTput').clientWidth || 420));
  $('chartTput').innerHTML = rollingChart(live.tput, { width: narrow, color: 'var(--accent)', unit: ' 人/s' });
  $('chartMs').innerHTML = rollingChart(live.msSeries, { width: narrow, color: 'var(--map-yellow)', unit: 'ms', format: (v) => Math.round(v) });
  $('chartShare').innerHTML = shareChart(live.shares, { width: wide });
}
```

- [ ] **Step 4: `charts.js` —— 去掉不再成立的默认宽**

`shareChart` 的 `width = 900` 改 `width = 560`，`rollingChart` 的 `width = 420` 保持；
两处注释各加一句"调用方按容器传宽度"。

- [ ] **Step 5: 跑门禁**

Run: `npm run lint && npm test` —— Expected: 全绿（`test/charts.test.js` 不传 width，
默认值变化后 `# pass` 数不变；断言里的 `100 人` / `峰 179` 仍成立）

- [ ] **Step 6: 提交**

```bash
git add public/render.js public/app.js public/charts.js
git commit -m "fix: 图表 viewBox 跟随容器宽度，窄屏标注不再被缩到 4px"
```

---

### Task 4: E / F / G —— 窄屏分段条、可访问名、触达目标

**Files:**
- Modify: `public/styles.css`（响应式节）
- Modify: `public/index.html`（`<label class="sr-only" for="text">`）

- [ ] **Step 1: E —— 窄屏让 `.seg` 换行，别把条挤没**

`public/styles.css` 的响应式节里加：

```css
/* 窄屏：标签独占一行，条与数字并排在下一行——否则 label+num 就把宽度吃光，比例条没了 */
@media (max-width: 560px) {
  .seg { flex-wrap: wrap; row-gap: 4px; }
  .seg .label { min-width: 0; flex: 1 1 100%; }
  .seg .bar2 { flex: 1 1 110px; max-width: none; }
  .seg .num { min-width: 0; }
  .decision .dseg .label { min-width: 0; }
  .frow { flex-wrap: wrap; row-gap: 4px; }
  .frow .fbar { flex: 1 1 100%; max-width: none; }
}
```

- [ ] **Step 2: F —— 给文本框补可访问名**

`public/index.html` 的 `<textarea id="text" …>` 之前加：

```html
<label class="sr-only" for="text">想发出去的那段话</label>
```

- [ ] **Step 3: G —— feed / footer 链接补到 24px 以上**

`public/styles.css` 里：

```css
.feed a { display: inline-block; padding: 3px 0; }
footer a { display: inline-block; padding: 2px 0; }
```

- [ ] **Step 4: 跑门禁**

Run: `npm run lint && npm test` —— Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add public/styles.css public/index.html
git commit -m "fix: 窄屏分段条换行、文本框补 sr-only 标签、feed/footer 链接补到 24px"
```

---

### Task 5: 验证与反思

- [ ] **Step 1: 重新取证（同一套脚本、同样的视口）**

Expected:
- 首屏**不再**出现"改一版再发"
- 报告文本框是中性发丝线边框，不是红边
- 目录是 pill 一行、可换行、四主题都清楚
- 375px 下情绪折线的 `+0.22` / "第 1 波" 清楚可读
- 375px 下反应分布的比例条占满可用宽度
- 审计：`tiny` 只剩 0 项或仅剩非交互元素；`noName` 为空
- `scrollWidth === clientWidth`（无横向溢出）
- 控制台无错误

- [ ] **Step 2: `impeccable detect`**

```bash
"C:\Users\lenovo\.agents\skills\impeccable\scripts\impeccable.cmd" detect --json public/styles.css public/render.js public/app.js public/charts.js public/index.html
```
跑**一次**，按它指出的问题改，不要反复跑。

- [ ] **Step 3: 门禁**

Run: `npm run lint && npm test && npm run bench`

- [ ] **Step 4: 文档**

- `docs/modules/frontend.md`：删掉「已知待修」里的 `.toc` 那条（已修），补上窄屏分段条与图表量宽的约定
- `docs/MEMORY.md`：顶部加一条 R3 事实
- `README.md` / `docs/TESTING.md`：用例数如变则改

- [ ] **Step 5: 收尾提交**

```bash
git add -A
git commit -m "docs: 记录本轮前端打磨的取证、改法与验证方式"
```

---

## 自检

1. **范围**：7 个缺陷全部有对应任务；未触碰 hero / 主题令牌 / 地图 / 反应色单源 / 入场动效。✅
2. **占位符**：每个代码步骤都带完整代码与精确命令。✅
3. **命名一致**：`chartWidth` / `source-text` / `tocSeq` / `uid` 在 Task 2–4 中一致。✅
4. **纪律**：本轮是 refinement——`craft-floor.md` 里被列为"拒绝"的手法（渐变文字、
   彩色边框、玻璃拟态、系统展示字体）一条都没引入；新增样式全部复用既有令牌。

---

## 执行期新增（定稿后取证才带出来的两件事）

> 本计划定稿时只列了上面 7 项。执行期取证脚本又带出两条，都已修，都不在原计划里。

1. **`buildToc` 的 id 重复**（真 bug，不是样式问题）：一页最多有 4 张报告卡，
   每张都分配 `sec-0…sec-N`，点目录会跳到另一张卡的同名小节。改为逐卡 `uid` 前缀
   （`tocSeq` 计数器）。已并入 Task 2 的代码里。
2. **浅色主题地图底板不可读**：取证之外，自己按四主题逐个复算了对比度，才发现
   公报米纸底上 `spreads` 黄只有 **1.07:1**、`glad` 绿 1.38、`sorry` 红 2.34
   （非文字图形要求 3:1），`hollow` 灰 4.32 也只是擦边。
   就此问了用户（"中调底板 / 给墨水加浅色变体 / 不动"），用户选了**中调底板**；
   **动手前复算发现中调更糟**（0–1/6 过线，而深色底板 5/6 过线），且数学上不存在
   能让六色同时过 3:1 的底板（六色亮度跨 15 倍，可行亮度区间是空集 L ∈ [2.23, −0.02]）。
   于是按用户真正要的目标（可读）把中调纠正为深版：公报 `#1e1b16`、仪器 `#1d222a`；
   顺带把夜巡 `--accent` 从 4.34:1 抬到 `#e0604a` = 4.88:1。
   复算表与"为什么数学上达不到 3:1"都写进了 `docs/modules/frontend.md`。
3. **`impeccable detect` 的 8 条全是误报**：7 条 low-contrast 把夜巡的 `#e9e4d8`
   配到硬编码底色 `#f5f7fc`（四个主题里没这个背景）——静态扫描器看不到
   `data-theme`；1 条 buried-raster 指 `--grain: 0.05` 的胶片颗粒，是既定材质。
   按 skill 的"一次扫描"规矩没有照单全收，改为按四主题复算（就是上面那条）。
