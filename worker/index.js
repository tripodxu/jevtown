// 一个 Cloudflare Worker：Jevtown 中文小镇的 API。静态页面由 assets 直接服务（见 wrangler.jsonc），
// Worker 只接 /api/*。检查由浏览器分步驱动（免费档一次调用只有 50 个外呼和 10ms CPU）：
//   POST /api/check  开局：审核 + 传播算法打分（一个请求），排出第一波
//   GET  /api/batch  问 Jev 一批（100 个人格、每人一道 Choice 题），落库
//   POST /api/wave   收波：算情绪定去留；最后一波收尾，把收尾提问发给小镇
//   GET  /api/post/:id  汇总一页所需的一切
//   GET  /api/feed      最近的检查
// 引擎全部来自 public/shared/（上游 gaborishka/jevtown，MIT），Worker 只做编排和存取。
import { crowd, persona, personaLine, CROWD } from '../public/shared/personas.js';
import { PRESETS, CANT_TELL, priceLadder } from '../public/shared/presets.js';
import { openingRequest, openingAnswers, reactionRequest, questionId, MAX_TEXT_CHARS, followUpRequest } from '../public/shared/requests.js';
import { firstWave, nextWave, mood, travels, gatherAsked, asking, emptyGathered, exposureBands } from '../public/shared/feed.js';
import { drawReaction } from '../public/shared/draw.js';
import { askQuestion, mergeSaid, listsOf } from '../public/shared/check.js';
import { counters, segments, topSegments, voicesOf, reconcileAudience, pickableGroups } from '../public/shared/summary.js';
import { crowdTerrain } from '../public/shared/spatial.js';
import { encodeBytes, decodeBytes } from '../public/shared/bytes.js';
import { personView } from '../public/shared/labels.js';
import { runAblation } from '../public/shared/away.js';
import { pickProvider, PROVIDERS, ask as askJev } from '../public/shared/jev.js';
import { createMockAsk } from '../public/shared/mock.js';
import { rng, hash32 } from '../public/shared/rng.js';

const PER_REQUEST = 100;
const WAVES_MAX = 4;
/**
 * 免费档一次 Worker 调用最多 50 个外呼，而一次收波要在同一次调用里把追问与收尾问句问完。
 * 追问是 stopped 的全部人（实测两三千 → 十几批），无上限就会撞墙，撞墙的表现是整次收波被
 * Cloudflare 中断、post 卡在 closing 等人重试——重试还要再付一次钱。留出门来：批数封顶，
 * 超出的批次不问了，页面上追问少问几个人，比整次收尾失败便宜。
 */
const FOLLOW_UP_MAX_BATCHES = 24;

/**
 * 作者自述的一句「这段话是给谁的」（R35）。上限比 MAX_TEXT_CHARS 小：这句话是清单的标题，
 * 不是正文，写到 200 字还没挑出组的人，多写的 500 字只是在给存档增重。
 */
const MAX_AUDIENCE_SAID = 200;

/**
 * 清洗 body.audience。挑的必须是 `summary.js` 的 pickableGroups 里真有的段 id——作者端已经
 * 只让他从清单里挑，这里再挡一道：存档是外部输入，一个陌生的 id 进到对账表里只会变成一行
 * 「查不到这个组」，比直接丢更让人以为自己填错了。said 为空又没挑组就当没填（null）。
 */
function cleanAudience(input) {
  if (!input || typeof input !== 'object') return null;
  const picked = Array.isArray(input.picked)
    ? [...new Set(input.picked.filter((id) => typeof id === 'string' && pickableIds().has(id)))].slice(0, AUDIENCE_PICK_MAX)
    : [];
  const said = typeof input.said === 'string' ? input.said.trim().slice(0, MAX_AUDIENCE_SAID) : '';
  if (!said && !picked.length) return null;
  return { said, picked };
}

const PICKABLE = new Set();
let pickableBuilt = false;
function pickableIds() {
  if (!pickableBuilt) {
    pickableBuilt = true;
    for (const one of pickableGroups(crowdOf('zh'))) PICKABLE.add(one.id);
  }
  return PICKABLE;
}
/** 挑的组没有上限的意义（清单只有 115 项），但也不许一个请求塞十万个 id 进来。 */
const AUDIENCE_PICK_MAX = 115;

/**
 * 全城人群的模块级缓存：crowd() 算 1 万人格约 155ms，而 runCheck/closeWave/showPost 每个请求都要用。
 * Worker 的模块作用域在同一 isolate 内跨请求存活，热身后每请求 0ms；换池（未来加 en）也只算一次。
 */
const crowdCache = new Map();
function crowdOf(pool) {
  let people = crowdCache.get(pool);
  if (!people) crowdCache.set(pool, (people = crowd(pool)));
  return people;
}

