// 一次性对拍：一次全城检查（10 000 人 / 每批 100）里，「每批全量重扫」与「增量折叠」的耗时对比。
import { newTally, foldBatch } from '../public/tally.js';

const KEYS = ['scrolled_past', 'read', 'liked', 'disliked', 'reposted'];
const TONE = [0, 0, 1, -1, 1];
const indexOf = (reaction) => KEYS.indexOf(reaction);
const toneOf = (index) => TONE[index] ?? 0;

let seed = 7;
const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const batches = [];
for (let i = 0; i < 100; i++) {
  batches.push(Array.from({ length: 100 }, (_, k) => ({ id: i * 100 + k, reaction: KEYS[Math.floor(next() * KEYS.length)] })));
}

const ms = (fn) => {
  const t = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t) / 1e6;
};

// 旧路径：每批判完把 10000 字节全扫两遍（updateLiveStats 数 judged，paintBatch 数 glad/sorry）
const scan = (bytes) => {
  let judged = 0;
  for (const b of bytes) if (b) judged += 1;
  let glad = 0;
  let sorry = 0;
  for (const b of bytes) {
    if (!b) continue;
    const tone = TONE[b - 1] ?? 0;
    if (tone === 1) glad += 1;
    if (tone === -1) sorry += 1;
  }
  return { judged, glad, sorry };
};

// 旧路径也要先把 drawn 写进 bytes
const oldBytes = new Uint8Array(10000);
let old = 0;
for (const batch of batches) {
  old += ms(() => {
    for (const { id, reaction } of batch) oldBytes[id] = indexOf(reaction) + 1;
    scan(oldBytes);
    scan(oldBytes);
  });
}

// 新路径：foldBatch 一次折叠出三个计数
const tally = newTally(10000);
let now = 0;
for (const batch of batches) {
  now += ms(() => foldBatch(tally, batch, indexOf, toneOf));
}

const expected = scan(oldBytes);
const same = tally.judged === expected.judged && tally.glad === expected.glad && tally.sorry === expected.sorry;
console.log(`旧：每批两次全量重扫   ${old.toFixed(2)} ms / 100 批`);
console.log(`新：每批一次增量折叠   ${now.toFixed(2)} ms / 100 批`);
console.log(`提速                  ${(old / now).toFixed(1)}x`);
console.log(`结果一致              ${same}  (judged=${tally.judged} glad=${tally.glad} sorry=${tally.sorry})`);
if (!same) process.exit(1);
