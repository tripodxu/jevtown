# 提交审计：最近三天（2026-09-30 20:47 → 2026-10-03 13:35，39 个提交）

起因是 R37 收尾时的一次事故：写 MEMORY.md 条目时用行号切片拼行，把 1,170 行历史换成 5 行
（全文件缩到 84 行），而且截断被一起提交进了 `131d35d`。随后从 git 全量恢复（`6e221cd`）。
既然已经有一次「文件被腰斩而且没人发现」，就得把最近三天的每一个提交都过一遍，看还有没有第二处。

审计范围 = `git log --since="3 days ago"`，基线提交 `359a42c`（窗口之前最后一个）。
审计对象是「三天里所有提交」，重点是三件事：① 有没有第二处被腰斩/被覆写；② 有没有引入回归；
③ 有没有引入静默失效（改名只改一端、常量悄悄变了、断言悄悄被删）。

## 结论先说

- **回归：没有。** HEAD 全量 `npm test` 197 个用例（含本轮新加的 1 个）全绿，`npm run lint`
  47 个文件过，`node scripts/golden-waves.js --check` 16 行波次名单一字未变。
- **被腰斩的文件：只有一处，就是已修的那处。** 39 个提交里逐行统计删除量，只有
  `131d35d` 的 `docs/MEMORY.md`（+70 / −1310）是异常量级，已在 `6e221cd` 恢复并核过删除列 = 0。
  其余最大的删除是 47 行。
- **顺手修掉一处真隐患**（本轮唯一的产品代码改动）：`worker/index.js` 读 versions 的 JSON
  文本列时用的是 `x ?? 'null'`，`??` 挡得住 null/undefined、挡不住空串，而 `JSON.parse('')`
  抛 SyntaxError → 整份报告 500。今天这些列都只由 `JSON.stringify` 写、还没有一版写过空串，
  所以它是颗哑弹而不是现行 bug，但它是一条会被后来者踩到的路。见下「顺手改的一处」。

## 一、逐提交删除量（截断检测）

`git show --numstat` 逐提交、逐文件，按删除行数降序。口径：只增不减的文件（MEMORY.md）如果
删除行数与新增行数同量级，就是被覆写/腰斩的特征。

| 提交 | 文件 | +/− | 判断 |
|---|---|---|---|
| `131d35d` | `docs/MEMORY.md` | +70 / −1310 | **腰斩**，已在 `6e221cd` 恢复 |
| `5430d3c` | `test/worker.test.js` | −47 | 有意：删掉「每日限额 429」「预算闸 429」两个用例，与「退役限额/预算闸」配套 |
| `5430d3c` | `worker/index.js` | −35 | 有意：删 `spentToday`/`overBudget` 两个函数 + 两处 `const ip = CF-Connecting-IP` + 闸的 429 分支 |
| `f54cb52` | `public/shared/feed.js` | −42 / +173 | 有意：R34 核心重构，删 `namesOf`/`attributesOf`/`NAMES` WeakMap 与旧 `pick()`，换列号 CSR |
| `7154081` | `scripts/probe-dims.js` | −12 / +0 | 有意：整文件删除，内容是一次性 persona 结构探针 |
| 其余 30+ 提交 | 代码文件 | −1 … −15 | 编辑替换，逐条看过 diff 方向 |

`5430d3c` 删掉的那两处 `const ip` 值得单独说一句：它正是 R28 之后 `ip is not defined` 500
的根因（两个 INSERT 的 `.bind(..., day, ip, author)` 悬空引用）。R29 的审查提交 `762cc6d`
把它修回来了，这条链在历史里已经闭环，不是三天窗口内的新问题。

## 二、静默失效检测