/**
 * 地形结果按 post.v 缓存（isolate 内存）：crowdTerrain 每请求约 8ms，是 showPost 纯计算的
 * 大头（R4 剖析）。反应只在 running 期间增长，closing/done 后冻结——只对非 running 的版本
 * 写缓存，同一份报告重复查看（刷新/多人看/对比区回拉 v1）不再重算置换检验。
 * 版本号只增不复用 ⇒ 无失效路径，仅限容量防长驻 isolate 泄漏。
 */
const terrainCache = new Map();
const TERRAIN_CACHE_MAX = 200;

function terrainFor(presetId, keys, bytes, versionId, frozen) {
  if (!frozen) return crowdTerrain(presetId, keys, bytes, { versionId });
  let terrain = terrainCache.get(versionId);
  if (!terrain) {
    terrain = crowdTerrain(presetId, keys, bytes, { versionId });
    if (terrainCache.size >= TERRAIN_CACHE_MAX) terrainCache.delete(terrainCache.keys().next().value);
    terrainCache.set(versionId, terrain);
  }
  return terrain;
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const fail = (message, status = 400) => json({ error: message }, status);

const today = () => new Date().toISOString().slice(0, 10);
const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);
const round2 = (value) => Math.round(value * 100) / 100;
// 钱的账面精度是 4 位小数：真实单价 ~$0.0015/批，round2 会把每一批抹成 0
// （2026-09-30 实测：站点 $0.010 vs CLI $0.033，日预算闸随之失明）。
// 显示口径不变（toFixed(3/4)），只有存储与累加变准。
const round4 = (value) => Math.round(value * 10000) / 10000;

/**
 * 这台 Worker 用哪条路到 Jev，优先级：请求头 BYOK（x-jev-provider + x-jev-key，访客在页面设置里填的）
 * → env 配置（JEV_PROVIDER + secret）→ mock（本地开发零门槛）。
 * BYOK 的 key 只在本请求内存里用一次，不落库不打日志。
 *
 * retries 是「一次 Worker 调用」的共享重试预算，40 不是 MAX_ATTEMPTS：单个请求失败重试 5 次是
 * 单批自己的事，而一次收波要在同一次调用里连发几十个批次，每个批次都带 5 次重试会先撞 Cloudflare
 * 的 50 外呼上限。所以这里发一份总配额给本次调用的所有批次——重试优先给前面的批次用完，
 * 后面的批次失败就直接失败（批次认领制会把它们留在 answered 之外，下一批次还会问它们）。
 */
const RETRIES_PER_INVOCATION = 40;

function providerOf(env, request = null) {
  if (request) {
    const headerName = String(request.headers.get('x-jev-provider') ?? '').trim().toLowerCase();
    const headerKey = String(request.headers.get('x-jev-key') ?? '').trim();
    if (headerKey && PROVIDERS[headerName]) {
      const picked = { ...PROVIDERS[headerName], apiKey: headerKey };
      const retries = { left: RETRIES_PER_INVOCATION };
      return { name: headerName, ask: (req) => askJev(picked, req, retries) };
    }
  }
  const wanted = String(env.JEV_PROVIDER ?? '').trim().toLowerCase();
  if (wanted !== 'mock') {
    const picked = pickProvider(env);
    if (picked) {
      const retries = { left: RETRIES_PER_INVOCATION };
      return { name: picked.name, ask: (req) => askJev(picked, req, retries) };
    }
  }
  return { name: 'mock', ask: createMockAsk() };
}

// -- D1 小助手 ----------------------------------------------------------------

const loadPost = async (db, id) => (await db.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first()) ?? null;
const loadVersion = async (db, id, number = 1) =>
  (await db.prepare('SELECT * FROM versions WHERE post = ? AND number = ?').bind(id, number).first()) ?? null;

/** 写操作的作者校验：x-jev-author 头必须与 posts.author 一致（旧帖 author 为 NULL 时一律拒绝）。 */
const authorOk = (request, post) => {
  const sent = String(request?.headers.get('x-jev-author') ?? '');
  return !!post.author && sent === post.author;
};

/** 记一笔调用流水（请求数以行计，同键冲突时累加金额与耗时）。返回 D1 语句（可直接进 db.batch，单独执行时加 .run()）。 */
const addSpend = (db, { post, number = 1, stage, n = 0, usd = 0, tokens = 0, ms = 0, day }) =>
  db.prepare(
    'INSERT INTO batches (post, number, stage, n, usd, tokens, ms, day) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT (post, number, stage, n) DO UPDATE SET usd = usd + excluded.usd, tokens = tokens + excluded.tokens, ms = ms + excluded.ms',
  )
    .bind(post, number, stage, n, round4(usd), Math.round(tokens), Math.round(ms), day);

// R28：站点不提供站方 key——每 IP 每日限额与全站日预算两个闸整体退役
//（它们保护的站方钱包不存在了；真实检查一律走访客自填的 BYOK key，无 key 即 mock）。

