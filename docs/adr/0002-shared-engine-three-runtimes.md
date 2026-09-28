# ADR-0002 · 引擎三端共用一份源码

- 状态：已采纳
- 日期：2026-09-28
- 背景：同一套检查逻辑要在三个地方跑：Worker（站点分步检查）、Node 终端
  （`scripts/check.js` 一把跑完）、测试（mock 通道）。复制三份必然漂移。
- 决策：引擎放 `public/shared/`，**不 import 任何平台 API**，与决策模型的通信靠调用方
  注入的 `send(provider, { state, questions })`。Worker、Node、测试各自提供 `send`。
- 理由：
  - 上游（gaborishka/jevtown）即此结构，最小改动继承；
  - 平台差异（KV/D1/fetch 头/进程）被压缩进一个函数，引擎保持纯函数风格、可单测；
  - 浏览器端不直连 Jev（经本站 API 中转），避免密钥暴露与 CORS。
- 备选与否决理由：
  - 每端独立实现：立刻获得"平台原生"写法，但三份算法漂移无法接受；
  - 抽成 npm 包：项目无构建步骤，得不偿失。
- 后果：引擎函数签名携带 `send`/回调（如 `mayGoOn` 闸门），新引擎代码必须保持无平台
  依赖；限额/预算等平台策略只能以回调形式注入（见 `docs/modules/shared-engine.md`）。
