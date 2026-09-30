# R22 · 优化轮：示例卡懒渲染——首页不再为折叠线下的两张完整报告白付 ~120ms

> 轮换位置：R21 前端 ⇒ **R22 优化** ⇒ R23 创意。writing-plans 规范，inline 执行。

**取证（Node 实测，2026-09-30）**：`replayToView × 2 = 122.8ms` 纯 CPU（含打包解码
14ms + 每卡的 segments/crowdTerrain/voicesOf/切片热力/波次构成），再加上 renderCheck
的 DOM 构建、canvas 绘制与 SVG 布局——全部发生在**首页加载时**，而示例卡在折叠线下，
访客未必滚到。showcase.js 是 module 顶层 await，主线程被同步占住。

## 改动（`public/showcase.js` 单文件 + 一条 CSS）

1. IntersectionObserver 懒渲染：卡片进入视口前 300px 才 `renderCheck(replayToView(data))`，
   渲染一次即 disconnect；rootMargin 预渲染保证滚到时已就绪（无可见跳变）。
2. 无 IntersectionObserver 的环境直接渲染（功能不降级）。
3. CSS：`.examples .card:empty { min-height: 420px }`——占位不塌陷（渲染后 :empty 失效）。

## 验收

- [ ] `npm run lint` ✓；`npm test` 115/115（浏览器装配逻辑，无新纯函数）
- [ ] E2E：加载后示例卡为空（未滚动）→ 滚动到附近自动渲染；滚动后内容完整（含头像/热力图）；
      375px 无溢出；控制台零错误（Edge 恢复后补跑）
- [ ] `frontend.md` showcase 职责行更新；`MEMORY.md` 记一轮
