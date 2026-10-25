// 一个 Cloudflare Worker：Jevtown 中文小镇的 API。静态页面由 assets 直接服务（见 wrangler.jsonc），
// Worker 只接 /api/*。检查由浏览器分步驱动（免费档一次调用只有 50 个外呼和 10ms CPU）：
//   POST /api/check  开局：审核 + 传播算法打分（一个请求），排出第一波
//   GET  /api/batch  问 Jev 一批（100 个人格、每人一道 Choice 题），落库
//   POST /api/wave   收波：算情绪定去留；最后一波收尾，把收尾提问发给小镇
//   GET  /api/post/:id  汇总一页所需的一切
//   GET  /api/feed      最近的检查
// 引擎全部来自 public/shared/（上游 gaborishka/jevtown，MIT），Worker 只做编排和存取。
// 路由实现按域拆在旁边四个文件（opening/batch/wave/report），共用小件在 common.js（B8 拆分）。
import { fail } from './common.js';
import { runCheck, runVersion } from './opening.js';
import { runBatch } from './batch.js';
import { closeWave } from './wave.js';
import { runAway, showPost, listFeed, runDelete } from './report.js';

// -- 路由 ----------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      if (request.method === 'POST' && path === '/api/check') return await runCheck(request, env);
      if (request.method === 'POST' && path === '/api/version') return await runVersion(request, env);
      if (request.method === 'GET' && path === '/api/batch') return await runBatch(url, request, env);
      if (request.method === 'POST' && path === '/api/wave') return await closeWave(url, request, env);
      if (request.method === 'GET' && path.startsWith('/api/post/')) return await showPost(path.slice('/api/post/'.length), env, url, request);
      if (request.method === 'DELETE' && path.startsWith('/api/post/')) return await runDelete(path.slice('/api/post/'.length), request, env);
      if (request.method === 'POST' && path === '/api/away') return await runAway(url, request, env);
      if (request.method === 'GET' && path === '/api/feed') return await listFeed(env);
      return fail('not found', 404);
    } catch (error) {
      console.error(path, error);
      // 上游限流/网关繁忙（ask() 的 429/5xx 重试耗尽）是"稍后再来"，不是我们的 bug：
      // 503 让客户端的退避重试能识别它；error.status 是 D1 等抛出的既有状态码，优先尊重。
      const upstreamBusy = error?.throttled || error?.throttledTimes;
      return fail(error?.message ?? 'worker error', error?.status ?? (upstreamBusy ? 503 : 500));
    }
  },
};

