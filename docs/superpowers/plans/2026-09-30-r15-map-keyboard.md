# R15 · 前端轮：地图键盘可达——方向键逐格导航 + 光标格高亮

> 轮换位置：R14 创意 ⇒ **R15 前端** ⇒ R16 优化。
> Design Read（taste-skill §0.B，preserve 纪律同 R12）：Operate 型产品界面，四主题令牌保留。
> 依据：impeccable polish 的「keyboard focus」与 WCAG——地图是报告的核心读数，目前
> 对键盘用户完全不可达（canvas 无 tabindex、无键位、hover 档案摸不到）。

## 设计（对齐既有交互语义）

- 报告地图 canvas 加 `tabindex="0"`，aria-label 补一句键盘用法。
- **方向键移动光标格**（`stepCell(id, key)` 纯函数：上下左右 = ±GRID/±1，越界返回 -1 不动），
  每步**立即揭示该格档案**（复用 attachTooltip 的 render/place——tooltip 带 `role="status"`，
  SR 免费获得逐格播报）；Escape 收起。
- **光标格高亮**：`cursorByCanvas`（WeakMap）登记光标 id；`paint()` 末尾若有光标则以
  `--accent` 描一格（UI 色，不是数据色）；移动时直接在当前 ctx 上补描（无重排）；
  全量重画（换主题/换视图）自动把光标画回来。悬停档案的 `tipOff`（传播层）同样禁用键盘导航。
- 触摸/鼠标路径不动（pointer 事件与键盘各走各的，共用 render/place）。

## 改动

1. `grid.js`：+`stepCell`（导出，纯函数）；`attachTooltip` 内加 keydown/blur 接线与
   光标绘制；`paint()` 末尾描光标。
2. `render.js`：报告地图 canvas 加 `tabindex="0"`，aria-label 补键盘提示。
3. `test/grid.test.js`：+`stepCell` 用例（四向移动 + 四边越界）。

## 验收

- [ ] `npm run lint` ✓；`npm test` ≥ 110
- [ ] E2E：Tab 聚焦地图 → ArrowRight×3 → tooltip 显示第 4 格人格、光标描边存在；
      Escape 收起；传播层（tipOff）上键盘不动作；窄屏无溢出；控制台零错误
