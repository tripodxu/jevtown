// POST /api/check 与 POST /api/version：开局打分、审核、排出第一波。两个入口共住一个文件——
// 它们的形状本就互为拷贝（blocked 分支 / plan 构造），放在一起才看得见该一起改的地方。
import { PRESETS, DEFAULT_PRICES } from '../public/shared/presets.js';
import { openingRequest, openingAnswers, MAX_TEXT_CHARS } from '../public/shared/requests.js';
import { firstWave } from '../public/shared/feed.js';
import { rng, hash32 } from '../public/shared/rng.js';
import { crowdOf, cleanAudience, cleanPrices, providerOf, addSpend, loadPost, authorOk, overDailyLimit, json, fail, today, newId, round4 } from './common.js';

// -- POST /api/check：开局 -----------------------------------------------------

async function runCheck(request, env) {
  const body = await request.json().catch(() => ({}));
  const presetId = String(body.preset ?? 'post');
  const text = String(body.text ?? '').trim();
  if (!PRESETS[presetId]) return fail('unknown preset');
  if (!text) return fail('text is empty');
  if (text.length > MAX_TEXT_CHARS) return fail(`text is longer than ${MAX_TEXT_CHARS} chars`);
  const prices = cleanPrices(body.prices);
  if (presetId === 'product' && !prices) return fail(`product 需要 prices：至少两个正数的数组，如 ${DEFAULT_PRICES.join(', ')}`);

  // posts.ip 供每 IP 日闸计数（R28 退役的旧闸护的是站方钱包；D1 写入配额那半由
  // CHECK_DAILY_LIMIT 接管），两个 INSERT 共用这一次读取。
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (await overDailyLimit(env, ip)) return fail('daily check limit for this IP is reached', 429);
  const day = today();
  const provider = providerOf(env, request);
  const pool = 'zh';
  const audience = cleanAudience(body.audience);
  const { answers, usd, tokens, ms } = await provider.ask(openingRequest(presetId, text));
  const opening = openingAnswers(answers);
  const id = newId();
  const author = crypto.randomUUID();
  const now = Date.now();
  const stored = {
    scores: JSON.stringify(opening.scores),
    checks: JSON.stringify(opening.checks),
    unlisted: JSON.stringify(opening.unlisted),
    blocked: JSON.stringify(opening.blocked),
  };

  if (opening.blocked.length) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO posts (id, preset, pool, text, state, created_at, day, ip, author) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, presetId, pool, text, 'blocked', now, day, ip, author),
      env.DB.prepare(
        'INSERT INTO versions (post, number, text, scores, checks, unlisted, blocked, prices, provider, usd, tokens) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(id, text, stored.scores, stored.checks, stored.unlisted, stored.blocked, prices ? JSON.stringify(prices) : null, provider.name, round4(usd), tokens),
      addSpend(env.DB, { post: id, stage: 'opening', usd, tokens, ms, day }),
    ]);
    return json({ post: id, version: 1, state: 'blocked', author, blocked: opening.blocked, unlisted: opening.unlisted, checks: opening.checks });
  }

  // 第一波：传播算法认为最该看到的人（打分越高越靠前），掺少量随机。
  // broadcast（全城广播）：不拿净情绪当闸、把波次跑满——作者想看的是「全镇怎么读」，
  // 不是「传不传得开」，两个问题分开问。存在 plan 这个 JSON 列里，旧存档没有这个键 = 门槛模式。
  const people = crowdOf(pool);
  const random = rng(hash32('waves', pool, `${id}.1`));
  const wave0 = firstWave(people, opening.scores, presetId, random);
  const plan = { wave: 0, answered: 0, history: { 0: wave0.map((who) => who.id) }, ...(body.broadcast === true ? { broadcast: true } : {}) };
  await env.DB.batch([
    env.DB.prepare('INSERT INTO posts (id, preset, pool, text, state, created_at, day, ip, author) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, presetId, pool, text, 'running', now, day, ip, author),
    env.DB.prepare(
      'INSERT INTO versions (post, number, text, scores, checks, unlisted, blocked, plan, prices, provider, usd, tokens, audience) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, text, stored.scores, stored.checks, stored.unlisted, stored.blocked, JSON.stringify(plan), prices ? JSON.stringify(prices) : null, provider.name, round4(usd), tokens, audience ? JSON.stringify(audience) : null),
    addSpend(env.DB, { post: id, stage: 'opening', usd, tokens, ms, day }),
  ]);
  return json({
    post: id,
    version: 1,
    state: 'running',
    author,
    provider: provider.name,
    unlisted: opening.unlisted,
    checks: opening.checks,
    wave: { index: 0, total: wave0.length },
  });
}

// -- POST /api/version：同帖再发一版 ---------------------------------------------

/** 同帖再发一版：新开一个版本号，重新开局（新文本有新的分数与波次），复用同一 post 的受众池。 */
async function runVersion(request, env) {
  const body = await request.json().catch(() => ({}));
  const id = String(body.post ?? '');
  const text = String(body.text ?? '').trim();
  if (!id) return fail('post is required');
  if (!text) return fail('text is empty');
  if (text.length > MAX_TEXT_CHARS) return fail(`text is longer than ${MAX_TEXT_CHARS} chars`);
  const post = await loadPost(env.DB, id);
  if (!post) return fail('no such post', 404);
  if (post.state === 'running') return fail('previous version is still running', 409);

  const day = today();
  // 限额排在作者之前（404 → 409 → 限额 → 作者）：per-IP 计数是全局信息，先返回无害。
  if (await overDailyLimit(env, request.headers.get('CF-Connecting-IP') ?? 'local')) {
    return fail('daily check limit for this IP is reached', 429);
  }
  if (!authorOk(request, post)) return fail('this post is not yours', 403);

  // 版本号与上一版的定价阶梯一趟取回：改版不重报 prices 时沿用（商品的阶梯是帖子的
  // 属性，不该因为发了个新版本就静默换回默认档——v2 起丢阶梯曾是真 bug）。
  const row = await env.DB.prepare(
    'SELECT COALESCE(MAX(number), 0) + 1 AS number, (SELECT prices FROM versions WHERE post = ? ORDER BY number DESC LIMIT 1) AS lastPrices FROM versions WHERE post = ?',
  ).bind(id, id).first();
  const number = row.number;
  const prices = cleanPrices(body.prices) ?? (row.lastPrices ? JSON.parse(row.lastPrices) : null);
  const provider = providerOf(env, request);
  const pool = post.pool;
  const audience = cleanAudience(body.audience);
  const { answers, usd, tokens, ms } = await provider.ask(openingRequest(post.preset, text));
  const opening = openingAnswers(answers);

  if (opening.blocked.length) {
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO versions (post, number, text, scores, checks, unlisted, blocked, prices, provider, usd, tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(id, number, text, JSON.stringify(opening.scores), JSON.stringify(opening.checks), JSON.stringify(opening.unlisted), JSON.stringify(opening.blocked), prices ? JSON.stringify(prices) : null, provider.name, round4(usd), tokens),
      addSpend(env.DB, { post: id, number, stage: 'opening', usd, tokens, ms, day: today() }),
    ]);
    return json({ post: id, version: number, state: 'blocked', author: post.author, blocked: opening.blocked });
  }

  const people = crowdOf(pool);
  const random = rng(hash32('waves', pool, `${id}.${number}`));
  const wave0 = firstWave(people, opening.scores, post.preset, random);
  const plan = { wave: 0, answered: 0, history: { 0: wave0.map((who) => who.id) }, ...(body.broadcast === true ? { broadcast: true } : {}) };
  await env.DB.batch([
    env.DB.prepare('UPDATE posts SET state = ? WHERE id = ?').bind('running', id),
    env.DB.prepare(
      'INSERT INTO versions (post, number, text, scores, checks, unlisted, blocked, plan, prices, provider, usd, tokens, audience) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, number, text, JSON.stringify(opening.scores), JSON.stringify(opening.checks), JSON.stringify(opening.unlisted), JSON.stringify(opening.blocked), JSON.stringify(plan), prices ? JSON.stringify(prices) : null, provider.name, round4(usd), tokens, audience ? JSON.stringify(audience) : null),
    addSpend(env.DB, { post: id, number, stage: 'opening', usd, tokens, ms, day: today() }),
  ]);
  return json({ post: id, version: number, state: 'running', wave: { index: 0, total: wave0.length } });
}

export { runCheck, runVersion };
