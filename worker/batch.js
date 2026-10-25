// GET /api/batch：一批 100 人一道 Choice 题；原子认领制（并发只有一个成功）。
import { persona, personaLine } from '../public/shared/personas.js';
import { PRESETS, CANT_TELL } from '../public/shared/presets.js';
import { reactionRequest, questionId } from '../public/shared/requests.js';
import { drawReaction } from '../public/shared/draw.js';
import { PER_REQUEST, loadPost, loadVersion, authorOk, providerOf, addSpend, json, fail, today, round4 } from './common.js';

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

export { runBatch };