| 查什么 | 怎么查的 | 结果 |
|---|---|---|
| import 指向不存在的导出 | 39 个提交逐个解析 `import {具名}`，比对目标模块的 export | 零「引用了但没导出」 |
| 孤儿导出 | 窗口新增的 11 个导出（feed.js `randomBaseline`/`moodZ`/`exposureAll`/`exposureBands`、render.js `bandsView`/`audienceView`、summary.js `pickableGroups`/`reconcileAudience`/`filterGroups`/`pickLabelZh`、grid.js `reachLegendInk`）逐个找调用点 | 11 个全部有调用点（同文件内也算） |
| 写库语句引用了不存在的列 | 21 条 INSERT/UPDATE 的列名逐个比对 9 个迁移文件 | 全部对得上 |
| 判据级常量被悄悄改了 | `GLAD_ENOUGH`/`WAVES`/`PER_REQUEST`/`TIMEOUT_MS`/`MAX_ATTEMPTS`/`GRID`/`CROWD`/`MIN_ASKED`/`MIN_JUDGED`/`ALPHA`/`PRIOR`/`MIN_SLICE`/`SORRY_WHY`/`MAX_TEXT_CHARS`/`MAX_AUDIENCE_SAID`/`AUDIENCE_PICK_MAX`/`GROUP_SEARCH_MAX`/`permsFor` 逐提交追踪 | 18 个全部未变；6 处「基线找不到、现在有值」是本窗口新增的常量（`WEIGHT_OF_PART`/`RETRIES_PER_INVOCATION`/`FOLLOW_UP_MAX_BATCHES`/`MAX_AUDIENCE_SAID`/`AUDIENCE_PICK_MAX`/`GROUP_SEARCH_MAX`） |
| DOM 属性改名只改一端 | 12 种 `data-*` 属性在写端与读端的分布 | 全部两端一致；`data-map-mode`（R30 地图三视图）与 `data-pick`（R35 挑组）读写同名 |
| 调试残留 | `console.log`/`debugger`/TODO 全仓扫 | public/ 与 worker/ 零命中 |
| CSS 悬空变量 | 剥注释后扫 `var(--x)` 与定义集 | 零悬空（`--focus`/`--line` 只出现在解释性注释里，是 R36 修过的那三处） |
| HTML 标签配平 | 逐标签计数 | 全配平 |
| 密钥 | 全仓扫真实密钥形态 | 零命中；`.gitignore` 窗口内未被改动，`_research_raw/` 排除完好 |

## 三、测试覆盖只增不减

逐提交统计 `test/` 下所有 `test(` 的出现次数，得到一条只升不降的曲线：

```
R24 359a42c 132   R29 7454047 141   R32 a34de8e 167   R35 7154081 196
R28 5430d3c 132   R30 86c7bff 157   R33 655a220 167   R36 65aa31e 196
```

用例名逐提交 diff，只有 R28 那两个 429 用例消失（与功能退役配套）。R36 删掉的两处单行已经
核实有等价覆盖：① `test/worker.test.js` 里一条断言从「显著组里一定有没挑的」换成口径自洽的
断言——原因是 post id 是哈希串、mock 的读数又粗，那条断言看运气（连跑六次显著组数 2/1/1/0/1/1），
它单跑绿、全量红过一次；「没说的」那一栏的正例改由 `test/audience.test.js` 用真实存档钉着
（实测 13 个显著组、`unsaid` 8 行）。② `test/audience.test.js` 从 label key 列表里移掉零引用的
`pickLabel`/`filterLabel`，但 `public/shared/labels.js` 里这两个 key 仍在（有意保留，语义占位）。

## 四、R34 那次重构单独复核

`f54cb52` 把传播层的属性名从字符串换成了列号（`namesOf`/`attributesOf` → `columnsOf`/
`columnsOfPersona`/`flatOf`），理由是 `nextWave` 从 6.2ms 降到 1.2ms。但波次名单是存进
`versions.plan` 的，改名就等于改存档格式，所以必须证明名单一字未变。

**做法**：把 `f54cb52^`（R34 之前）的整棵树用 `git archive` 倒进临时目录，在那里跑今天的
`scripts/golden-waves.js`，把两份输出的 16 行逐行比对。

```
R34 之前 16 行 == 现在 16 行 : True
```

另外把一万人 `exposure` 的读数用旧口径与新口径逐位比对，0 人不一致、最大偏差 0。

