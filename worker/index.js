// 一个 Cloudflare Worker：Jevtown 中文小镇的 API。静态页面由 assets 直接服务（见 wrangler.jsonc），
// Worker 只接 /api/*。检查由浏览器分步驱动（免费档一次调用只有 50 个外呼和 10ms CPU）：
//   POST /api/check  开局：审核 + 传播算法打分（一个请求），排出第一波
//   GET  /api/batch  问 Jev 一批（100 个人格、每人一道 Choice 题），落库
//   POST /api/wave   收波：算情绪定去留；最后一波收尾，把收尾提问发给小镇
//   GET  /api/post/:id  汇总一页所需的一切
//   GET  /api/feed      最近的检查
// 引擎全部来自 public/shared/（上游 gaborishka/jevtown，MIT），Worker 只做编排和存取。
import { crowd, persona, CROWD } from '../public/shared/personas.js';
import { PRESETS, CANT_TELL } from '../public/shared/presets.js';
import { JOB, TEMPER } from '../public/shared/vocab.js';
import { openingRequest, openingAnswers, reactionRequest, questionId, MAX_TEXT_CHARS } from '../public/shared/requests.js';
import { firstWave, nextWave, mood, travels, gatherAsked, asking, emptyGathered } from '../public/shared/feed.js';
import { drawReaction } from '../public/shared/draw.js';
import { askQuestion, mergeSaid, listsOf } from '../public/shared/check.js';
import { counters, segments, topSegments, voicesOf } from '../public/shared/summary.js';
import { pickProvider, ask as askJev } from '../public/shared/jev.js';
import { createMockAsk } from '../public/shared/mock.js';
import { rng, hash32 } from '../public/shared/rng.js';

const PER_REQUEST = 100;
const WAVES_MAX = 4;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const fail = (message, status = 400) => json({ error: message }, status);

const today = () => new Date().toISOString().slice(0, 10);
const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);
const round2 = (value) => Math.round(value * 100) / 100;

/** 这台 Worker 用哪条路到 Jev：mock、TypeSafe、OpenRouter；没配 key 时自动落入 mock，本地开发零门槛。 */
function providerOf(env) {
  const wanted = String(env.JEV_PROVIDER ?? '').trim().toLowerCase();
  if (wanted !== 'mock') {
    const picked = pickProvider(env);
    if (picked) {
      const retries = { left: 40 };
      return { name: picked.name, ask: (request) => askJev(picked, request, retries) };
    }
  }
  return { name: 'mock', ask: createMockAsk() };
}

// -- D1 小助手 ----------------------------------------------------------------

const loadPost = async (db, id) => (await db.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first()) ?? null;
const loadVersion = async (db, id, number = 1) =>
  (await db.prepare('SELECT * FROM versions WHERE post = ? AND number = ?').bind(id, number).first()) ?? null;

/** 记一笔花费流水。返回 D1 语句（可直接进 db.batch，单独执行时加 .run()）。 */
const addSpend = (db, { post, stage, n = 0, usd = 0, tokens = 0, day }) =>
  db.prepare(
    'INSERT INTO batches (post, number, stage, n, usd, tokens, day) VALUES (?, 1, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT (post, number, stage, n) DO UPDATE SET usd = usd + excluded.usd, tokens = tokens + excluded.tokens',
  )
    .bind(post, stage, n, round2(usd), Math.round(tokens), day);

/** 全站今天已花掉多少（CROWD_DAILY_BUDGET_USD 的对手盘）。 */
const spentToday = async (db, day) => {
  const row = await db.prepare('SELECT COALESCE(SUM(usd), 0) AS usd FROM batches WHERE day = ?').bind(day).first();
  return row?.usd ?? 0;
};

