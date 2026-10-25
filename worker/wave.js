// POST /api/wave：收波、算情绪定去留（门槛/广播）、追问与收尾提问。
import { CROWD } from '../public/shared/personas.js';
import { PRESETS, priceLadder, DEFAULT_PRICES } from '../public/shared/presets.js';
import { followUpRequest, questionId } from '../public/shared/requests.js';
import { nextWave, mood, travels, gatherAsked, asking, emptyGathered } from '../public/shared/feed.js';
import { askQuestion, mergeSaid, listsOf } from '../public/shared/check.js';
import { encodeBytes, decodeBytes } from '../public/shared/bytes.js';
import { rng, hash32 } from '../public/shared/rng.js';
import { PER_REQUEST, WAVES_MAX, crowdOf, providerOf, addSpend, loadPost, loadVersion, authorOk, readJson, json, fail, today, round2, round4 } from './common.js';

/**
 * 免费档一次 Worker 调用最多 50 个外呼，而一次收波要在同一次调用里把追问与收尾问句问完。
 * 追问是 stopped 的全部人（实测两三千 → 十几批），无上限就会撞墙，撞墙的表现是整次收波被
 * Cloudflare 中断、post 卡在 closing 等人重试——重试还要再付一次钱。留出门来：批数封顶，
 * 超出的批次不问了，页面上追问少问几个人，比整次收尾失败便宜。
 */
const FOLLOW_UP_MAX_BATCHES = 24;

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
    const wave = readJson(version.plan, '{}').wave;
    const { results: answered } = await env.DB.prepare('SELECT 1 FROM reactions WHERE post = ? AND number = ? AND wave = ? LIMIT 1').bind(id, v, wave).all();
    if (!answered.length) {
      await release();
      return fail('this wave has no answers yet', 409);
    }
    return await settleWave(env, post, id, v, request, version);
  } catch (error) {
    await release();
    throw error;
  }
}

