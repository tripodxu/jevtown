# R26 · 创意轮：版本深链——`?post=x&v=n` 直达指定版本的报告

> 轮换位置：R25 优化 ⇒ **R26 创意** ⇒ R27 前端。writing-plans 规范，inline 执行。

**点子：** R6 给了报告深链（`?post=<id>`），但多版本帖只能看最新版——"第 1 版当时什么样"
无法分享/收藏。补全：URL 带 `v=n` 直开指定版本（R24 的两版帖正好有真实数据）；对比区
载入第 1 版后 URL 同步，分享出去的就是那个视角。

**顺带修查出的潜在 bug（取证：`?v=999` 现返回 500）：** `loadVersion` 对不存在的版本
返回 null，`showPost` 没有判空直接解引用 → TypeError → 500。应为 404。

## 改动

1. `worker/index.js` showPost：`if (!version) return fail('no such version', 404);`
2. `test/worker.test.js` +1：`?v=999` → 404（不 500）。
3. `app.js`：`openPost(id, versionHint)`——hint 存在时请求 `?v=` 并把 `current.version`
   定死；页面载入与 popstate 读 `post` + `v` 两个参数；深链带 v 时 URL 保持原样。
4. feed 点击仍指最新版（URL 无 v），行为不变。

## 验收

- [ ] `npm run lint` ✓；`npm test` ≥ 119
- [ ] E2E（R24 的两版帖）：`?post=x&v=1` 打开的是 v1 报告（reach=600 而非 10000）、
      对比区可载入；`?v=999` 状态行报错不崩；控制台零错误
- [ ] `MEMORY.md` 记一轮