/** 一条 post 的所有反应，作为 Map<personaId, reactionId>。 */
const reactionsMap = async (db, id) => {
  const { results } = await db.prepare('SELECT id, reaction FROM reactions WHERE post = ? AND number = 1').bind(id).all();
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
      if (request.method === 'GET' && path === '/api/batch') return await runBatch(url, env);
      if (request.method === 'POST' && path === '/api/wave') return await closeWave(url, env);
      if (request.method === 'GET' && path.startsWith('/api/post/')) return await showPost(path.slice('/api/post/'.length), env);
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

  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  const day = today();
  const limit = Number(env.CROWD_DAILY_LIMIT ?? 0);
  if (limit > 0) {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM posts WHERE ip = ? AND day = ?').bind(ip, day).first();
    if ((row?.n ?? 0) >= limit) return fail('today’s checks are used up, come back tomorrow', 429);
  }
  const budget = Number(env.CROWD_DAILY_BUDGET_USD ?? 0);
  if (budget > 0 && (await spentToday(env.DB, day)) >= budget) return fail('today’s budget is spent', 429);

  const provider = providerOf(env);
  const pool = 'zh';
  const { answers, usd, tokens } = await provider.ask(openingRequest(presetId, text));
  const opening = openingAnswers(answers);
  const id = newId();
  const now = Date.now();
  const stored = {
    scores: JSON.stringify(opening.scores),
    checks: JSON.stringify(opening.checks),
    unlisted: JSON.stringify(opening.unlisted),
    blocked: JSON.stringify(opening.blocked),
  };

  if (opening.blocked.length) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO posts (id, preset, pool, text, state, created_at, day, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, presetId, pool, text, 'blocked', now, day, ip),
      env.DB.prepare(
        'INSERT INTO versions (post, number, text, scores, checks, unlisted, blocked, usd, tokens) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(id, text, stored.scores, stored.checks, stored.unlisted, stored.blocked, round2(usd), tokens),
      addSpend(env.DB, { post: id, stage: 'opening', usd, tokens, day }),
    ]);
    return json({ post: id, version: 1, state: 'blocked', blocked: opening.blocked, unlisted: opening.unlisted, checks: opening.checks });
  }

  // 第一波：传播算法认为最该看到的人（打分越高越靠前），掺少量随机。
  const people = crowd(pool);
  const random = rng(hash32('waves', pool, `${id}.1`));
  const wave0 = firstWave(people, opening.scores, presetId, random);
  const plan = { wave: 0, answered: 0, history: { 0: wave0.map((who) => who.id) } };
  await env.DB.batch([
    env.DB.prepare('INSERT INTO posts (id, preset, pool, text, state, created_at, day, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, presetId, pool, text, 'running', now, day, ip),
    env.DB.prepare(
      'INSERT INTO versions (post, number, text, scores, checks, unlisted, blocked, plan, usd, tokens) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, text, stored.scores, stored.checks, stored.unlisted, stored.blocked, JSON.stringify(plan), round2(usd), tokens),
    addSpend(env.DB, { post: id, stage: 'opening', usd, tokens, day }),
  ]);
  return json({
    post: id,
    version: 1,
    state: 'running',
    provider: provider.name,
    unlisted: opening.unlisted,
    checks: opening.checks,
    wave: { index: 0, total: wave0.length },
  });
}

// -- GET /api/batch：问 Jev 一批人 ---------------------------------------------

async function runBatch(url, env) {
  const id = url.searchParams.get('post');
  const post = await loadPost(env.DB, id);
  if (!post) return fail('no such post', 404);
  if (post.state !== 'running') return fail('the check is not running', 409);
  const version = await loadVersion(env.DB, id);
  const plan = JSON.parse(version.plan);
  const order = plan.history[String(plan.wave)];
  const start = plan.answered;
  if (start >= order.length) return json({ done: true, answered: start, total: order.length });

  const presetId = post.preset;
  const pool = post.pool;
  const batch = order.slice(start, start + PER_REQUEST);
  const people = batch.map((pid) => persona(pool, pid));
  const provider = providerOf(env);
  const { answers, usd, tokens } = await provider.ask(reactionRequest(presetId, version.text, people));

  const versionId = `${id}.1`;
  const statements = batch.map((pid, index) => {
    const probabilities = answers[questionId(people[index])]?.probabilities ?? {};
    const reaction = drawReaction(probabilities, pool, pid, versionId) ?? CANT_TELL;
    return env.DB.prepare('INSERT INTO reactions (post, number, id, wave, reaction) VALUES (?, 1, ?, ?, ?)')
      .bind(id, pid, plan.wave, reaction);
  });
  plan.answered = start + batch.length;
  statements.push(
    env.DB.prepare('UPDATE versions SET plan = ?, usd = usd + ?, tokens = tokens + ? WHERE post = ? AND number = 1')
      .bind(JSON.stringify(plan), round2(usd), tokens, id),
    addSpend(env.DB, { post: id, stage: `wave${plan.wave}`, n: start, usd, tokens, day: today() }),
  );
  await env.DB.batch(statements);
  return json({ answered: plan.answered, total: order.length, wave: plan.wave });
}

// -- POST /api/wave：收波、定去留、收尾 ----------------------------------------

async function closeWave(url, env) {
  const id = url.searchParams.get('post');
  const post = await loadPost(env.DB, id);
  if (!post) return fail('no such post', 404);
  if (post.state !== 'running') return fail('the check is already finished', 409);
  const version = await loadVersion(env.DB, id);
  const plan = JSON.parse(version.plan);
  const presetId = post.preset;
  const pool = post.pool;
  const preset = PRESETS[presetId];
  const scores = JSON.parse(version.scores);
  const maxWaves = Math.min(Number(env.CROWD_MAX_WAVES ?? WAVES_MAX), WAVES_MAX);
  const provider = providerOf(env);

  const waveIndex = plan.wave;
  const order = plan.history[String(waveIndex)];
  const { results: waveRows } = await env.DB.prepare('SELECT reaction FROM reactions WHERE post = ? AND number = 1 AND wave = ?')
    .bind(id, waveIndex)
    .all();
  const drawn = waveRows.map((row) => row.reaction);
  const waveMood = mood(presetId, drawn);
  const waveTravels = travels(presetId, drawn);
  const waveInfo = { index: waveIndex, asked: order.length, size: drawn.length, mood: round2(waveMood), travels: waveTravels };

  const reached = await reactionsMap(env.DB, id);

  // 传播：够 glad，且还有波次与还没看到的人。
  if (waveTravels && waveIndex + 1 < maxWaves && reached.size < CROWD) {
    const people = crowd(pool);
    const random = rng(hash32('waves', pool, `${id}.1.${waveIndex + 1}`));
    const next = nextWave(people, reached, scores, presetId, waveIndex + 1, random);
    plan.wave = waveIndex + 1;
    plan.answered = 0;
    plan.history[String(waveIndex + 1)] = next.map((who) => who.id);
    await env.DB.prepare('UPDATE versions SET plan = ? WHERE post = ? AND number = 1').bind(JSON.stringify(plan), id).run();
    return json({ wave: waveInfo, travels: true, next: { index: waveIndex + 1, total: next.length } });
  }

  // 检查收尾：把收尾提问（为什么划走/什么让他们停下/会评论什么）发给到达过的人。
  const people = crowd(pool);
  const reactionOf = (pid) => reached.get(pid);
  let gathered = emptyGathered();
  for (const wave of Object.keys(plan.history).sort((a, b) => a - b)) {
    gathered = gatherAsked(presetId, plan.history[wave], reactionOf, gathered);
  }
  const closing = asking(presetId, version.text, gathered);
  const parts = [];
  const missing = {};
  const budget = Number(env.CROWD_DAILY_BUDGET_USD ?? 0);
  const spent = budget > 0 && provider.name !== 'mock' && (await spentToday(env.DB, today())) >= budget;
  for (const { question, ids } of closing) {
    if (!ids.length) continue;
    if (spent) {
      for (const list of listsOf(question, presetId, ids, reactionOf)) missing[list] = 'budget';
      continue;
    }
    try {
      const { part, usd, tokens } = await askQuestion(provider.ask, question, {
        presetId,
        text: version.text,
        people: ids.map((pid) => people[pid]),
        reactionOf,
        pool,
        versionId: `${id}.1`,
      });
      parts.push(part);
      await addSpend(env.DB, { post: id, stage: 'ask', usd, tokens, day: today() }).run();
    } catch (error) {
      console.error('ask', question, error?.message);
      for (const list of listsOf(question, presetId, ids, reactionOf)) missing[list] = 'failed';
    }
  }
  const said = mergeSaid(parts, missing);
  await env.DB.batch([
    env.DB.prepare('UPDATE versions SET said = ? WHERE post = ? AND number = 1').bind(JSON.stringify(said), id),
    env.DB.prepare("UPDATE posts SET state = 'done' WHERE id = ?").bind(id),
  ]);
  return json({ wave: waveInfo, travels: false, done: true, reach: reached.size });
}

// -- GET /api/post/:id：一页所需的一切 -----------------------------------------

async function showPost(id, env) {
  const post = await loadPost(env.DB, id);
  if (!post) return fail('no such post', 404);
  const version = await loadVersion(env.DB, id);
  const presetId = post.preset;
  const preset = PRESETS[presetId];
  const keys = Object.keys(preset.reactions);
  const base = {
    post: { id: post.id, preset: presetId, text: post.text, state: post.state, created_at: post.created_at },
    checks: JSON.parse(version.checks ?? '{}'),
    unlisted: JSON.parse(version.unlisted ?? '[]'),
    blocked: JSON.parse(version.blocked ?? '[]'),
  };
  if (post.state === 'blocked') return json(base);

  const people = crowd(post.pool);
  const { results: rows } = await env.DB.prepare('SELECT id, wave, reaction FROM reactions WHERE post = ? AND number = 1').bind(id).all();
  const bytes = new Uint8Array(CROWD);
  const byWave = new Map();
  for (const row of rows) {
    const index = keys.indexOf(row.reaction);
    bytes[row.id] = index >= 0 ? index + 1 : 0;
    if (!byWave.has(row.wave)) byWave.set(row.wave, []);
    byWave.get(row.wave).push(row.reaction);
  }
  const plan = JSON.parse(version.plan ?? '{}');
  const waves = Object.keys(plan.history ?? {})
    .sort((a, b) => a - b)
    .map((wave) => {
      const drawn = byWave.get(Number(wave)) ?? [];
      return { index: Number(wave), asked: plan.history[wave].length, size: drawn.length, mood: round2(mood(presetId, drawn)), travels: travels(presetId, drawn) };
    });

  const all = segments(presetId, keys, bytes, people);
  const said = JSON.parse(version.said ?? 'null');
  const voices = voicesOf(id, presetId, bytes).map((voice) => ({
    ...voice,
    who: voiceOf(people[voice.id]),
  }));

  return json({
    ...base,
    counters: counters(presetId, keys, bytes),
    waves,
    looks: encodeBytes(bytes),
    said,
    segments: {
      stopped: topSegments(all, 'stopped'),
      glad: topSegments(all, 'glad'),
      sorry: topSegments(all, 'sorry'),
    },
    voices,
    spent: { usd: round2(version.usd ?? 0), tokens: version.tokens ?? 0 },
  });
}

/** 收尾没问到的也有一条干净的人格行（界面只展示被问到的）。 */
function voiceOf(who) {
  return { id: who.id, name: who.name.zh, age: who.age, job: JOB[who.job]?.zh, city: who.city.zh, temper: TEMPER[who.temper]?.zh };
}

// -- GET /api/feed --------------------------------------------------------------

async function listFeed(env) {
  const { results } = await env.DB.prepare('SELECT id, preset, text, state, created_at FROM posts ORDER BY created_at DESC LIMIT 20').all();
  return json({
    posts: results.map((row) => ({ ...row, excerpt: row.text.slice(0, 60) })),
  });
}

// -- 工具 -----------------------------------------------------------------------

/** Uint8Array → base64（地图数据压缩传输）。 */
function encodeBytes(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