/** 一条 post 某个版本的所有反应，作为 Map<personaId, reactionId>。 */
const reactionsMap = async (db, id, number = 1) => {
  const { results } = await db.prepare('SELECT id, reaction FROM reactions WHERE post = ? AND number = ?').bind(id, number).all();
  return new Map(results.map((row) => [row.id, row.reaction]));
};

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
      if (request.method === 'POST' && path === '/api/away') return await runAway(url, request, env);
      if (request.method === 'GET' && path === '/api/feed') return await listFeed(env);
      return fail('not found', 404);
    } catch (error) {
      console.error(path, error);
      return fail(error?.message ?? 'worker error', error?.status ?? 500);
    }
  },
};

// -- POST /api/check：开局 -----------------------------------------------------

async function runCheck(request, env) {
  const body = await request.json().catch(() => ({}));
  const presetId = String(body.preset ?? 'post');
  const text = String(body.text ?? '').trim();
  if (!PRESETS[presetId]) return fail('unknown preset');
  if (!text) return fail('text is empty');
  if (text.length > MAX_TEXT_CHARS) return fail(`text is longer than ${MAX_TEXT_CHARS} chars`);
  const prices = presetId === 'product'
    ? (Array.isArray(body.prices) && body.prices.every((n) => Number.isFinite(n) && n > 0) && body.prices.length >= 2 ? body.prices.map(Number) : null)
    : null;
  if (presetId === 'product' && !prices) return fail('product 需要 prices：至少两个正数的数组，如 [9,19,39,79]');

  // posts.ip 只剩观测用途（每 IP 限额已随 R28 退役），但列还在迁移里，写 NULL 等于把这份
  // 观测数据扔掉——同一个头仍读一次，两个 INSERT 共用。
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
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
  const people = crowdOf(pool);
  const random = rng(hash32('waves', pool, `${id}.1`));
  const wave0 = firstWave(people, opening.scores, presetId, random);
  const plan = { wave: 0, answered: 0, history: { 0: wave0.map((who) => who.id) } };
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
  if (!authorOk(request, post)) return fail('this post is not yours', 403);

  const row = await env.DB.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS number FROM versions WHERE post = ?').bind(id).first();
  const number = row.number;
  const provider = providerOf(env, request);
  const pool = post.pool;
  const audience = cleanAudience(body.audience);
  const { answers, usd, tokens, ms } = await provider.ask(openingRequest(post.preset, text));
  const opening = openingAnswers(answers);

  if (opening.blocked.length) {
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO versions (post, number, text, scores, checks, unlisted, blocked, provider, usd, tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(id, number, text, JSON.stringify(opening.scores), JSON.stringify(opening.checks), JSON.stringify(opening.unlisted), JSON.stringify(opening.blocked), provider.name, round4(usd), tokens),
      addSpend(env.DB, { post: id, number, stage: 'opening', usd, tokens, ms, day: today() }),
    ]);
    return json({ post: id, version: number, state: 'blocked', author: post.author, blocked: opening.blocked });
  }

  const people = crowdOf(pool);
  const random = rng(hash32('waves', pool, `${id}.${number}`));
  const wave0 = firstWave(people, opening.scores, post.preset, random);
  const plan = { wave: 0, answered: 0, history: { 0: wave0.map((who) => who.id) } };
  await env.DB.batch([
    env.DB.prepare('UPDATE posts SET state = ? WHERE id = ?').bind('running', id),
    env.DB.prepare(
      'INSERT INTO versions (post, number, text, scores, checks, unlisted, blocked, plan, provider, usd, tokens, audience) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, number, text, JSON.stringify(opening.scores), JSON.stringify(opening.checks), JSON.stringify(opening.unlisted), JSON.stringify(opening.blocked), JSON.stringify(plan), provider.name, round4(usd), tokens, audience ? JSON.stringify(audience) : null),
    addSpend(env.DB, { post: id, number, stage: 'opening', usd, tokens, ms, day: today() }),
  ]);
  return json({ post: id, version: number, state: 'running', wave: { index: 0, total: wave0.length } });
}

// -- POST /api/away：哪一句在撑 ---------------------------------------------------

// 按钮触发，不阻塞主流程：传播还在跑的时候问「哪句在撑」没有意义（文本的处境还在变），
// 所以只在 post 已经 done 时才接。算过就还旧结果——回访不该重复花钱。
// 外呼上限比 providerOf 的共享预算松一点：这里只在作者点了按钮时才跑，句数也已限到 6。
const AWAY_MAX_CALLS = 50;
/** batches.n 的分工：base / control / noise 走负数，gone:<i> 走句号下标，各自一行不互相累加。 */
const AWAY_N = { base: -1, control: -2, noise: -3 };

/**
 * 删掉第 i 句后 Jev 会改多少主意（public/shared/away.js）。一句一路消融读数，
 * 连同 BASE / CONTROL / NOISE 一共 N+3 次请求；每路返回后记一次流水。
 */
