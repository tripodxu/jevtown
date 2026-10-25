// GET /api/post/:id、GET /api/feed、POST /api/away：报告数据源、公共流（带读数摘要）与逐句承重。
import { CROWD } from '../public/shared/personas.js';
import { PRESETS } from '../public/shared/presets.js';
import { exposureBands, mood, travels } from '../public/shared/feed.js';
import { counters, segments, topSegments, voicesOf, reconcileAudience } from '../public/shared/summary.js';
import { personView } from '../public/shared/labels.js';
import { encodeBytes, decodeBytes } from '../public/shared/bytes.js';
import { runAblation } from '../public/shared/away.js';
import { crowdOf, terrainFor, derivedFor, providerOf, addSpend, loadPost, loadVersion, authorOk, readJson, readAllowed, json, fail, today, round2, round4 } from './common.js';

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
  // 消费闸只拦 running 版的逐行现读路径（最贵、无缓存）；冻结报告走快照+缓存，不限。
  if (!(version.looks && version.said != null)) {
    const ip = request?.headers.get('CF-Connecting-IP') ?? 'local';
    if (!readAllowed(ip)) return fail('too many report reads for this IP, retry in a minute', 429);
  }
  const presetId = post.preset;
  const preset = PRESETS[presetId];
  const keys = Object.keys(preset.reactions);
  const base = {
    post: { id: post.id, preset: presetId, text: post.text, state: post.state, created_at: post.created_at, pool: post.pool },
    checks: readJson(version.checks, '{}'),
    unlisted: readJson(version.unlisted, '[]'),
    blocked: readJson(version.blocked, '[]'),
    away: readJson(version.away),
    // 作者自述的受众（{said, picked}）。原话与挑中的组原样带回：判定留在 reconcileAudience，
    // 那里要 segments() 的读数才算得出来。存 null = 没填，整节不渲染。
    audience: readJson(version.audience),
    // 只是「这台机器拿着作者令牌」这一件事的布尔量：逐句承重要花钱、只有作者能点，
    // 但令牌本身绝不能随报告发给任何人——所以这里给的是能不能，不是是什么。
    awayCallable: authorOk(request, post),
  };
  if (post.state === 'blocked') return json(base);

  const people = crowdOf(post.pool);
  const plan = readJson(version.plan, '{}');
  const bytes = new Uint8Array(CROWD);
  // 传播层：reactions 表本来就有 wave 列，拼成"第几波看到"的字节（0 = 没看到）随报告带回。
  const waveBytes = new Uint8Array(CROWD);
  const byWave = new Map();
  let versions;
  let report;
  if (version.looks && version.said != null) {
    // 快照路径（R25）：终笔收波把两份字节随 said 同批写进 versions，此后不再变化，
    // 每波反应名单可从 bytes × waveBytes 无损重建——reactions 表一次都不用读。
    // 门槛是"这一版收过终笔"（said 与 looks 同批落库）：2026-10-06 起 looks 随波次
    // 推进增量落库，running 版的快照只是中间态、reach 还没写，实时语义必须走下面的
    // 逐行路径；而 v2 进行中回看 v1（said 已落）仍走快照，对比区不因新版本在跑而变慢。
    bytes.set(decodeBytes(version.looks));
    waveBytes.set(decodeBytes(version.reach ?? ''));
    for (let pid = 0; pid < bytes.length; pid++) {
      const wave = waveBytes[pid] - 1;
      if (!bytes[pid] || wave < 0) continue;
      if (!byWave.has(wave)) byWave.set(wave, []);
      byWave.get(wave).push(keys[bytes[pid] - 1]);
    }
    // 版本列表与调用报告互不依赖，一趟并行省一个 D1 往返（回退路径早已如此）。
    [versions, report] = await Promise.all([versionsOf(env.DB, id), callReport(env.DB, id, v, version)]);
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
  const said = readJson(version.said);
  // 开局那份打分（Jev 对 83 组人群打的 CARE 分）与后来发生的事对账：全城按 exposure 分十档，
  // 每档看停下/乐见的比例。scores 一直在 versions 里（settleWave 每波都要读它算下一波），
  // 只是今天不过报告——这一节不花钱、不调 Jev，纯把已有的两个数放在一起。
  // 这一栏为空（老存档没写过，或手滑写空串）就 null 不渲染，别让整份报告跟着 500。
  // 冻结版本的十档与声音走 derivedFor 缓存（同 terrainFor 的模式）；running 版照算。
  const frozen = post.state !== 'running';
  const versionId = `${id}.${v}`;
  const scores = readJson(version.scores);
  const bands = scores ? derivedFor(versionId, frozen, () => exposureBands(presetId, keys, scores, bytes, people)) : null;
  const voices = derivedFor(versionId, frozen, () =>
    voicesOf(id, presetId, bytes).map((voice) => ({
      ...voice,
      who: personView(people[voice.id]),
    })),
  );

  return json({
    ...base,
    // 全城广播的标记（plan.broadcast）：报告措辞要区分「传开的」和「推满的」。
    broadcast: Boolean(plan.broadcast),
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
    terrain: terrainFor(presetId, keys, bytes, versionId, frozen),
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
    state: readJson(row.blocked, '[]').length ? 'blocked' : row.said == null ? 'running' : 'done',
  }));
}

/** 收尾没问到的也有一条干净的人格行（界面只展示被问到的）——视图由 shared/labels.js 的 personView 给出。 */

// -- GET /api/feed --------------------------------------------------------------

/**
 * 公共流 + 读数摘要。读数（reach/glad/sorry）由 reactions 在 D1 里 GROUP BY 聚好带回：
 * 一行一条 (post, reaction) 计数，tone 按 post 的 preset 在这里映射——比把每帖 13KB 的
 * looks 字节搬回 Worker 再各走一万格便宜两个数量级。没有 reactions（blocked / 刚开局）reading 为 null。
 */
async function listFeed(env) {
  const { results } = await env.DB.prepare('SELECT id, preset, text, state, created_at FROM posts ORDER BY created_at DESC LIMIT 20').all();
  const readings = new Map();
  if (results.length) {
    const marks = results.map(() => '?').join(',');
    const { results: counts } = await env.DB.prepare(
      `SELECT post, reaction, COUNT(*) AS n FROM reactions WHERE post IN (${marks}) GROUP BY post, reaction`,
    )
      .bind(...results.map((row) => row.id))
      .all();
    const presetOf = new Map(results.map((row) => [row.id, row.preset]));
    for (const row of counts) {
      const tone = PRESETS[presetOf.get(row.post)]?.reactions[row.reaction]?.tone ?? 0;
      const entry = readings.get(row.post) ?? { reach: 0, glad: 0, sorry: 0 };
      entry.reach += row.n;
      if (tone === 1) entry.glad += row.n;
      else if (tone === -1) entry.sorry += row.n;
      readings.set(row.post, entry);
    }
  }
  return json({
    posts: results.map((row) => {
      const reading = readings.get(row.id);
      return { ...row, excerpt: row.text.slice(0, 60), reading: reading && reading.reach ? reading : null };
    }),
  });
}

export { runAway, showPost, listFeed };
