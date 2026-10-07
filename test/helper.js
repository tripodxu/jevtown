// Worker 集成测试基建：用 wrangler 的 unstable_dev 起真实本地环境（D1 + assets + .dev.vars）。
import { execSync } from 'node:child_process';
import { unstable_dev } from 'wrangler';

export async function startWorker(vars = {}) {
  // 迁移是幂等的；--local 复用 .wrangler/state 的本地 D1。
  execSync('npx wrangler d1 migrations apply jevtown --local', { stdio: 'pipe' });
  // 测试请求不带 CF 头 ⇒ workerd 注入 127.0.0.1，CHECK_DAILY_LIMIT 日闸按环回豁免
  // （见 worker/index.js 的 overDailyLimit）；要测闸就在请求头里带假 IP（会原样透传）。
  // JEV_PROVIDER 强制 mock：unstable_dev 的 vars 覆盖 wrangler.jsonc 与 .dev.vars
  // （旧限额闸时代验证过），生产配置改成匿名免费档后测试也绝不碰真实 Jev。
  return unstable_dev('worker/index.js', {
    config: 'wrangler.jsonc',
    port: 0,
    vars: { JEV_PROVIDER: 'mock', ...vars },
  });
}

/** 把一个版本跑完：batch 到 done，再 wave 到 done。author 经 x-jev-author 头带上。 */
export async function runToDone(worker, post, version = 1, author = '') {
  const headers = author ? { 'x-jev-author': author } : {};
  for (;;) {
    for (;;) {
      const res = await worker.fetch(`/api/batch?post=${post}&v=${version}`, { headers });
      if (!res.ok) {
        // 不 ok 说明 post 不存在、版本越界或状态不对——继续打下去只是无限 404，
        // 测试会一直"跑不完"而不是失败。把状态和 body 摊开，一眼看到断在哪。
        throw new Error(`/api/batch → ${res.status} ${await res.text()}`);
      }
      const batch = await res.json();
      if (batch.done) break;
    }
    const res = await worker.fetch(`/api/wave?post=${post}&v=${version}`, { method: 'POST', headers });
    const wave = await res.json();
    if (wave.done) return wave;
  }
}

/** 只把当前波次的批次跑完（不收波），用于构造"可以收波"的中间态（M2 Task C 的测试用）。 */
export async function runBatches(worker, post, version = 1, author = '') {
  const headers = author ? { 'x-jev-author': author } : {};
  for (;;) {
    const res = await worker.fetch(`/api/batch?post=${post}&v=${version}`, { headers });
    if (!res.ok) throw new Error(`/api/batch → ${res.status} ${await res.text()}`);
    const batch = await res.json();
    if (batch.done) return batch;
  }
}

/** 从开局响应取作者令牌（测试里代替浏览器存储）。 */
export const authorOf = (opening) => opening.author ?? '';

export const postJSON = (worker, path, body, headers = {}) =>
  worker.fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
