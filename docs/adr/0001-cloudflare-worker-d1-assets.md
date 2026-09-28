# ADR-0001 · Cloudflare Worker + D1 + 边缘 assets

- 状态：已采纳
- 日期：2026-09-28
- 背景：项目需要一个带状态（检查记录、反应明细、花费流水）的动态 API，同时前端是无框架
  静态页面。候选：Cloudflare Pages + Functions / Cloudflare Worker + assets / Vercel。
- 决策：**一个 Cloudflare Worker 同时承担 API（`/api/*`）与静态资源（`public/` assets）**，
  存储用 D1（SQLite）。`wrangler.jsonc` 中 `run_worker_first: ["/api/*"]`——只有 API 进
  Worker，页面/样式/脚本从边缘 assets 直接出，不计 Worker 请求。
- 理由：
  - 单进程单文件（`worker/index.js`）即可覆盖全部动态行为，无第二个部署目标；
  - assets 与 API 同源，无 CORS/跨域配置；
  - D1 的关系模型（posts/versions/reactions/batches 四表 + 迁移）契合本项目的查询形状；
  - 调研阶段的目标就是"部署在 CF 的静态页面 + 轻后端"（见 `research/Jevtown调研报告.md`）。
- 备选与否决理由：
  - Pages + Functions：两套部署目标、本地开发割裂，收益仅"更传统"；
  - Vercel：需要额外账号与服务端运行时，assets/API 分离无收益。
- 后果：全部动态逻辑压在单 Worker 文件内，靠路由函数组织；限额/记账成为横切点；
  D1 迁移只增不改（见 `docs/modules/worker-api.md`）。
