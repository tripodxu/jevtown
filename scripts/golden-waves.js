// The wave lists as they stood before R34, pinned so a faster feed can be told from a changed check.
// A wave list is stored in the check's result (versions.plan) — the same seed sending a different 600
// people is not an optimization, it is a different check, and every number reported on that post is
// then a number about a check that never happened. The lists themselves run to tens of kilobytes, so
// what is pinned is their hash.
//
//   node scripts/golden-waves.js            # rewrite test/golden-waves.txt from the current code
//   node scripts/golden-waves.js --check    # compare, print the diff, exit 1 on any difference
//
// Only ever rewrite it when the change *means* to move the waves, and say so in the commit: this file
// is the line between "faster" and "a different simulation".
import fs from 'node:fs';
import { crowd } from '../public/shared/personas.js';
import { firstWave, nextWave } from '../public/shared/feed.js';
import { rng, hash32 } from '../public/shared/rng.js';

const people = crowd('zh');
const lines = ['# 波次名单金标准（R34 优化前生成）：preset 波号 人数 名单哈希', '# 改动 pick/nextWave 的任何一处，先跑 node scripts/golden-waves.js --check 对比；不一样就不是优化。'];
for (const presetId of ['post', 'listing', 'product', 'headline']) {
  const market = { post: false, listing: true, product: true, headline: false }[presetId];
  // One set of scores per genre shape: the market presets get prices and ages, the others don't.
  const scores = market
    ? { 'interest:parenting': 0.9, 'interest:babies': 0.8, 'shopping:phone': 0.85, 'field:it': 0.4, 'age:a35': 0.5, 'budget:middle': 0.3, 'interest:tea': 0.2, 'interest:cooking': 0.45 }
    : { 'interest:programming': 0.9, 'interest:tea': 0.2, 'field:it': 0.85, 'age:a25': 0.5, 'age:a35': 0.4, 'interest:gaming': 0.3 };
  const random = rng(hash32('gold', presetId));
  const reached = new Map();
  const reactionPool = ['liked', 'shared', 'scrolled_past', 'disliked', 'opened', 'ignored'];
  const rows = [];
  for (const index of [0, 1, 2, 3]) {
    const wave = index === 0 ? firstWave(people, scores, presetId, random) : nextWave(people, reached, scores, presetId, index, random);
    rows.push(`${presetId} ${index} ${wave.length} ${hash32(...wave.map((who) => who.id))}`);
    // A fixed pool, walked off the wave index: every wave gets glad and sorry people, in the same
    // proportion whatever the ranking did, so the pin is about who was reached and not about mood.
    for (const [i, who] of wave.entries()) reached.set(who.id, reactionPool[(i + index) % reactionPool.length]);
  }
  lines.push(...rows);
}
const text = `${lines.join('\n')}\n`;
// Only the data lines are pinned; the header is a note for whoever reads the file next, and rewriting
// it must not read as a changed wave.
const rowsOf = (body) => body.split('\n').filter((line) => line && !line.startsWith('#'));

if (process.argv.includes('--check')) {
  const pinned = rowsOf(fs.readFileSync(new URL('../test/golden-waves.txt', import.meta.url), 'utf8'));
  const now = rowsOf(text);
  if (pinned.join('\n') === now.join('\n')) console.log(`GOLDEN IDENTICAL —— ${now.length} 行波次名单一字未变`);
  else {
    console.log('GOLDEN DIFFERS —— 这不是优化，是换了模拟：');
    for (const [i, line] of pinned.entries()) if (now[i] !== line) console.log(`  金标准 ${line}\n  现在   ${now[i] ?? '(少一行)'}`);
    process.exitCode = 1;
  }
} else {
  fs.writeFileSync(new URL('../test/golden-waves.txt', import.meta.url), text);
  console.log(text);
}