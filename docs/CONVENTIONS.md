# CONVENTIONS · 代码约定

改任何代码前必读。本文件描述**本仓库实际在用的约定**，不是通用最佳实践汇编。

## 语言与模块

- 原生 ESM（`"type": "module"`），无构建步骤、无打包器、无 TypeScript。
- 无框架：前端是原生 DOM + ESM；Worker 是原生 fetch handler。
- 每个文件顶部用一行注释说明职责（本仓库现有文件均如此，新文件保持）。
- Node.js 22+；`node --test` 跑测试；不引入新的 devDependency（除非主控 agent 明确批准）。

## 命名

| 对象 | 约定 | 例 |
|---|---|---|
| 文件 | 小写中划线或单词 | `shared-engine.md`、`rng.js`、`check.js` |
| 常量 | SCREAMING_SNAKE | `CROWD_MAX_WAVES`、`GLAD_ENOUGH` |
| 函数 | 小驼峰 | `drawReaction`、`closeWave` |
| 谓词/选择器 | `is/has/of` 后缀风格 | `anyoneLeft`、`personaOf` |
| API 路由 | `/api/<资源>`，动作用名词 | `/api/check`、`/api/wave` |
| D1 表 | 复数名词 | `posts`、`versions`、`reactions`、`batches` |

## 中文单源（最重要的一条）

- 界面中文一律来自 `public/shared/labels.js`（`PRESET_ZH`/`REACTIONS_ZH`/`REASONS_ZH`/
  `SEGMENT_ZH`/`CHECKS_ZH`/`FOLLOWUP_LISTING_ZH`/`BLOCKED_ZH`/`presetNoun`/`reportStageZh`…）。
- 人格中文词表一律来自 `public/shared/vocab.js`。
- Jev 读英文（问句/人格行是英文），界面显示中文——**两边都不要混**：不要往问句里塞中文，
  不要在渲染层硬编码中文。
- 新增预设/反应/分组时：先加英文判据（`presets.js`），再加中文标签（`labels.js`），
  两边齐全才接 UI。

## 颜色与主题

- 反应颜色唯一来源：`presets.js` 的 `LOOKS`；地图图例、条形图、堆叠图共用。
- 主题 = `public/styles.css` 的一组 CSS 变量令牌；新增主题只加令牌 + 顶栏按钮，
  **不改组件代码**。主题选择存 localStorage（`theme.js`）。

## 数据与存储

- D1 迁移只增不改：新需求写新序号文件（`000N_*.sql`），表结构变更用 `ALTER TABLE ADD COLUMN`。
- JSON 列（`scores`/`checks`/`plan`/`said`/`follow_up`/`prices`/`decisions`）的字段形状
  变更属于**跨 agent 契约**，必须走任务卡 + MEMORY 记录。
- 花费记账：每个 Jev 调用落 `batches` 一行；`versions.usd` 必须与 `batches` 按 day 汇总口径
  一致（曾漏记收尾提问花费，见 [MEMORY.md](MEMORY.md)——改记账必查此条）。

## 前端

- `index.html` 首屏即发帖框；示例回放只在底部且标注"存档"。
- 渲染分层：`app.js`（编排/BYOK 弹窗）→ `render.js`（报告+目录）→ `charts.js`/`grid.js`（图）。
- 移动端优先：任何新布局在窄屏不溢出（审计轮修过溢出问题）。
- 可访问性：交互元素有可读名称；图表颜色不依赖单一色相区分。

## 测试约定

见 [TESTING.md](TESTING.md)。要点：新引擎函数配纯函数单测；Worker 行为用 `unstable_dev`
集成测试；全程 mock 通道，**测试不花真钱**。

## 提交

- conventional commits，与历史一致：`feat:` `fix:` `docs:` `chore:` `style:` `test:` `perf:`。
- 一次提交只含本次任务文件；提交信息说清"为什么"。
- 不提交密钥、不改写历史、不 force push `main`。