async function runAway(url, request, env) {
  const id = url.searchParams.get('post');
  const v = Number(url.searchParams.get('v') ?? '1') || 1;
  if (!id) return fail('post is required');
  const post = await loadPost(env.DB, id);
  if (!post) return fail('no such post', 404);
  if (!authorOk(request, post)) return fail('this post is not yours', 403);
  if (post.state !== 'done') return fail('the check is not finished yet', 409);
  const version = await loadVersion(env.DB, id, v);
  if (!version) return fail('no such version', 404);
  const stored = version.away ? JSON.parse(version.away) : null;
  if (stored) return json({ post: id, version: v, away: stored, cached: true });

  const provider = providerOf(env, request);
  const day = today();
  const result = await runAblation((req) => provider.ask(req), {
    presetId: post.preset,
    text: version.text,
    maxCalls: AWAY_MAX_CALLS,
    onSent: (key, sent) => addSpend(env.DB, { post: id, number: v, stage: 'ablate', n: AWAY_N[key] ?? Number(key.split(':')[1]), usd: sent.usd, tokens: sent.tokens, ms: sent.ms, day }).run(),
  });
  if (!result.sentences.length) return fail(result.error ?? 'ablation failed');
  const away = { sentences: result.sentences, noise: result.noise, worded: result.worded, settled: result.settled, groups: result.groups, provider: provider.name };
  await env.DB.prepare('UPDATE versions SET away = ? WHERE post = ? AND number = ?').bind(JSON.stringify(away), id, v).run();
  return json({ post: id, version: v, away, cached: false });
}

// -- GET /api/batch：问 Jev 一批人 ---------------------------------------------

async function runBatch(url, request, env) {
  const id = url.searchParams.get('post');
  const v = Number(url.searchParams.get('v') ?? '1') || 1;
  const post = await loadPost(env.DB, id);
  if (!post) return fail('no such post', 404);
  if (post.state !== 'running') return fail('the check is not running', 409);
  if (!authorOk(request, post)) return fail('this check is not yours', 403);
  const version = await loadVersion(env.DB, id, v);
  const plan = JSON.parse(version.plan);
  const order = plan.history[String(plan.wave)];
  const start = plan.answered;
  if (start >= order.length) return json({ done: true, answered: start, total: order.length });

  const presetId = post.preset;
  const pool = post.pool;
  const batch = order.slice(start, start + PER_REQUEST);
  const people = batch.map((pid) => persona(pool, pid));
  const provider = providerOf(env, request);
  // 原子认领本批：只有 answered 仍等于 start 时才 +batch.length，防两个并发批次问同一批人。
  const claim = await env.DB.prepare(
    "UPDATE versions SET plan = json_set(plan, '$.answered', json_extract(plan, '$.answered') + ?) WHERE post = ? AND number = ? AND json_extract(plan, '$.answered') = ?",
  ).bind(batch.length, id, v, start).run();
  if (!claim.meta.changes) return fail('this batch was already claimed, retry', 409);
  let answers;
  let usd;
  let tokens;
  let ms;
  try {
    ({ answers, usd, tokens, ms } = await provider.ask(reactionRequest(presetId, version.text, people)));
  } catch (error) {
    // 问 Jev 失败：把认领还回去，下一批（或重试）会问回这批人。
    // 条件回滚：answered 仍等于 start + batch.length 才退，说明期间没人接着认领。
    // 若他人已接着认领过（answered 更大），放弃回滚——本批 100 人跳过，与"进程被杀"窗口
    // 同等降级，但绝不擦掉他人认领（那会让下一请求重问同一批人，撞 reactions 主键 500）。
    try {
      await env.DB.prepare(
        "UPDATE versions SET plan = json_set(plan, '$.answered', json_extract(plan, '$.answered') - ?) " +
          "WHERE post = ? AND number = ? AND json_extract(plan, '$.answered') = ?",
      ).bind(batch.length, id, v, start + batch.length).run();
    } catch (error2) {
      console.error('release batch claim', id, v, error2?.message);
    }
    throw error;
  }

  const versionId = `${id}.${v}`;
  // 决策样本：只采第一波的第一批（曝光最靠前的人），留存 Jev 读到的原句与它给出的分布。
  let decisionSamples = null;
  const drawnPairs = [];
  const statements = batch.map((pid, index) => {
    const probabilities = answers[questionId(people[index])]?.probabilities ?? {};
    const reaction = drawReaction(probabilities, pool, pid, versionId) ?? CANT_TELL;
    drawnPairs.push({ id: pid, reaction });
    if (start === 0 && !version.decisions && decisionSamples?.length !== 10) {
      (decisionSamples ??= []).push({
        id: pid,
        line: personaLine(people[index], PRESETS[presetId]),
        ask: PRESETS[presetId].ask,
        probabilities,
        reaction,
      });
    }
    return env.DB.prepare('INSERT INTO reactions (post, number, id, wave, reaction) VALUES (?, ?, ?, ?, ?)')
      .bind(id, v, pid, plan.wave, reaction);
  });
  if (decisionSamples) statements.push(env.DB.prepare('UPDATE versions SET decisions = ? WHERE post = ? AND number = ?').bind(JSON.stringify(decisionSamples), id, v));
  statements.push(
    // answered 已在认领时推进，这里只累加花费与 tokens。
    env.DB.prepare('UPDATE versions SET usd = usd + ?, tokens = tokens + ? WHERE post = ? AND number = ?')
      .bind(round4(usd), tokens, id, v),
    addSpend(env.DB, { post: id, number: v, stage: `wave${plan.wave}`, n: start, usd, tokens, ms, day: today() }),
  );
  await env.DB.batch(statements);
  // drawn = 这批人各自被 Jev 判定成了什么（前端实时点亮地图用）；usd/tokens/ms = 本批调用成本。
  return json({ answered: start + batch.length, total: order.length, wave: plan.wave, drawn: drawnPairs, usd: round4(usd), tokens, ms });
}

