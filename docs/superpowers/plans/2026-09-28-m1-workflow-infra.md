# M1 工作流地基 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给仓库装上多 agent 协作的最低基础设施：CI 自动跑测试、PR 模板统一评审信息、任务卡/交接记录有固定落盘目录。

**Architecture:** 纯增量，不碰任何运行时代码。三个新文件（CI workflow、PR 模板、tasks 目录占位）+ 四份既有文档的路径表述修订。

**Tech Stack:** GitHub Actions（ubuntu + Node 22）、Markdown、git。

---

## Phase 0 · 事实基线（已采集，执行前无需重新调研）

- 测试命令：`npm test` = `node --test "test/*.test.js"`（`package.json:15`），当前 41 用例全绿，mock 通道无需 key（`docs/TESTING.md`）。
- wrangler 随 devDependencies 安装（`package.json:18`），`npm ci` 即含 workerd 平台二进制；集成测试经 `unstable_dev` 起真实本地 Worker（`test/helper.js:5-13`）。
- 任务卡/交接模板现状：`docs/agent/templates/task-card.md`、`docs/agent/templates/handoff.md`；RELAY.md「交接放在哪」一节当前写"任务卡同目录"（歧义点）。
- 仓库当前无 `.github/` 目录（`git ls-files .github` 为空）。
- 提交规范：conventional commits，与本仓库历史一致（`AGENTS.md` 红线节）。

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `.github/workflows/test.yml` | Create | push/PR 自动跑 `npm ci && npm test` |
| `.github/pull_request_template.md` | Create | PR 描述模板，字段对齐任务卡 |
| `docs/agent/tasks/.gitkeep` | Create | 任务卡与 handoff 的固定落盘目录 |
| `docs/agent/RELAY.md` | Modify | 「交接放在哪」改为固定目录约定 |
| `docs/agent/templates/task-card.md` | Modify | 用法行补全路径 |
| `docs/agent/templates/handoff.md` | Modify | 用法行补全路径 |
| `AGENTS.md` | Modify | 铁律 3 补全落盘路径 |

---

### Task 1: CI —— push/PR 自动跑测试

**Files:**
- Create: `.github/workflows/test.yml`

- [ ] **Step 1: 创建 workflow 文件**

创建 `.github/workflows/test.yml`，内容完整如下（不要增删章节）：

```yaml
name: test

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm test
```

- [ ] **Step 2: 本地验证 workflow 语法**

Run: `npx --yes @github/local-action@latest .github/workflows/test.yml 2>/dev/null || node -e "const y=require('js-yaml');console.log('skip: no yaml parser, rely on GitHub UI')"`

Expected: 要么本地跑通，要么跳过（YAML 语法极简，GitHub UI 会标红明显错误）；**不要**为此引入 js-yaml 依赖。

- [ ] **Step 3: 推送并确认 Actions 变绿**

Run:
```bash
git checkout -b chore/ci-test-workflow
git add .github/workflows/test.yml
git commit -m "chore: run npm test on every push and PR"
git push -u origin chore/ci-test-workflow
```
Expected: GitHub 仓库页出现 Actions run；约 1-2 分钟后 job `test` 变绿（41 用例）。若失败于 workerd 下载，检查 `npm ci` 日志中 `@cloudflare/workerd-linux-64` 是否安装成功——不要改用 `npm install`。

- [ ] **Step 4: 合并回 main 并确认 main 上也有一条绿记录**

Run:
```bash
git checkout main && git merge --no-ff chore/ci-test-workflow -m "merge: CI test workflow"
git push origin main
```
Expected: push 后 Actions 自动触发并通过。

### Task 2: PR 模板

**Files:**
- Create: `.github/pull_request_template.md`

- [ ] **Step 1: 创建 PR 模板**

创建 `.github/pull_request_template.md`，内容完整如下：

```markdown
## 任务卡

<任务卡 id 与一句话目标；无任务卡的杂项改动写"无">

## 拥有文件（写锁清单核对）

<本次 PR 改动的文件列表；与任务卡不一致时说明原因>

## 验收标准对照

<逐条列出任务卡验收标准 + 证据（命令输出/测试名/人工核对结果）；不许只打勾不附证据>

## 测试

- `npm test`：tests / pass / fail = <数字>
- 新增用例：<用例名 + 断言的行为；无则写"无">

## 遗留与风险

<未完成项、已知风险、需要 Reviewer 特别看的地方；无则写"无">

## 共享契约检查

本次改动是否触碰以下共享契约（API JSON 形状 / D1 列语义 / labels.js 中文单源 / 限额双路行为）？
<是——说明同步了哪些消费方；否>
```

- [ ] **Step 2: 验证模板被 GitHub 识别**

Run: 在 GitHub 上对任意分支开一个 PR（或本地 `git push` 后用 `gh pr create --fill`）。
Expected: PR 描述输入框自动带有上述六节。

- [ ] **Step 3: 提交**

```bash
git add .github/pull_request_template.md
git commit -m "chore: add PR template aligned with task cards"
git push
```

### Task 3: 任务卡与 handoff 固定落盘目录

**Files:**
- Create: `docs/agent/tasks/.gitkeep`
- Modify: `docs/agent/RELAY.md`（「交接放在哪」一节）
- Modify: `docs/agent/templates/task-card.md`（用法行）
- Modify: `docs/agent/templates/handoff.md`（用法行）
- Modify: `AGENTS.md`（铁律 3）

