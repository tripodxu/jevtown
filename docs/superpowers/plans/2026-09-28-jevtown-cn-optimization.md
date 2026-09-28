# Jevtown 中文小镇 · 优化总纲（2026-09-28）

> 本文件是**索引与决策记录**，可执行的任务分解在三个子计划中（按 writing-plans 规范编写，
> 每步 2-5 分钟、TDD、含完整代码）。执行时按「建议执行顺序」逐计划派发任务卡。

## 子计划索引

| 计划 | 内容 | 任务数 |
|---|---|---|
| [2026-09-28-m1-workflow-infra.md](./2026-09-28-m1-workflow-infra.md) | CI、PR 模板、任务卡落盘目录约定 | 4 |
| [2026-09-28-m2-api-security.md](./2026-09-28-m2-api-security.md) | 预算闸、作者令牌、收波 CAS、批次认领 | 5 |
| [2026-09-28-m3-polish.md](./2026-09-28-m3-polish.md) | README 瘦身、observability、最小 lint、可选 E2E/本地限额 | 5（2 个可选） |

## 发现汇总（带证据，均经读码确认）

| # | 问题 | 证据 | 归宿 |
|---|---|---|---|
| F1 | 无 CI | 仓库无 `.github/`（`git ls-files .github` 为空） | M1 Task 1 |
| F2 | 无 PR 模板 | 同上 | M1 Task 2 |
| F3 | 任务卡/handoff 落盘目录未定 | `docs/agent/RELAY.md` 只写"任务卡同目录" | M1 Task 3 |
| F4 | `/api/batch` 无身份校验、无预算闸 | `worker/index.js:250-299`：仅查 post 存在与 `state='running'`；限额只在 check/version（`:137`/`:211`） | M2 Task A + B |
| F5 | 收波无 CAS 锁 | `worker/index.js:303-339`：先读 `state='running'` 再推进，无原子占位 | M2 Task C |
| F6 | `plan.answered` 读-改-写非原子 | `worker/index.js:258-296`：读 start → 写 `answered = start + n`，无版本校验 | M2 Task D |
| F7 | README 偏长、产品向与开发向混排 | `README.md` 105 行，「目录结构」「与上游的差异」可被 docs/ 覆盖 | M3 Task 7 |
| F8 | observability 关闭 | `wrangler.jsonc:23` | M3 Task 8 |
| F9 | `database_id` 为占位符 | `wrangler.jsonc:13` 全零 UUID | M3 Task 8 |
| F10 | 无 lint | `package.json` 无 lint script | M3 Task 9 |
| F11 | 前端零自动化覆盖 | `public/` 24 个文件，无浏览器测试 | M3 Task 10（可选） |
| F12 | 本地限额误伤 | `worker/index.js:133`：本地 IP 恒为 `'local'`，多人共享 20 次/日 | M3 Task 11（可选） |

## 已锁定的设计决策

1. **作者令牌走请求头 `x-jev-author`，不用 cookie**：与既有 `x-jev-provider`/`x-jev-key`
   BYOK 约定同族；前端 `authHeaders()`（`public/app.js:21-24`）是现成注入点；测试无需解析
   set-cookie。代价：令牌在页面内存/localStorage，XSS 可读——与既有 BYOK key 同威胁模型。
2. **读操作保持公开**：`GET /api/post/:id`、`/api/feed` 不加身份——分享链接可看，不可烧钱。
3. **runVersion 校验顺序**：404 → 409 → 限额 → 预算 → 作者。限额是全局信息先返回无害，
   且保持既有"限额用例期望 429"语义。
4. **CAS 用 `posts.state` 三态**：`running → closing → running/done`。推进路径必须在同一
   `env.DB.batch` 内把状态还回 `running`（否则批次被 409 挡死）；失败回滚占位。
5. **收波阶段不透传 BYOK 头**：`settleWave` 拆分后收请求仅在 entry 用；收波提问走 env 通道
   或 mock。若评审不可接受，子计划 M2 Task C Step 3 已给出备选（把 request 传进去）。
6. **lint 不引 eslint**：语法门（`node --check`，本机 Node v24.9.0 实测 ESM 兼容）+
   两条文本规则；`scripts/`（CLI）豁免 console.log 规则。
7. **刷新页面丢 author**：MVP 接受（检查进行中刷新需重开）；不引入恢复链路，记录为已知限制。

## 建议执行顺序

```
M1（Task 1→2→3→4，可一个 PR 合并，纯增量）
   ↓
M2（Task A→B→C→D→E，每任务独立分支 + 独立 PR，测试先行；
    Task B 会批量更新 Task A 新增用例的调用点，属预期修改量）
   ↓
M3（Task 7→8→9 必做；Task 10/11 可选）
```

## 跨切面风险

- **测试夹具连锁**：M2 Task B 改 `test/helper.js` 与全部 `runToDone` 调用点；每一步之后
  既有 8 个集成用例必须保持 PASS（基线 41 用例，M2 完成后 45）。
- **D1 迁移只增不改**：0005 加 `posts.author`；旧本地帖 author 为 NULL，写操作一律 403，
  本地开发重开检查即可（已在迁移注释与 MEMORY 记录）。
- **D1 JSON 函数**：M2 Task D 依赖 `json_set`/`json_extract`——子计划含 probe.sql 先证后用，
  不可用则停下换备选设计（versions 加 answered 列），不硬编码绕过。
- **每个任务合入后**：按 `docs/agent/COLLABORATION.md` 更新 `docs/MEMORY.md`（最新置顶），
  任务卡与 handoff 落盘 `docs/agent/tasks/`（M1 Task 3 落地后生效）。