// -- POST /api/wave：收波、定去留、收尾 ----------------------------------------

async function closeWave(url, request, env) {
  const id = url.searchParams.get('post');
  const v = Number(url.searchParams.get('v') ?? '1') || 1;
  const post = await loadPost(env.DB, id);
  if (!post) return fail('no such post', 404);
  if (post.state !== 'running') return fail('the check is not running', 409);
  if (!authorOk(request, post)) return fail('this check is not yours', 403);

  // 原子占位：同一检查的并发收波只有一个能把 running → closing，其余 409。
  const claim = await env.DB.prepare("UPDATE posts SET state = 'closing' WHERE id = ? AND state = 'running'").bind(id).run();
  if (!claim.meta.changes) return fail('the check is already closing', 409);
  // 占位成功后 plan 即被冻结（batch/wave 都以 running 为门），门检查放在这里无竞态。
  const release = async () => {
    try {
      await env.DB.prepare("UPDATE posts SET state = 'running' WHERE id = ? AND state = 'closing'").bind(id).run();
    } catch (error) {
      console.error('release closing', id, error?.message);
    }
  };
  try {
    // 空波门：当前波次没有任何回答就不许收——否则 travels([]) 为 false 会直接走收尾、跳过整个波次。
    const version = await loadVersion(env.DB, id, v);
    const wave = JSON.parse(version.plan ?? '{}').wave;
    const { results: answered } = await env.DB.prepare('SELECT 1 FROM reactions WHERE post = ? AND number = ? AND wave = ? LIMIT 1').bind(id, v, wave).all();
    if (!answered.length) {
      await release();
      return fail('this wave has no answers yet', 409);
    }
    return await settleWave(env, post, id, v, request);
  } catch (error) {
    await release();
    throw error;
  }
}

