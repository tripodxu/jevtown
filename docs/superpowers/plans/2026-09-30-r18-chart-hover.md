# R18 · 前端轮：实时监控图表的悬停读数

> 轮换位置：R17 创意 ⇒ **R18 前端** ⇒ R19 优化。preserve 纪律同 R12/R15（taste-skill
> Design Read：Operate 型产品界面，四主题令牌体系不动）。

## 缺口（代码级取证）

- 运行心电图 ×2 与态度占比图只有**当前值 + 峰值**读数；回看"第 30 批时吞吐多少、
  当时乐见占比几成"没有任何途径——数据就在内存里（`live.tput/msSeries/shares`），只是
  没有交互入口。
- 图表 SVG 每批 innerHTML 重建 ⇒ **监听器不能挂在 svg 上**；但容器（`.mini`/`#chartShare`）
  常驻——事件委托挂在容器上，重建免疫。

## 改动（只动实时监控段，报告图表不动——它们的点上有静态标注）

1. `charts.js`：`rollingChart` / `shareChart` 的根 svg 加 `data-chart`（标识与 pad 参数），
   供委托端把 offsetX 换算成样本序号。
2. `app.js`：三个容器一次性挂 `pointermove/pointerleave` 委托——move 时按 x 反算样本序号，
   往 svg 里临时插一条竖参考线 + 右上角读数（`.chart-read`：`第 N 批 · 值`；占比图给
   乐见/反感两数）；leave 清除。**只读不重建**，每批重绘自动覆盖临时线（无残留）。
3. `styles.css`：`.mini { position: relative }` + `.chart-read`（等宽小字，accent 色）。
4. 数据口径：tput/msSeries 的第 i 个样本对应第 i 批；shares 同。

## 验收

- [ ] `npm run lint` ✓；`npm test` 111/111（交互属 DOM，无新纯函数）
- [ ] E2E：跑一次检查，hover 图表出现参考线与读数、leave 清除、移出数据区不出负/越界读数、
      375px 无溢出、控制台零错误
- [ ] `frontend.md` 交互小节补一句；MEMORY 记一轮
