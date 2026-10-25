// 从存档 JSON（scripts/check.js 的 output/checks 格式）回放一页视图，不调任何 API。
// 这也是"纯静态部署"的可行证明：回放全部发生在浏览器。
import { PRESETS } from './presets.js';
import { crowd, GRID } from './personas.js';
import { counters, segments, topSegments, voicesOf, reconcileAudience } from './summary.js';
import { exposureBands } from './feed.js';
import { crowdTerrain } from './spatial.js';
import { drawReaction } from './draw.js';
import { encodeBytes } from './bytes.js';
import { personView } from './labels.js';

/**
 * 存档里的决策样本 → 渲染层认识的形状。旧档（引擎 sampleDecisions 的老 bug，2026-10-25 修）
 * 把答案包装对象当概率表存，reaction 也因喂错对象成了垃圾键名——这里还原：概率表解开一层；
 * reaction 不在预设词表里时用**引擎同一套确定性抽签**重抽（同 pool + 同 versionId 的盐 ⇒
 * 抽出的就是当年本该判定的那一个，不是编造）。新档两层都平，原样透传。
 */
function decisionsOf(saved, presetId) {
  if (!saved.decisions?.length) return null;
  const reactions = PRESETS[presetId].reactions;
  const pool = saved.pool ?? 'zh';
  return saved.decisions.map((d) => {
    const probabilities = d.probabilities?.probabilities ?? d.probabilities ?? {};
    const reaction = reactions[d.reaction]
      ? d.reaction
      : drawReaction(probabilities, pool, d.id, String(saved.versionId ?? '')) ?? 'cant_tell';
    return { ...d, probabilities, reaction };
  });
}

export function replayToView(saved) {
  const presetId = saved.presetId;
  const keys = Object.keys(PRESETS[presetId].reactions);
  const bytes = Uint8Array.from(saved.reactions);
  const people = crowd(saved.pool ?? 'zh');
  const all = segments(presetId, keys, bytes, people);
  return {
    post: { id: saved.versionId, preset: presetId, text: saved.text, state: 'done', pool: saved.pool ?? 'zh' },
    counters: counters(presetId, keys, bytes),
    waves: saved.waves,
    looks: encodeBytes(bytes),
    // 传播层：只有带 waveOf 的新存档才有；旧档得 null → 前端隐藏传播按钮（优雅降级）
    reach: saved.waveOf ? encodeBytes(Uint8Array.from(saved.waveOf)) : null,
    said: saved.said ?? null,
    followUp: saved.followUp ?? null,
    prices: saved.prices ?? null,
    checks: saved.checks ?? {},
    unlisted: saved.unlisted ?? [],
    segments: { stopped: topSegments(all, 'stopped'), glad: topSegments(all, 'glad'), sorry: topSegments(all, 'sorry') },
    // 作者说给谁的 vs 实际停在哪（R35）。存档里没有 audience 字段（早于本轮的存档）→ null，
    // 整节不渲染——回放旧存档不该凭空长出一节。
    audience: saved.audience ? { ...saved.audience, ...reconcileAudience(all, saved.audience.picked, { presetId }) } : null,
    // Jev 开局那份打分 vs 后来发生的事（R37）。存档里没有 scores 的（早于本轮）→ null，
    // 整节不渲染，理由和 audience 一样：没有那份打分就重算不出 exposure。
    bands: saved.scores ? exposureBands(presetId, keys, saved.scores, bytes, people) : null,
    terrain: crowdTerrain(presetId, keys, bytes, { versionId: saved.versionId, grid: GRID }),
    voices: voicesOf(saved.versionId, presetId, bytes).map((voice) => ({ ...voice, who: personView(people[voice.id]) })),
    // Jev 的决策现场：存档里就有（CLI 自 0004 起就存 decisions）——以前回放层没往下传，
    // 首页示例卡凭空缺了这一节；旧档的坏形状由 decisionsOf 还原（见其注释）。
    decisions: decisionsOf(saved, presetId),
    // 存档回放的 tokens：旧档没存过（只有 usd）→ 0；新档由 CLI 存 result.tokens。
    spent: { usd: saved.usd ?? 0, tokens: saved.tokens ?? 0 },
  };
}
