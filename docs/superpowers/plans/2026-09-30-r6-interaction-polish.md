# R6 · 前端轮：交互可达性细节打磨（tooltip / 触摸 / 深链 / 焦点）

> 轮换位置：R1 优化 → R2 创意 → R3 前端 → R4 优化 → R5 创意 ⇒ **R6 前端**。
> 方向判定：`impeccable context` = `SCOPED_EXISTING_ALLOWED`，**refinement 不是 redesign**——
> 四主题令牌体系、文案、地图绘制逻辑、入场动效一律不动；只修取证到的交互缺陷。

## 取证（无头 Edge + CDP，2026-09-30）

静态审计（1100/375 × 四主题）：无横向溢出、无控制台错误、`noName` 仅两例误报
（textarea/input 的可访问名来自 `label for`，审计脚本不识别）。窄屏 5 个"越界"A 元素
全部是 `.toc` 目录的内部横滚 pill（父容器 `overflow-x: auto`），预期行为。

交互探针抓到 **1 个真缺陷 + 2 个可达性缺口**：

| # | 缺陷 | 证据 |
|---|---|---|
| 1 | 悬停地图下半部时 tooltip 越出视口底部，被裁掉看不见 | 画布部分在折叠线下时悬停下缘：`tipBottom=3487 / vh=805`（`grid.js` 的 attachTooltip 恒 `clientY + 14`，无视口钳制） |
| 2 | 触摸设备点不出人格档案：tooltip 只挂在 `mousemove` | 代码路径只有 mousemove/mouseleave；手机上地图悬停=无 |
| 3 | feed 链接用 `javascript:` URL，不能中键/新标签打开，刷新即丢 | `app.js` loadFeed：`href="javascript:openPost('${id}')"` |

顺带两处小的可达性缺口（同一主题，一并修）：检查全程 `#statusLine` 对屏幕阅读器
静默（无 `role="status"`）；「看全部 N 条声音」按钮展开后自我删除，焦点掉回 body。

## 改动（全部小步，不新增依赖）

1. **tooltip 视口钳制**（`grid.js`）：抽出纯函数 `clampTip(x, y, w, h, vw, vh)`——
   右缘溢出翻到光标左侧、下缘溢出翻到光标上方，再钳进视口留 12px 边距。
   attachTooltip 改用它定位。纯函数配单测（右下角/左上角/小视口三向）。
2. **触摸支持**（`grid.js`）：canvas 补 `click` → 同一位置显示档案；同格再点隐藏
   （toggle）。桌面 click 也走同一路径，行为无害。tooltip 由 tap 打开时也走钳制。
3. **feed 深链**（`app.js`）：`javascript:` URL 改为真 `href="/?post=<id>"` +
   click 拦截（`pushState` 记 URL，回退键可关报告）；页面载入时读 `?post=` 直接打开
   对应报告——结果页从此可以分享/刷新/收藏。
4. **状态行播报**（`index.html`）：`#statusLine` 加 `role="status"`，检查进度对
   屏幕阅读器可见。
5. **voices 展开焦点**（`app.js`）：按钮删除后把焦点交给第一张新展开的声音卡
   （卡片补 `tabindex="-1"`）。

## 不做（范围纪律）

- hero、主题令牌、反应色单源、地图绘制算法、入场动效、报告结构——取证未发现缺陷。
- 图表 hover 读数、打印样式——记入后续轮候选，不在本轮混做。

## 验收

- [ ] `npm run lint` 全绿；`npm test` ≥ 87（新增 clampTip 用例）
- [ ] CDP 复测：折叠线下的画布悬停下缘，tooltip 完整可见（`overB=false`）
- [ ] 触摸路径：`dispatchEvent(new MouseEvent('click', …))` 出档案、同格再点隐藏
- [ ] `/?post=<id>` 直接打开报告；feed 链接 href 为真 URL；回退键回到首页
- [ ] 窄屏 375 四主题无横向溢出回归；控制台零错误
