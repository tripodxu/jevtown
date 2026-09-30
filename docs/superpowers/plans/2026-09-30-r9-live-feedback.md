# R9 · 前端轮：检查进行中的反馈（SR 播报节流 + 打开报告加载态）

> 轮换位置：R8 创意 ⇒ **R9 前端** ⇒ R10 优化。writing-plans 规范，inline 执行（不用子代理）。
> 方向判定：refinement（本会话 `impeccable context` = `SCOPED_EXISTING_ALLOWED`）。

## 取证（2026-09-30）

- **图表重建成本被数据否决**：Node 实测 `rollingChart + shareChart × 2` 每批 0.33ms
  （100 批共 33ms）——不优化，别凭感觉给 updateCharts 加缓存。
- **实时段视觉取证**（全城检查中截图，桌面 1100 + 窄屏 375 × 夜巡）：布局、两列 KPI、
  心电图、传播地图点亮均正常，零溢出、零控制台错误。
- **真缺陷 1（R6 的回归）**：`#statusLine` 挂了 `role="status"`，而它**逐批**更新
  （一次全城检查 ≈ 100 条 polite 播报）——屏幕阅读器被刷屏。里程碑（开局/收波/完成/错误）
  才是该播的。
- **真缺陷 2**：`openPost`（feed 点击 / 深链）拉报告期间无任何反馈，慢网络像死机。
- **小不一致**：实时统计的标签 `tokens` 是英文，报告口径叫「输入 tokens」。

## 改动

1. **SR 播报挪到里程碑**（`index.html` + `app.js`）：`#statusLine` 摘掉 `role="status"`
   （回归到纯视觉行）；新增 sr-only 的 `#statusLive role="status"`，只在里程碑更新——
   开局开始判定、每波收束、检查完成、Jev 拒发、请求失败。新增 `announce(text)` 小助手。
2. **openPost 加载反馈**：进入即 `status('正在打开报告……', 0.15)` + `announce` 同文；
   失败路径已有 error 显示（也补 announce）。
3. **标签对齐**：`updateLiveStats` 的 `tokens` → `输入 tokens`。

## 不做（范围纪律）

- updateCharts/updateLiveStats 的批间节流——实测 0.33ms/批，不值。
- 结果区焦点管理（打开报告后 focus 到 h2）——单独一轮做，别混。
- 实时段滚动条/光标等浏览器面主题化——留给后续前端轮（craft-floor 的 Browser surfaces 清单）。

## 验收

- [ ] `npm run lint` ✓；`npm test` 100/100（本轮无新纯函数，不加用例）
- [ ] E2E：检查全程 `#statusLive` 只在里程碑变文本（逐批更新时保持不变）；
      `#statusLine` 无 role 属性；深链打开报告时状态行出现「正在打开报告……」；
      控制台零错误
