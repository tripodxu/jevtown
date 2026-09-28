// Worker 集成测试基建：用 wrangler 的 unstable_dev 起真实本地环境（D1 + assets + .dev.vars）。
import { execSync } from 'node:child_process';
import { unstable_dev } from 'wrangler';

export async function startWorker(vars = {}) {
  // 迁移是幂等的；--local 复用 .wrangler/state 的本地 D1。
  execSync('npx wrangler d1 migrations apply jevtown --local', { stdio: 'pipe' });
  return unstable_dev('worker/index.js', {
    config: 'wrangler.jsonc',
    port: 0,
    vars: { CROWD_DAILY_LIMIT: '0', CROWD_DAILY_BUDGET_USD: '0', ...vars }, // 测试默认不受限额
  });
}

/** 把一个版本跑完：batch 到 done，再 wave 到 done。author 经 x-jev-author 头带上。 */
export async function runToDone(worker, post, version = 1, author = '') {
  const headers = author ? { 'x-jev-author': author } : {};
  for (;;) {
    for (;;) {
      const res = await worker.fetch(`/api/batch?post=${post}&v=${version}`, { headers });
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
    const batch = await res.json();
    if (batch.done) return batch;
  }
}

/** 从开局响应取作者令牌（测试里代替浏览器存储）。 */
export const authorOf = (opening) => opening.author ?? '';

export const postJSON = (worker, path, body, headers = {}) =>
  worker.fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
