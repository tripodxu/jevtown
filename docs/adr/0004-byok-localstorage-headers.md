# ADR-0004 · BYOK：key 存浏览器 localStorage，经请求头透传

- 状态：已采纳
- 日期：2026-09-28
- 背景：站点要支持"用户填自己的 Jev key 即刻用真实模型"，但项目不想自建账号体系，
  也不能让 key 落库或进日志。
- 决策：页面"Key…"弹窗收集 key，只存**浏览器 localStorage**；每次 API 请求经请求头
  带给本 Worker（`providerOf(env, request)` 请求头优先于 env）。Worker 只透传使用，
  不落库、不打日志。正式部署另有 Worker secret 通道（`wrangler secret put`）。
- 理由：
  - 无需账号体系即可让用户花自己的钱用真实模型；
  - 与"部署者 secret"双通道并存：个人部署用 secret（页面免填），公开演示用 BYOK；
  - key 生命周期与浏览器绑定，服务端零存储。
- 备选与否决理由：
  - 服务端存 key（建 users 表）：引入账号/加密/轮换一整套成本，超出 MVP；
  - 只支持部署者 secret：公开部署时所有人都花部署者的钱，不可持续。
- 后果：请求头成为 provider 选择的第一优先级，测试与调试时需注意头与 env 的优先级；
  mock/typesafe/openrouter 三通道由同一 `pickProvider` 逻辑归一。