## 五、顺手改的一处：空串不是 null

`worker/index.js` 里读 versions 的 JSON 文本列，一共 8 处 `JSON.parse(x ?? 'fallback')`。
`??` 挡得住 null/undefined，**挡不住空串**，而 `JSON.parse('')` 抛
`SyntaxError: Unexpected end of JSON input` → 报告接口整个 500，而不是少渲染一节。

查证这不是现行 bug：`migrations/0001_init.sql:19` 就声明了 `scores TEXT`（可空），历史上所有
写这些列的表达式只有 `JSON.stringify(...)`，**没有任何一版写过空串字面量**；本地 D1 508 行里
`null_scores=0, empty_scores=0`；远端生产库 `posts`/`versions` 各 0 行，`0008`/`0009` 两个迁移
还没应用。也就是说线上今天还没有一条能被它打到的数据。

但它值得修：这一栏的注释本身写着「当时写的是空串/null」——上一位作者以为空串会走到 fallback。
将来任何一条手写数据、导入、或者一次改列的迁移都可能真的写进空串，然后整份报告 500，而排查
方向会完全跑偏到「报告渲染坏了」。所以加了一个 `readJson(text, fallback)` 统一处理：

```js
const readJson = (text, fallback = 'null') => JSON.parse(typeof text === 'string' && text.trim() ? text : fallback);
```

真的写坏了的 JSON 照旧往上抛——那是数据损坏，不该被这里悄悄吞成空对象。

配套的回归断言写在 `test/worker.test.js`（直接改本地 D1 造出空串那一行，因为绕不开写路径）：

- 正常存档先读一次拿到 `looks`/`waves` 基准；
- `UPDATE versions SET scores = ''` 之后报告必须 200、`bands` 为 null、`looks`/`waves` 与基准**一字不差**；
- 换成 NULL 再验一次同义（确认量的是空串、不是被测坏的状态）。

第一版这条断言写成了 `assert.ok(view.reach > 0)`，红了：报告里的 `reach` 是 base64 编码的
`waveBytes`，不是人数。断言写错不是产品错，改断言。

## 六、过期文档数字

`README.md:50` 写「93 个用例」（实际 196，本轮加完是 197），`docs/ARCHITECTURE.md:26` 写
「D1 结构，0001–0005」（实际到 0009）。两处都是窗口外的旧值，本轮顺手改对。

## 七、换行风格：不是问题

`core.autocrlf = true`，`git ls-files --eol` 显示部分文件是 `w/mixed`（工作树混用 CRLF/LF），
但 blob 里存的全是 LF（`git show` 输出无 CR），9 个 probe 脚本的最后字节都是 10。混用只存在于
工作树，是 autocrlf 归一化加上 PowerShell `Set-Content` 追加造成的显示差异，**不影响提交内容**。

## 审计探针自己踩的坑（都不是产品的错）

1. `declare(line, name)` 返回的是 RegExp 对象（永远 truthy），导致所有行都被过滤掉——须 `.test()`。
2. 用 `[^\n]+` 匹配 UPDATE 的 SET 子句时，把 `.bind(..., id, v)` 的实参 `id` 当成了列名，
   3 处假阳性；正则须止于 SQL 字符串引号。
3. PowerShell 的 `[System.IO.File]::ReadAllText($f)` 在中文路径上直接报「文件名、目录名或卷标
   语法不正确」→ 改用 Node 读文件。
4. `execSync('... | Where-Object')` 在 cmd.exe 下不认 PowerShell 的 cmdlet，管道要放到外面。
5. 复刻旧 `pick()` 来对比新旧名单时，我猜错了 hit 判定与补位逻辑，得出「名单不一样」的假警报。
   正确做法是 `git archive` 出旧代码、直接在旧代码上跑 golden 生成器——**验证「重构没改行为」
   时永远不要凭记忆复刻旧行为**。

审计用的一次性脚本共 40 个（`scripts/probe-audit-*.{mjs,ps1}`），跑完已全部删除，不进仓库。
留在仓库里的只有那条回归断言。
