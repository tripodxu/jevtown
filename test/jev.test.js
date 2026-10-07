// provider 层的纯函数契约：通道注册、pickProvider 的选中顺序、免费档的零成本记账。
// 不发真请求——真实调用一律走 mock（TESTING.md 规则 3）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, pickProvider, TYPESAFE_USD_PER_TOKEN } from '../public/shared/jev.js';

test('三条通道都在册，地址与模型 id 各就各位', () => {
  assert.equal(PROVIDERS.typesafe.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(PROVIDERS.openrouter.url, 'https://openrouter.ai/api/alpha/decisions');
  // OpenCode Zen（2026-10 接入）：System One 形状与 TypeSafe 官方 API 相同，模型是免费档
  assert.equal(PROVIDERS.opencode.url, 'https://opencode.ai/zen/v1/systemone');
  assert.equal(PROVIDERS.opencode.model, 'jev-1.13-free');
  assert.equal(PROVIDERS.opencode.keyName, 'OPENCODE_API_KEY');
});

test('Zen 免费档的记账：usage 爱给不给，账面恒 0（免费档不计费）', () => {
  // 2026-10-07 真 key 实测：响应带 usage{input_tokens,output_tokens}，tokens 走 ask() 的
  // 通用读取即可；免费档不计费，usd 必须恒 0，且不能被 usage 里的任何字段带偏
  assert.equal(PROVIDERS.opencode.usd(undefined), 0);
  assert.equal(PROVIDERS.opencode.usd({ input_tokens: 21_168 }), 0);
  // 对照：TypeSafe 按 input_tokens 计价（每百万 token $0.042），不能被顺手改成 0
  assert.equal(PROVIDERS.typesafe.usd({ input_tokens: 1e6 }), 1e6 * TYPESAFE_USD_PER_TOKEN);
});

test('pickProvider：显式指定 opencode 优先；只有它的 key 也能选中；无 key 返回 null', () => {
  const forced = pickProvider({ JEV_PROVIDER: 'opencode', OPENCODE_API_KEY: 'zen-key' });
  assert.equal(forced.name, 'opencode');
  assert.equal(forced.model, 'jev-1.13-free');
  assert.equal(forced.apiKey, 'zen-key');

  // env 兜底顺序：TypeSafe 优先，opencode 排末位（免费档有限额，不默默吃全站流量）
  const both = pickProvider({ TYPESAFE_API_KEY: 'a', OPENCODE_API_KEY: 'b' });
  assert.equal(both.name, 'typesafe');
  const only = pickProvider({ OPENCODE_API_KEY: 'zen-key' });
  assert.equal(only.name, 'opencode');

  assert.equal(pickProvider({}), null);
  // 注意 JEV_PROVIDER=mock 的拦截在 worker 的 providerOf（wanted !== 'mock' 才问 pickProvider），
  // 不在 pickProvider 自己——这里不钉它。
});
