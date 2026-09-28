// 实时监控的增量统计：把每批判定折进"全镇快照"，每批只做本批人数的活，
// 不再每批重扫一万格。纯函数、无 DOM，Node 可直接单测。
// 字节约定与 grid.js 的地图一致：0 = 还没轮到，否则 = 该反应在 keys 里的序号 + 1。

/** 一座空小镇：字节数组 + 三个累计计数（已判定 / 乐见 / 反感）。 */
export const newTally = (size) => ({ bytes: new Uint8Array(size), judged: 0, glad: 0, sorry: 0 });

/** 撤销一个序号对应的态度计数。 */
const unvote = (tally, tone) => {
  if (tone === 1) tally.glad -= 1;
  else if (tone === -1) tally.sorry -= 1;
};

/**
 * 把一批 drawn（[{ id, reaction }]）折进快照，原地更新并返回快照。
 * indexOf(reaction) → 反应在 keys 里的序号（< 0 = 不认识，跳过）；
 * toneOf(index) → 1 / 0 / -1，取自 presets.js 的 reaction.tone。
 * 同一个人重复折（重试、重放）或被改判时，先撤销旧计数再记新的，因此是幂等的。
 */
export function foldBatch(tally, drawn, indexOf, toneOf) {
  for (const { id, reaction } of drawn) {
    const byte = indexOf(reaction) + 1;
    if (byte < 1) continue;
    const was = tally.bytes[id];
    if (was === byte) continue;
    tally.bytes[id] = byte;
    if (was) unvote(tally, toneOf(was - 1)); // 改判：换态度但不重复计人数
    else tally.judged += 1; // 新判定
    const tone = toneOf(byte - 1);
    if (tone === 1) tally.glad += 1;
    else if (tone === -1) tally.sorry += 1;
  }
  return tally;
}
