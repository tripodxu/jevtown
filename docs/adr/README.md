# adr/ · 架构决策记录

> ADR 记录**为什么这样做**，以及当时否决了什么。代码会变，理由长期有效。
> 新决策：复制模板建 `000N-*.md`，编号递增，并在本索引登记。

| 编号 | 决策 | 状态 |
|---|---|---|
| [0001](0001-cloudflare-worker-d1-assets.md) | Cloudflare Worker + D1 + 边缘 assets，不用 Pages Functions | 已采纳 |
| [0002](0002-shared-engine-three-runtimes.md) | 引擎三端共用一份源码，通信靠注入 `send` | 已采纳 |
| [0003](0003-mock-provider-default.md) | mock 为默认通道，真实 key 可选切换 | 已采纳 |
| [0004](0004-byok-localstorage-headers.md) | BYOK：key 存浏览器 localStorage，经请求头透传 | 已采纳 |

## 模板

```markdown
# ADR-000N · <标题>

- 状态：已采纳 / 已否决 / 已被 ADR-000M 取代
- 日期：YYYY-MM-DD
- 背景：<当时面对什么问题>
- 决策：<选择了什么>
- 理由：<为什么>
- 备选与否决理由：<考虑过什么，为什么不要>
- 后果：<带来了什么约束/成本>
```
