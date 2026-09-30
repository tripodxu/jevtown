// 从存档 JSON（scripts/check.js 的 output/checks 格式）回放一页视图，不调任何 API。
// 这也是"纯静态部署"的可行证明：回放全部发生在浏览器。
import { PRESETS } from './presets.js';
import { crowd, GRID } from './personas.js';
import { counters, segments, topSegments, voicesOf } from './summary.js';
import { crowdTerrain } from './spatial.js';
import { encodeBytes } from './bytes.js';
import { personView } from './labels.js';

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
    terrain: crowdTerrain(presetId, keys, bytes, { versionId: saved.versionId, grid: GRID }),
    voices: voicesOf(saved.versionId, presetId, bytes).map((voice) => ({ ...voice, who: personView(people[voice.id]) })),
    spent: { usd: saved.usd ?? 0, tokens: 0 },
  };
}