/** 收波本体：算情绪定去留；推进则把状态还回 running（批次还要继续），收尾则置 done。 */
async function settleWave(env, post, id, v, request, version) {
  // version 由 closeWave 传入（空波门刚读过同一行）：closing 期间 batch/wave 都以 running
  // 为门，这一行不会再被写，重读一次是白付的 D1 往返。
  const plan = JSON.parse(version.plan);
  const presetId = post.preset;
  const pool = post.pool;
  const preset = PRESETS[presetId];
  const scores = JSON.parse(version.scores);
  const maxWaves = Math.min(Number(env.CROWD_MAX_WAVES ?? WAVES_MAX), WAVES_MAX);
  const provider = providerOf(env, request);

  const waveIndex = plan.wave;
  const order = plan.history[String(waveIndex)];
  const { results: waveRows } = await env.DB.prepare('SELECT id, reaction FROM reactions WHERE post = ? AND number = ? AND wave = ?')
    .bind(id, v, waveIndex)
    .all();
  const drawn = waveRows.map((row) => row.reaction);
  const waveMood = mood(presetId, drawn);
  const waveTravels = travels(presetId, drawn);
  const waveInfo = { index: waveIndex, asked: order.length, size: drawn.length, mood: round2(waveMood), travels: waveTravels };

  // reached（pid → reaction）从上一波收波落下的 looks 快照起步，只把本波 reactions 合并进来
  // ——R25 把读报告从 1 万行降到 1 行，这里把同一思路搬到写侧（收波每波都要付的全量读）。
  // looks 为空才全量读一次兜底：第一波收波本就等于全量；R25 之前就在 running 的旧帖也走
  // 这条路自愈。合并幂等（主键 (post, number, id) 一人一行），少谁补谁。
  const keys = Object.keys(preset.reactions);
  const bytes = new Uint8Array(CROWD);
  if (version.looks) {
    bytes.set(decodeBytes(version.looks));
  } else {
    const { results: allRows } = await env.DB.prepare('SELECT id, reaction FROM reactions WHERE post = ? AND number = ?').bind(id, v).all();
    for (const row of allRows) {
      const index = keys.indexOf(row.reaction);
      bytes[row.id] = index >= 0 ? index + 1 : 0;
    }
  }
  for (const row of waveRows) {
    const index = keys.indexOf(row.reaction);
    bytes[row.id] = index >= 0 ? index + 1 : 0;
  }
  const reached = new Map();
  for (let pid = 0; pid < CROWD; pid++) if (bytes[pid]) reached.set(pid, keys[bytes[pid] - 1]);

  // 传播：够 glad，且还有波次与还没看到的人。广播模式（plan.broadcast）不拿情绪当闸——
  // 波次照跑、账照记，只是把「传不传得开」和「全镇怎么读」分开问。
  if ((plan.broadcast || waveTravels) && waveIndex + 1 < maxWaves && reached.size < CROWD) {
    const people = crowdOf(pool);
    const random = rng(hash32('waves', pool, `${id}.${v}.${waveIndex + 1}`));
    const next = nextWave(people, reached, scores, presetId, waveIndex + 1, random);
    plan.wave = waveIndex + 1;
    plan.answered = 0;
    plan.history[String(waveIndex + 1)] = next.map((who) => who.id);
    await env.DB.batch([
      // 快照随波次推进落库：下一波收波从它起步，不再全量读 reactions。
      env.DB.prepare('UPDATE versions SET plan = ?, looks = ? WHERE post = ? AND number = ?').bind(JSON.stringify(plan), encodeBytes(bytes), id, v),
      env.DB.prepare("UPDATE posts SET state = 'running' WHERE id = ? AND state = 'closing'").bind(id),
    ]);
    return json({ wave: waveInfo, travels: true, broadcast: Boolean(plan.broadcast), next: { index: waveIndex + 1, total: next.length } });
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
  // looks 就是上面合并好的 bytes（与 reached 同一来源，不必再从 reached 重建一遍）；
  // snapWave 用 plan.history（波次 → 名单）回填，只标记真正被判定到的人
  //（批次失败的问过但没答，不算到达）。
  const snapWave = new Uint8Array(CROWD);
  for (const waveKey of Object.keys(plan.history)) {
    for (const pid of plan.history[waveKey]) {
      if (reached.has(pid)) snapWave[pid] = Number(waveKey) + 1;
    }
  }
  await env.DB.batch([
    // 收尾提问的花费也计入版本总账（batches 流水之外，versions.usd 是页面显示的口径）。
    env.DB.prepare('UPDATE versions SET said = ?, looks = ?, reach = ?, usd = usd + ?, tokens = tokens + ? WHERE post = ? AND number = ?')
      .bind(JSON.stringify(said), encodeBytes(bytes), encodeBytes(snapWave), round4(askUsd), askTokens, id, v),
    env.DB.prepare("UPDATE posts SET state = 'done' WHERE id = ? AND state = 'closing'").bind(id),
  ]);
  // endedBy 给前端一句能说清「为什么结束」的话：gate = 情绪没过线被拦下（可玩性关键反馈），
  // capacity = 波次跑满或全城都看到了（正常谢幕）。广播模式的情绪不作为结束原因。
  const endedBy = plan.broadcast || waveIndex + 1 >= maxWaves || reached.size >= CROWD ? 'capacity' : 'gate';
  return json({ wave: waveInfo, travels: false, broadcast: Boolean(plan.broadcast), endedBy, done: true, reach: reached.size, followUp: followUp && { asked: followUp.asked } });
}

/** 追问阶段：闲置帖问停下的人"会问卖家什么"；商品帖问价格阶梯。结果存 versions.follow_up。 */
async function runFollowUp(env, post, version, provider, reached, people, number) {
  const preset = PRESETS[post.preset];
  if (!preset.followUp) return null;
  const prices = version.prices ? JSON.parse(version.prices) : null;
  const answers = preset.followUp.answers ?? priceLadder(prices ?? DEFAULT_PRICES, '¥');
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

export { closeWave };
