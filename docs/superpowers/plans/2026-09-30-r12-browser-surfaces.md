# R12 · 前端轮：浏览器界面细节（滚动条 / 光标 / 焦点落点）

> 轮换位置：R11 创意 ⇒ **R12 前端** ⇒ R13 优化。
> Design Read（taste-skill §0.B）：jevtown 是 **Operate 型产品界面**（报告/监控），四主题
> 令牌体系已确立 → **Redesign-Preserve**；taste-skill 自述不覆盖 dashboard 类 UI（§13），
> 本轮只取其纪律（保留既有体系、不引入新字体/色板），技术依据以 impeccable craft-floor
> 的「Browser surfaces」条目为准：*文本选区、光标、滚动条、焦点环这些没被画出来的部件
> 也带着设计——把它们主题化，是"被建造"与"被拼装"的分界线。*

## 取证（代码级，2026-09-30）

- 页面主滚动条与 `.monitor-wrap` 的滚动条走 **浏览器默认**：`color-scheme` 让暗色主题
  拿到暗滚动条（已对），但形态是系统默认的宽轨道，与 `.toc` 已主题化的细滚动条不一致。
- `textarea`/`input` 的插入光标是 UA 默认色，未跟主题令牌。
- **焦点落点缺口**：`showResult()` 渲染完报告后 `scrollIntoView`，但焦点留在触发处
  （feed 链接/表单按钮）——键盘用户按 Tab 会从页面顶部继续，屏幕阅读器不播报"报告已打开"。

## 改动（全部小步）

1. **滚动条主题化**：`:root` 加 `scrollbar-width: thin; scrollbar-color: var(--hairline-strong) transparent;`
   ——两个属性都是继承属性，页面所有滚动容器（主滚动、监控表、窄屏 toc）一次到位；
   `.toc` 自己的 webkit 细滚动条保留不动。
2. **光标色**：`textarea, input { caret-color: var(--accent); }`。
3. **焦点落点**：`renderCheck` 给报告 h2 加 `tabindex="-1"`；`app.js` 的 `showResult`
   在 `scrollIntoView` 前 `h2.focus({ preventScroll: true })`——键盘与屏幕阅读器随视线走。

## 不做（范围纪律）

- 图表 hover 读数、地图键盘导航、打印样式——各自值得独立一轮，不混。
- `::-webkit-scrollbar` 全局规则——Chromium 121+/Firefox 已支持标准 `scrollbar-color`，
  不为旧内核加双份规则。

## 验收

- [ ] `npm run lint` ✓；`npm test` 103/103（CSS/DOM 改动无可测纯函数，不加用例）
- [ ] E2E：主滚动条 computed `scrollbar-color` 生效；textarea caret 色为主题 accent；
      深链打开报告后 `document.activeElement` 是报告 h2；窄屏无溢出回归；控制台零错误