/** 收波本体：算情绪定去留；推进则把状态还回 running（批次还要继续），收尾则置 done。 */
async function settleWave(env, post, id, v, request) {
  const version = await loadVersion(env.DB, id, v);
  const plan = JSON.parse(version.plan);
  const presetId = post.preset;
  const pool = post.pool;
  const preset = PRESETS[presetId];
  const scores = JSON.parse(version.scores);
  const maxWaves = Math.min(Number(env.CROWD_MAX_WAVES ?? WAVES_MAX), WAVES_MAX);
  const provider = providerOf(env, request);

  const waveIndex = plan.wave;
  const order = plan.history[String(waveIndex)];
  const { results: waveRows } = await env.DB.prepare('SELECT reaction FROM reactions WHERE post = ? AND number = ? AND wave = ?')
    .bind(id, v, waveIndex)
    .all();
  const drawn = waveRows.map((row) => row.reaction);
  const waveMood = mood(presetId, drawn);
  const waveTravels = travels(presetId, drawn);
  const waveInfo = { index: waveIndex, asked: order.length, size: drawn.length, mood: round2(waveMood), travels: waveTravels };

  const reached = await reactionsMap(env.DB, id, v);

  // 传播：够 glad，且还有波次与还没看到的人。
  if (waveTravels && waveIndex + 1 < maxWaves && reached.size < CROWD) {
    const people = crowdOf(pool);
    const random = rng(hash32('waves', pool, `${id}.${v}.${waveIndex + 1}`));
    const next = nextWave(people, reached, scores, presetId, waveIndex + 1, random);
    plan.wave = waveIndex + 1;
    plan.answered = 0;
    plan.history[String(waveIndex + 1)] = next.map((who) => who.id);
    await env.DB.batch([
      env.DB.prepare('UPDATE versions SET plan = ? WHERE post = ? AND number = ?').bind(JSON.stringify(plan), id, v),
      env.DB.prepare("UPDATE posts SET state = 'running' WHERE id = ? AND state = 'closing'").bind(id),
    ]);
    return json({ wave: waveInfo, travels: true, next: { index: waveIndex + 1, total: next.length } });
  }

  // 检查收尾：把收尾提问（为什么划走/什么让他们停下/会评论什么）发给到达过的人。
  const people = crowdOf(pool);
  const reactionOf = (pid) => reached.get(pid);
  const followUp = await runFollowUp(env, post, version, provider, reached, people, v);
  let gathered = emptyGathered();
  for (const wave of Object.keys(plan.history).sort((a, b) => a - b)) {
    gathered = gatherAsked(presetId, plan.history[wave], reactionOf, gathered);
  }
  const closing = asking(presetId, version.text, gathered);
  const parts = [];
  const missing = {};
  let askUsd = 0;
  let askTokens = 0;
  let askMs = 0;
  for (const { question, ids } of closing) {
    if (!ids.length) continue;
    try {
      const { part, usd, tokens, ms } = await askQuestion(provider.ask, question, {
        presetId,
        text: version.text,
        people: ids.map((pid) => people[pid]),
        reactionOf,
        pool,
        versionId: `${id}.${v}`,
      });
      parts.push(part);
      askUsd += usd;
      askTokens += tokens;
      askMs += ms;
      await addSpend(env.DB, { post: id, number: v, stage: 'ask', n: parts.length - 1, usd, tokens, ms, day: today() }).run();
    } catch (error) {
      // 跟 shared/check.js 同一分流：fatal / no_key 不是"这题没答上"，是"这条通道废了"。
      // 吞下去只会把收尾问题全标成 failed，而帖子照常 done——页面看着完整，其实一个答案都没有。
      if (error.fatal || error.code === 'no_key') throw error;
      console.error('ask', question, error?.message);
      for (const list of listsOf(question, presetId, ids, reactionOf)) missing[list] = 'failed';
    }
  }
  const said = mergeSaid(parts, missing);
  // 报告快照（R25）：冻结的两份字节随"置 done"同批写入——读路径从 1 万行 reactions 降到 1 行。
  // bytes 来自 reached（pid → reaction）；waveBytes 用 plan.history（波次 → 名单）回填，
  // 只标记真正被判定到的人（批次失败的问过但没答，不算到达）。
  const snapKeys = Object.keys(preset.reactions);
  const snapBytes = new Uint8Array(CROWD);
  const snapWave = new Uint8Array(CROWD);
  for (const [pid, reaction] of reached) {
    const index = snapKeys.indexOf(reaction);
    snapBytes[pid] = index >= 0 ? index + 1 : 0;
  }
  for (const waveKey of Object.keys(plan.history)) {
    for (const pid of plan.history[waveKey]) {
      if (reached.has(pid)) snapWave[pid] = Number(waveKey) + 1;
    }
  }
  await env.DB.batch([
    // 收尾提问的花费也计入版本总账（batches 流水之外，versions.usd 是页面显示的口径）。
    env.DB.prepare('UPDATE versions SET said = ?, looks = ?, reach = ?, usd = usd + ?, tokens = tokens + ? WHERE post = ? AND number = ?')
      .bind(JSON.stringify(said), encodeBytes(snapBytes), encodeBytes(snapWave), round4(askUsd), askTokens, id, v),
    env.DB.prepare("UPDATE posts SET state = 'done' WHERE id = ? AND state = 'closing'").bind(id),
  ]);
  return json({ wave: waveInfo, travels: false, done: true, reach: reached.size, followUp: followUp && { asked: followUp.asked } });
}

