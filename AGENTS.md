# AGENTS.md · Jevtown 中文小镇

> 本文件是**所有 agent 进入本仓库的第一份文档**。读完本文件即可开始工作；除本文件外，
> 按下方「分层阅读协议」按需取读，**不要全量阅读仓库**。

## 这个项目是什么

中文小镇版 Jevtown：人们写一段文字，一万个 AI 人格（100×100 小镇地图）来读，几秒内给出
传播反应。判定全部来自 TypeSafe [Jev](https://typesafe.ai)（System One 决策模型）返回的
**概率**——模型不写一个字，每个数字都是它的判定。

技术形态：**一个 Cloudflare Worker（API）+ D1（存储）+ 无框架静态前端（assets）**。
引擎代码三端共用（Worker / 浏览器 / Node 终端），位于 `public/shared/`。

- 技术栈细节 → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 代码约定 → [docs/CONVENTIONS.md](docs/CONVENTIONS.md)
- 文档全集索引与阅读地图 → [docs/README.md](docs/README.md)

## 分层阅读协议（重要）

| 层级 | 读什么 | 什么时候读 |
|---|---|---|
| L0 入口 | 本文件 + `README.md` | 每次任务开始，必读 |
| L1 架构 | `docs/ARCHITECTURE.md` | 第一次接触本项目，或改动跨模块时 |
| L2 模块 | `docs/modules/` 下对应模块文档 | 只读与任务相关的那一份 |
| L3 细节 | 计划 / ADR / 记忆 / 模板 | 按需，见 [docs/README.md](docs/README.md) 索引 |

**按任务类型取读（不要多读）：**

| 任务类型 | 读取范围 |
|---|---|
| 改前端界面 / 渲染 / 图表 / 主题 | `docs/modules/frontend.md` + 目标文件本身 |
| 改 API / D1 / 限额 / 记账 | `docs/modules/worker-api.md` + `worker/index.js` |
| 改引擎算法（波次 / 概率 / 摘要） | `docs/modules/shared-engine.md` + 目标文件本身 |
| 写测试 | `docs/TESTING.md` |
| 部署 / 密钥 / 限额调整 | `docs/DEPLOYMENT.md` + `wrangler.jsonc` |
| 多 agent 分工 / 接力 | `docs/agent/COLLABORATION.md` + `docs/agent/RELAY.md` |
| 了解历史决策与坑 | `docs/MEMORY.md`（最新在上，从头读） |

## 多 agent 协同与接力（摘要）

完整协议见 [docs/agent/COLLABORATION.md](docs/agent/COLLABORATION.md) 与
[docs/agent/RELAY.md](docs/agent/RELAY.md)。铁律：

1. **文件 Ownership**：一个文件在同一时间只允许一个 agent 修改；跨 agent 共享的契约
   （API 形状、`labels.js` 中文单源、D1 schema）由主控 agent 统一变更。
2. **先领任务卡再动手**：从 `docs/agent/templates/task-card.md` 复制并填写，明确
   目标 / 拥有文件 / 验收标准。
3. **接力必须留痕**：任务未一次完成时，按 `docs/agent/templates/handoff.md` 写交接，
   最新状态置顶；下一个 agent 从交接记录继续，不重新全量读项目。
4. **决策与坑写进记忆**：`docs/MEMORY.md` 最新条目置顶，一次一条，写事实不写流水账。

## 常用命令

```bash
npm install
npm run dev     # 应用本地 D1 迁移并启动 → http://localhost:5191（默认 mock，零花费）
npm test        # node:test：引擎单测 + Worker 集成（unstable_dev），mock 通道不花钱
npm run check -- --preset listing "文本"   # 终端直跑，结果存 output/checks/
npm run deploy  # remote 迁移 + 部署（上线前必读 docs/DEPLOYMENT.md）
```

Node.js 22+。无 key 时全流程自动走 mock；填 key（BYOK 或 Worker secret）切真实模型，
成本量级见 [docs/MEMORY.md](docs/MEMORY.md) 与 `docs/research/real-api-report.md`。

## 红线（任何 agent 不得违反）

- **不提交任何密钥**：`.dev.vars`、`.env.local` 已被 `.gitignore` 忽略，保持如此；
  密钥只进本地文件或 Worker secret。
- **不动 `_research_raw/`**：上游调研原始材料，已 gitignore，仅供本地查阅。
- **不改写已发布历史**，不 `push --force` 到 `main`。
- **不为验证之名扩任务**：最小必要检查，未验证的事项如实说明，不声称通过。
- **提交信息用 conventional commits**（`feat:` / `fix:` / `docs:` / `chore:` / `style:`，
  与本仓库历史一致）；一次提交只包含本次任务涉及的文件。