- [ ] **Step 1: 写失败检查（文档一致性）**

Run:
```bash
grep -rn "任务卡同目录" docs/agent/ AGENTS.md
```
Expected: 命中 `docs/agent/RELAY.md` 一行——这是本任务要消除的歧义。

- [ ] **Step 2: 创建目录占位**

创建空文件 `docs/agent/tasks/.gitkeep`（git 不跟踪空目录，用占位文件保住它）。

- [ ] **Step 3: 修改 RELAY.md**

将 `docs/agent/RELAY.md` 中「## 交接放在哪」一节的现有两行条目：

```markdown
- 进行中的任务：任务卡同目录留 `<任务id>-handoff.md`（从
  [templates/handoff.md](templates/handoff.md) 复制），**最新状态置顶**。
- 任务完成：交接内容压缩成一条进 [MEMORY.md](../MEMORY.md)（同样最新置顶），
  然后删除临时 handoff 文件，避免仓库堆积半成品状态。
```

整体替换为：

```markdown
- 任务卡与交接记录统一落盘 `docs/agent/tasks/`（入库，接力 agent 与评审 agent 都能读到）：
  - `docs/agent/tasks/<任务id>-task.md`（从 [templates/task-card.md](templates/task-card.md) 复制）
  - `docs/agent/tasks/<任务id>-handoff.md`（从 [templates/handoff.md](templates/handoff.md) 复制，**最新状态置顶**）
- 任务完成：交接内容压缩成一条进 [MEMORY.md](../MEMORY.md)（同样最新置顶）；
  handoff 文件默认删除；需要审计轨迹的任务由主控显式移入 `docs/agent/tasks/done/`。
```

- [ ] **Step 4: 修改三份模板/入口的路径表述**

`docs/agent/templates/task-card.md` 用法行，将：

```markdown
> 用法：复制本文件为 `<任务id>-task.md`，由主控 agent 填写后派发；执行 agent 只改卡内文件。
```

替换为：

```markdown
> 用法：复制本文件为 `docs/agent/tasks/<任务id>-task.md`，由主控 agent 填写后派发；执行 agent 只改卡内文件。
```

`docs/agent/templates/handoff.md` 用法行，将：

```markdown
> 用法：任务跨 agent/跨会话接力时，复制本文件为 `<任务id>-handoff.md`。
```

替换为：

```markdown
> 用法：任务跨 agent/跨会话接力时，复制本文件为 `docs/agent/tasks/<任务id>-handoff.md`。
```

`AGENTS.md` 铁律 3，将：

```markdown
3. **接力必须留痕**：任务未一次完成时，按 `docs/agent/templates/handoff.md` 写交接，
   最新状态置顶；下一个 agent 从交接记录继续，不重新全量读项目。
```

替换为：

```markdown
3. **接力必须留痕**：任务未一次完成时，按 `docs/agent/templates/handoff.md` 写交接到
   `docs/agent/tasks/<任务id>-handoff.md`，最新状态置顶；下一个 agent 从交接记录继续，
   不重新全量读项目。
```

（以文件中实际文本为准；若措辞有出入，保持"落盘到 docs/agent/tasks/"这一新信息不变。）

- [ ] **Step 5: 验证一致性**

Run:
```bash
grep -rn "任务卡同目录" docs/ AGENTS.md; grep -rln "docs/agent/tasks/" docs/agent AGENTS.md
```
Expected: 第一条无命中；第二条命中 RELAY.md、task-card.md、handoff.md、AGENTS.md 四份。

- [ ] **Step 6: 提交**

```bash
git add docs/agent/tasks/.gitkeep docs/agent/RELAY.md docs/agent/templates AGENTS.md
git commit -m "docs: pin task-card and handoff files to docs/agent/tasks/"
git push
```

### Task 4: 收尾 —— MEMORY 记录

**Files:**
- Modify: `docs/MEMORY.md`

- [ ] **Step 1: 置顶追加一条**

在 `docs/MEMORY.md` 顶部（`---` 分隔线之后、最新条目之上）插入：

```markdown
## <今天日期> · M1 工作流地基落地

- CI：`.github/workflows/test.yml`，push/PR 自动 `npm ci && npm test`。
- PR 模板 `.github/pull_request_template.md`：任务卡 id / 拥有文件 / 验收标准附证据 /
  测试数字 / 遗留风险 / 共享契约检查六节。
- 任务卡与 handoff 固定落盘 `docs/agent/tasks/`（完成后删或归档 `done/`，要点进 MEMORY）。
```

- [ ] **Step 2: 提交并确认 main 全绿**

```bash
git add docs/MEMORY.md
git commit -m "docs: memory entry for M1 workflow infra"
git push
```

---

## Self-Review（写计划者已自查）

1. **范围核对**：本计划四个任务全部不对运行时代码（`worker/`、`public/`、`test/`）做任何修改——M1 是纯基础设施增量。✓
2. **占位符扫描**：所有步骤均含完整文件内容或精确的旧文本→新文本替换，无 TBD。✓
3. **命名一致性**：`docs/agent/tasks/` 在四份文档中表述一致；`<任务id>-task.md` / `<任务id>-handoff.md` 命名在模板与 RELAY.md 一致。✓
4. **风险**：Task 1 的 CI 首次运行可能因 workerd 平台二进制下载失败——已在 Step 3 给出排查路径，不改变方案。