/** 追问阶段：闲置帖问停下的人"会问卖家什么"；商品帖问价格阶梯。结果存 versions.follow_up。 */
async function runFollowUp(env, post, version, provider, reached, people, number) {
  const preset = PRESETS[post.preset];
  if (!preset.followUp) return null;
  const prices = version.prices ? JSON.parse(version.prices) : null;
  const answers = preset.followUp.answers ?? priceLadder(prices ?? [9, 19, 39, 79], '¥');
  const stopped = [...reached.entries()].filter(([, reaction]) => preset.reactions[reaction]?.stopped).map(([id]) => id);
  const totals = Object.fromEntries(Object.keys(answers).map((id) => [id, 0]));
  // 外呼门：见 FOLLOW_UP_MAX_BATCHES。比例取样本——问过的那些人就是被抽到的那些人，
  // 报告里的占比仍按 asked 算，不会因为只问了一半而虚高。
  const target = Math.min(stopped.length, FOLLOW_UP_MAX_BATCHES * PER_REQUEST);
  let asked = 0;
  let usd = 0;
  let tokens = 0;
  for (let i = 0; i < target; i += PER_REQUEST) {
    const batchPeople = stopped.slice(i, i + PER_REQUEST).map((pid) => people[pid]);
    let batchAnswers;
    let batchUsd;
    let batchTokens;
    let batchMs;
    try {
      ({ answers: batchAnswers, usd: batchUsd, tokens: batchTokens, ms: batchMs } =
        await provider.ask(followUpRequest(post.preset, version.text, batchPeople, answers)));
    } catch (error) {
      // 一批失败不重来整段：前面几批的钱已经记进 batches，再跑一遍就是付两次。
      // 就地收尾——答到的照常交出去（少了最后几批），帖子照常置 done。
      // fatal / no_key 也吞在这里：本次检查该拿的都拿到了，硬抛只会把 post 卡回 running 等人重试。
      console.error('followup', post.id, number, i / PER_REQUEST, error?.message);
      break;
    }
    usd += batchUsd;
    tokens += batchTokens;
    await addSpend(env.DB, { post: post.id, number, stage: 'followup', n: i / PER_REQUEST, usd: batchUsd, tokens: batchTokens, ms: batchMs, day: today() }).run();
    for (const who of batchPeople) {
      const probabilities = batchAnswers[questionId(who)]?.probabilities ?? {};
      asked += 1;
      for (const [id, value] of Object.entries(probabilities)) totals[id] = (totals[id] ?? 0) + value;
    }
  }
  const followUp = { answers, asked, totals };
  await env.DB.prepare('UPDATE versions SET follow_up = ?, usd = usd + ?, tokens = tokens + ? WHERE post = ? AND number = ?')
    .bind(JSON.stringify(followUp), round4(usd), tokens, post.id, number)
    .run();
  return followUp;
}

// -- GET /api/post/:id：一页所需的一切 -----------------------------------------

async function showPost(id, env, url, request = null) {
  const post = await loadPost(env.DB, id);
  if (!post) return fail('no such post', 404);
  // ?v= 指定版本；不传则取最新版本。
  let v = Number(url?.searchParams.get('v')) || 0;
  if (!v) {
    const row = await env.DB.prepare('SELECT MAX(number) AS number FROM versions WHERE post = ?').bind(id).first();
    v = row?.number ?? 1;
  }
  const version = await loadVersion(env.DB, id, v);
  if (!version) return fail('no such version', 404);
  const presetId = post.preset;
  const preset = PRESETS[presetId];
  const keys = Object.keys(preset.reactions);
  const base = {
    post: { id: post.id, preset: presetId, text: post.text, state: post.state, created_at: post.created_at, pool: post.pool },
    checks: JSON.parse(version.checks ?? '{}'),
    unlisted: JSON.parse(version.unlisted ?? '[]'),
    blocked: JSON.parse(version.blocked ?? '[]'),
    away: JSON.parse(version.away ?? 'null'),
    // 作者自述的受众（{said, picked}）。原话与挑中的组原样带回：判定留在 reconcileAudience，
    // 那里要 segments() 的读数才算得出来。存 null = 没填，整节不渲染。
    audience: JSON.parse(version.audience ?? 'null'),
    // 只是「这台机器拿着作者令牌」这一件事的布尔量：逐句承重要花钱、只有作者能点，
    // 但令牌本身绝不能随报告发给任何人——所以这里给的是能不能，不是是什么。
    awayCallable: authorOk(request, post),
  };
  if (post.state === 'blocked') return json(base);

  const people = crowdOf(post.pool);
  const plan = JSON.parse(version.plan ?? '{}');
  const bytes = new Uint8Array(CROWD);
  // 传播层：reactions 表本来就有 wave 列，拼成"第几波看到"的字节（0 = 没看到）随报告带回。
  const waveBytes = new Uint8Array(CROWD);
  const byWave = new Map();
  let versions;
  let report;
  if (version.looks) {
    // 快照路径（R25）：冻结版报告的两份字节已在收波时写进 versions，
    // 每波反应名单可从 bytes × waveBytes 无损重建——reactions 表一次都不用读。
    bytes.set(decodeBytes(version.looks));
    waveBytes.set(decodeBytes(version.reach ?? ''));
    for (let pid = 0; pid < bytes.length; pid++) {
      const wave = waveBytes[pid] - 1;
      if (!bytes[pid] || wave < 0) continue;
      if (!byWave.has(wave)) byWave.set(wave, []);
      byWave.get(wave).push(keys[bytes[pid] - 1]);
    }
    versions = await versionsOf(env.DB, id);
    report = await callReport(env.DB, id, v, version);
  } else {
    // 回退路径：running 中的版本（或迁移前的旧帖）没有快照，逐行现读。
    const [{ results: rows }, versions_, report_] = await Promise.all([
      env.DB.prepare('SELECT id, wave, reaction FROM reactions WHERE post = ? AND number = ?').bind(id, v).all(),
      versionsOf(env.DB, id),
      callReport(env.DB, id, v, version),
    ]);
    for (const row of rows) {
      const index = keys.indexOf(row.reaction);
      bytes[row.id] = index >= 0 ? index + 1 : 0;
      waveBytes[row.id] = row.wave + 1;
      if (!byWave.has(row.wave)) byWave.set(row.wave, []);
      byWave.get(row.wave).push(row.reaction);
    }
    versions = versions_;
    report = report_;
  }
  const waves = Object.keys(plan.history ?? {})
    .sort((a, b) => a - b)
    .map((wave) => {
      const drawn = byWave.get(Number(wave)) ?? [];
      return { index: Number(wave), asked: plan.history[wave].length, size: drawn.length, mood: round2(mood(presetId, drawn)), travels: travels(presetId, drawn) };
    });

  const all = segments(presetId, keys, bytes, people);
  const said = JSON.parse(version.said ?? 'null');
  // 开局那份打分（Jev 对 83 组人群打的 CARE 分）与后来发生的事对账：全城按 exposure 分十档，
  // 每档看停下/乐见的比例。scores 一直在 versions 里（settleWave 每波都要读它算下一波），
  // 只是今天不过报告——这一节不花钱、不调 Jev，纯把已有的两个数放在一起。
  // 迁移之前的旧版本没有 scores（列是 0003 加的，但当时写的是空串/null），那就 null 不渲染。
  const scores = JSON.parse(version.scores ?? 'null');
  const bands = scores ? exposureBands(presetId, keys, scores, bytes, people) : null;
  const voices = voicesOf(id, presetId, bytes).map((voice) => ({
    ...voice,
    who: personView(people[voice.id]),
  }));

  return json({
    ...base,
    counters: counters(presetId, keys, bytes),
    waves,
    looks: encodeBytes(bytes),
    reach: encodeBytes(waveBytes),
    said,
    segments: {
      stopped: topSegments(all, 'stopped'),
      glad: topSegments(all, 'glad'),
      sorry: topSegments(all, 'sorry'),
    },
    // 作者说给谁的 vs 实际停在哪（只做对账，不改分发）。没填就 null，前端整节不渲染。
    audience: base.audience ? { ...base.audience, ...reconcileAudience(all, base.audience.picked, { presetId }) } : null,
    bands,
    terrain: terrainFor(presetId, keys, bytes, `${id}.${v}`, post.state !== 'running'),
    voices,
    decisions: version.decisions ? JSON.parse(version.decisions) : null,
    followUp: version.follow_up ? JSON.parse(version.follow_up) : null,
    prices: version.prices ? JSON.parse(version.prices) : null,
    versions,
    report,
    spent: { usd: round4(version.usd ?? 0), tokens: version.tokens ?? 0 },
  });
}

