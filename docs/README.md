# docs/ · 文档索引与阅读地图

> agent 请按需取读：先读根目录 [AGENTS.md](../AGENTS.md) 的「按任务类型取读」表，
> 再从这里打开对应文档。**不要全量阅读本目录。**

## 文档地图

```
docs/
├── README.md            ← 本文件：索引 + 阅读地图
├── ARCHITECTURE.md      系统架构：三端引擎 + Worker + D1 + 前端 + 一次检查的完整数据流
├── CONVENTIONS.md       代码约定：ESM/无框架/中文单源/主题令牌/命名与提交
├── TESTING.md           测试体系：怎么跑、覆盖什么、怎么写新用例
├── DEPLOYMENT.md        部署：wrangler / D1 / secret / 限额 / observability
├── MEMORY.md            项目记忆日志（★ 最新条目置顶）
├── adr/                 架构决策记录（ADR）：为什么这样做，含被否决的备选
├── modules/             模块深潜：shared-engine / worker-api / frontend
├── agent/               多 agent 协同与接力协议 + 任务卡/交接模板
├── agent/tasks/         进行中的任务卡与交接记录（完成后删或归档 done/）
├── research/            调研报告与真实 API 实测记录
└── superpowers/plans/   历史实施计划（Step 2 功能打磨）
```

## 每份文档的一句话摘要

| 文档 | 内容 | 适合谁读 |
|---|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 系统全景、数据流、目录职责、关键约束 | 所有 agent 首次入场；跨模块改动前 |
| [CONVENTIONS.md](CONVENTIONS.md) | 代码风格与单源约定，改代码前必读 | 写代码的 agent |
| [TESTING.md](TESTING.md) | 测试布局、运行方式、mock 通道 | 写/改测试的 agent |
| [DEPLOYMENT.md](DEPLOYMENT.md) | 上线步骤、密钥、限额变量说明 | 部署前 |
| [MEMORY.md](MEMORY.md) | 项目记忆：关键事实、成本数据、踩过的坑 | 每次任务开始（最新在上） |
| [adr/](adr/) | 重要决策及理由 | 质疑"为什么这样设计"时 |
| [modules/shared-engine.md](modules/shared-engine.md) | 引擎九文件 + 波次/概率/摘要算法 | 改引擎的 agent |
| [modules/worker-api.md](modules/worker-api.md) | API 契约、D1 schema、限额与记账 | 改 Worker 的 agent |
| [modules/frontend.md](modules/frontend.md) | 前端文件职责、渲染管线、主题系统 | 改界面的 agent |
| [agent/COLLABORATION.md](agent/COLLABORATION.md) | 多 agent 分工、Ownership、合并规则 | 多 agent 并行任务 |
| [agent/RELAY.md](agent/RELAY.md) | 接力协议：交接什么、怎么写、怎么接 | 任务跨 agent/跨会话延续 |
| [agent/templates/](agent/templates/) | 任务卡与交接模板 | 领任务、交任务时复制 |
| [research/](research/) | 调研报告、真实 API 实测 | 了解项目来龙去脉 |
| [superpowers/plans/](superpowers/plans/) | Step 2 实施计划（历史存档） | 复盘历史实现 |

## 三条使用规则

1. **入口最小化**：根 `AGENTS.md` + 本索引即可定位任何任务所需文档，无需遍历仓库。
2. **文档改动走 MEMORY**：新增/重写文档后，在 [MEMORY.md](MEMORY.md) 顶部记一条
   （日期 + 改了什么 + 为什么），保持最新在上。
3. **过期文档就地标废**：发现文档与代码不符，改文档或在文首加 `> ⚠️ 可能过时` 标注，
   不要静默留下错误信息。