/** Jev 调用报告：分阶段聚合请求流水（次数/花费/tokens/耗时），报告卡与图谱的数据源。 */
async function callReport(db, id, number, version) {
  const { results } = await db.prepare(
    'SELECT stage, COUNT(*) AS n, SUM(usd) AS usd, SUM(tokens) AS tokens, SUM(ms) AS ms FROM batches WHERE post = ? AND number = ? GROUP BY stage ORDER BY MIN(rowid)',
  )
    .bind(id, number)
    .all();
  const stages = results.map((row) => ({
    stage: row.stage,
    n: row.n,
    usd: round4(row.usd ?? 0),
    tokens: row.tokens ?? 0,
    ms: row.ms ?? 0,
  }));
  return {
    provider: version.provider ?? null,
    stages,
    totals: {
      requests: stages.reduce((sum, s) => sum + s.n, 0),
      usd: round4(stages.reduce((sum, s) => sum + s.usd, 0)),
      tokens: stages.reduce((sum, s) => sum + s.tokens, 0),
      ms: stages.reduce((sum, s) => sum + s.ms, 0),
    },
  };
}

/** 某帖的全部版本（轻量列表：版本号、文本、派生态）。注意 blocked/said 是 JSON 文本列：'[]' 也是真值，必须解析后判断。 */
async function versionsOf(db, id) {
  const { results } = await db.prepare('SELECT number, text, blocked, said FROM versions WHERE post = ? ORDER BY number').bind(id).all();
  return results.map((row) => ({
    number: row.number,
    text: row.text,
    state: JSON.parse(row.blocked ?? '[]').length ? 'blocked' : row.said == null ? 'running' : 'done',
  }));
}

/** 收尾没问到的也有一条干净的人格行（界面只展示被问到的）——视图由 shared/labels.js 的 personView 给出。 */

// -- GET /api/feed --------------------------------------------------------------

async function listFeed(env) {
  const { results } = await env.DB.prepare('SELECT id, preset, text, state, created_at FROM posts ORDER BY created_at DESC LIMIT 20').all();
  return json({
    posts: results.map((row) => ({ ...row, excerpt: row.text.slice(0, 60) })),
  });
}

// -- 工具 -----------------------------------------------------------------------

// Uint8Array → base64 的编解码已移到 shared/bytes.js，Worker 与浏览器/回放共用同一份。
