// The feed algorithm: who sees a post, and whether it travels further. Wave 1 goes to the people
// Jev thinks the post is for, plus some random ones. Later waves follow the people who really
// reacted, and the grid neighbours of those who spread it. Every post is on its own: the town keeps
// no memory of who wrote what.
import { GRID } from './personas.js';
import { PRESETS, asksFor } from './presets.js';
import { groupsOf } from './requests.js';

// The sizes, the rule and the weights below come from docs/measurements.md.
export const WAVES = [
  { size: 600, random: 100 },
  { size: 1500, random: 150 },
  { size: 3000, random: 300 },
  { size: Infinity, random: 0 },
];
/**
 * A wave sends the text further when the glad reactions outweigh the sorry ones by this share of
 * the wave. Measured on first waves: strong texts give 0.12 to 0.33, weak ones -0.39 to 0.02.
 *
 * The bar sits *below* what a coin flip scores (see `randomBaseline`): a wave near it carries no
 * information, so passing on it is luck rather than judgement. Measured on three real texts
 * (docs/research/wave-baseline-report.md). It stays where it is — moving it needs recalibrating
 * against the baselines that report puts on screen.
 */
export const GLAD_ENOUGH = 0.1;

/**
 * What a wave looks like if nobody read it: every reaction equally likely, so the mood is the
 * table's mean tone and the spread is the standard error of the mean. Anything within about two
 * standard errors of it is a wave a die roll could have produced.
 */
export function randomBaseline(presetId, n) {
  const tones = Object.values(PRESETS[presetId].reactions).map((reaction) => reaction.tone ?? 0);
  const mean = tones.reduce((sum, tone) => sum + tone, 0) / Math.max(1, tones.length);
  const variance = tones.reduce((sum, tone) => sum + (tone - mean) ** 2, 0) / Math.max(1, tones.length);
  const sd = Math.sqrt(variance);
  return { mean, sd, error: sd / Math.sqrt(Math.max(1, n)) };
}

/**
 * How far a wave is from what chance alone would produce, in standard errors: 0 is a coin flip, 2 is
 * clearly something else. Negative means the wave was worse than random, which is not a failure —
 * a text nobody wants is a real answer, and it is worth reading as one.
 */
export function moodZ(presetId, waveMood, n) {
  const { mean, error } = randomBaseline(presetId, n);
  return error ? (waveMood - mean) / error : 0;
}

// -- what a persona is scored by: column numbers, not names -----------------------------------------
//
// A free Worker has 10 ms of CPU for one request, so what a wave spends is not the arithmetic but
// *looking names up*: 83 names a persona, each read out of an object or a Map, once per person and
// again per count. The names are not ours to choose — they are exactly the groups
// `requests.js:groupsOf` asks Jev about — and they never change, so a column number is the same
// information without the hashing.
//
// Measured on the same 10,000 (`listing`, the shapes nextWave works in), nothing else changed:
//
//   exposure        1.75ms → 0.39ms (per-persona row of columns) → 0.11ms (one flat CSR row)
//   reached tally   1.43ms → 0.19ms
//   share lookup    2.05ms → ~0     (a column indexes the share directly)
//   nextWave        3.72ms → 1.20ms at 600 reached, 1.89ms → 1.11ms at 5,100 reached
//   firstWave       2.83ms → 0.67ms
//
// **Not one wave changes**: the columns come out in the order the names were built and the terms are
// added in the same order, so the sums are the same doubles — pinned by test/golden-waves.txt, because
// a wave list is stored in the check's result (versions.plan) and a different one is a different check.
const WEIGHT_OF_PART = { interest: 1, field: 1, age: 0.6, shopping: 1.5, budget: 0.6 };

/** The attribute ids, the number each one is, and how much its part counts — 60 columns, 83 in a market. */
const COLUMNS = [];
function columnsOf(market) {
  return (COLUMNS[market ? 1 : 0] ??= (() => {
    const ids = groupsOf(market).map(([id]) => id);
    return { ids, at: new Map(ids.map((id, index) => [id, index])), weights: Float64Array.from(ids, (id) => WEIGHT_OF_PART[id.slice(0, id.indexOf(':'))]) };
  })());
}

// A persona's own columns are built once: a free Worker ranks the same 10,000 for every wave.
const ROWS = [new WeakMap(), new WeakMap()];
function columnsOfPersona(who, market) {
  const cache = ROWS[market ? 1 : 0];
  let row = cache.get(who);
  if (!row) {
    const { at } = columnsOf(market);
    const columns = who.interests.map((id) => at.get(`interest:${id}`));
    columns.push(at.get(`field:${who.field}`), at.get(`age:${who.ageGroup}`));
    if (market) {
      if (who.shopping !== 'nothing') columns.push(at.get(`shopping:${who.shopping}`));
      columns.push(at.get(`budget:${who.budget}`));
    }
    cache.set(who, (row = Int32Array.from(columns)));
  }
  return row;
}

// The rows of a whole crowd end to end — one memory walk instead of one map lookup per person. Built
// once per crowd; `unseen` is a fresh array every wave, so that one is walked into a new row each time
// (0.3 ms for 10,000, and it replaces 10,000 Map lookups).
function flatOf(personas, market) {
  const offsets = new Int32Array(personas.length + 1);
  for (let i = 0; i < personas.length; i++) offsets[i + 1] = offsets[i] + columnsOfPersona(personas[i], market).length;
  const ids = new Int32Array(offsets[personas.length]);
  for (let i = 0, at = 0; i < personas.length; i++) {
    const row = columnsOfPersona(personas[i], market);
    for (let k = 0; k < row.length; k++) ids[at + k] = row[k];
    at += row.length;
  }
  return { offsets, ids };
}

/** `(weight × score)³` per column: the one term a persona's exposure adds up, folded once per check. */
function cubeTable(scores, market) {
  const { ids, weights } = columnsOf(market);
  const cubes = new Float64Array(ids.length);
  for (let i = 0; i < ids.length; i++) cubes[i] = (weights[i] * (scores[ids[i]] ?? 0)) ** 3;
  return cubes;
}

/**
 * How much a persona should see the text: the sum of cubes of the scores of its own attributes.
 * The cube lets one strong match ("is looking to buy a phone") outweigh several lukewarm ones; of the
 * formulas tried it came closest to the best possible order, 83 to 97% of it on the first 500.
 *
 * The cubes are folded once per set of scores and the personas fold over them — `firstWave` folds for
 * 10,000 people in a row, and folding per persona rebuilt an 83-entry table ten thousand times: 2.8 ms
 * of `firstWave` became 25 ms that way, which is the whole point of the columns in reverse.
 */
export function exposure(who, scores, presetId) {
  const market = Boolean(PRESETS[presetId].market);
  return exposureBy(who, cubeTable(scores, market), market);
}

/** The same number as `exposure`, off cubes already folded — what a wave ranks 10,000 people with. */
function exposureBy(who, cubes, market) {
  const row = columnsOfPersona(who, market);
  let sum = 0;
  for (let i = 0; i < row.length; i++) sum += cubes[row[i]];
  return sum;
}

/**
 * The `size - random` unseen personas that rank highest, best first, plus `random` other unseen ones
 * picked by `random()`. Ranks go through a typed array, which sorts several times faster than objects.
 *
 * Two linear passes instead of one quadratic one. The cut is the `wanted`-th highest rank, so exactly
 * `wanted` people are ≥ it; the people exactly on it fill whatever is left over, and **anyone on the
 * cut who does not fit stays in the pool the random draw takes from** — it used to, because they came
 * out of the old loop inside the array being drawn from. That loop was a `rest.splice(i--, 1)` scanned
 * with `rest`, which is quadratic in the number of people on the cut — everybody at once when the text
 * ranks flat (a text Jev scores the same for every group ranks all 10,000 at 0, so `cut` is 0 and all
 * of them land on it). Measured 8.2–13.9 ms that way, over the free Workers tier's 10 ms CPU budget for
 * one request, to pick a single wave; 2.7 ms as two passes. First pass counts what is above the cut,
 * second fills `best` and `rest` **in the order `unseen` came in**, which is what keeps the random draw
 * pulling the same people as before — the wave a post gets is part of its stored result, so a seed that
 * stops producing yesterday's wave is a changed check, not an optimization.
 */
function pick(personas, seen, rank, wave, random) {
  const unseen = personas.filter((who) => !seen.has(who.id));
  const ranks = new Float64Array(unseen.length);
  for (let i = 0; i < unseen.length; i++) ranks[i] = rank(unseen[i]);
  return pickBy(unseen, ranks, wave, random);
}

/**
 * The `k`-th smallest of `values`, without sorting all of them. `pick` wants exactly one number out of
 * 9,400 — the `wanted`-th highest rank — and paid a full sort for it: 0.39 ms a wave. Selecting that
 * one number is 0.04 ms.
 *
 * Median-of-three pivot, Hoare partition, and the loop narrows to the side `k` fell on. Median-of-three
 * matters more than usual here because ranks repeat: a persona whose attributes all score zero ranks
 * zero, and a whole wave of them sits at the same value, so a pivot taken from one end would land on an
 * equal run every time. Checked against the full sort on 15,937 `(values, k)` pairs — heavy duplicates,
 * all-equal, sorted and reversed inputs — zero disagreements.
 */
function kthSmallest(values, k) {
  const a = Float64Array.from(values);
  let lo = 0;
  let hi = a.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const x = a[lo];
    const y = a[mid];
    const z = a[hi];
    const pivot = x < y ? (y < z ? y : (x < z ? z : x)) : (x < z ? x : (y < z ? z : y));
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i] < pivot) i += 1;
      while (a[j] > pivot) j -= 1;
      if (i <= j) {
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
        i += 1;
        j -= 1;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return a[k];
}

/**
 * The wave out of ranks already worked out: `ranks[i]` is the rank of `unseen[i]`, in the order the
 * crowd gave them. Rank only the unseen — the last wave of a check has a tenth of the town left, and
 * ranking the other 9,000 costs 1.5 ms a wave for numbers nobody reads.
 */
function pickBy(unseen, ranks, { size, random: randomCount }, random) {
  if (unseen.length <= size) return unseen;
  const wanted = size - randomCount;
  const cut = kthSmallest(ranks, unseen.length - wanted);
  let above = 0;
  for (let i = 0; i < unseen.length; i++) if (ranks[i] > cut) above += 1;
  let onCut = Math.min(wanted, above === wanted ? 0 : wanted - above);
  // Plain indices rather than { who, rank } pairs: 9,400 of those took 0.64 ms, indices take 0.47 ms
  // and the comparison reads the rank out of `ranks` instead of carrying it along.
  const best = [];
  const rest = [];
  for (let i = 0; i < unseen.length; i++) {
    if (ranks[i] > cut) best.push(i);
    else if (ranks[i] === cut && onCut) {
      best.push(i);
      onCut -= 1;
    } else rest.push(i);
  }
  const wave = best.sort((a, b) => ranks[b] - ranks[a]).map((i) => unseen[i]);
  for (let i = 0; i < randomCount && rest.length; i++) {
    const at = Math.floor(random() * rest.length);
    wave.push(unseen[rest[at]]);
    rest[at] = rest[rest.length - 1];
    rest.pop();
  }
  return wave;
}

/** Wave 1: the people Jev thinks the text is for. */
export function firstWave(personas, scores, presetId, random) {
  const market = Boolean(PRESETS[presetId].market);
  const cubes = cubeTable(scores, market);
  return pick(personas, new Set(), (who) => exposureBy(who, cubes, market), WAVES[0], random);
}

/**
 * The next wave. `reactions` is a Map of persona id → reaction id for everyone reached so far.
 * Every attribute value gets the share of its people who stopped, pulled towards the overall share
 * while only a few of them have seen the text; a persona ranks by its own values, with Jev's first
 * guess as a tie-breaker. Grid neighbours of those who spread the text come first.
 */
export function nextWave(personas, reactions, scores, presetId, waveIndex, random) {
  const preset = PRESETS[presetId];
  const market = Boolean(preset.market);
  const seenBy = new Float64Array(columnsOf(market).ids.length);
  const stoppedBy = new Float64Array(seenBy.length);
  let reached = 0;
  let stopped = 0;
  for (const who of personas) {
    const reaction = reactions.get(who.id);
    if (reaction === undefined) continue;
    const hit = preset.reactions[reaction]?.stopped ? 1 : 0;
    reached += 1;
    stopped += hit;
    const row = columnsOfPersona(who, market);
    for (let i = 0; i < row.length; i++) {
      seenBy[row[i]] += 1;
      stoppedBy[row[i]] += hit;
    }
  }
  const overall = stopped / Math.max(1, reached);
  const PRIOR = 20;
  // A column nobody reached has no tally, and the ranking gave it the overall share — which is also
  // the one `share.fill(overall)` hands those columns, so the numbers come out the same either way.
  const share = new Float64Array(seenBy.length).fill(overall);
  for (let i = 0; i < share.length; i++) if (seenBy[i]) share[i] = (stoppedBy[i] + PRIOR * overall) / (seenBy[i] + PRIOR);

  // The town is 100 people wide; the people visitors moved in live in the rows under the first hundred.
  const size = personas.reduce((most, who) => Math.max(most, who.id + 1), 0);
  const nearSpreader = new Set();
  for (const [id, reaction] of reactions) {
    if (!preset.reactions[reaction]?.spreads) continue;
    const x = id % GRID;
    const y = Math.floor(id / GRID);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < GRID && ny >= 0 && ny * GRID + nx < size) nearSpreader.add(ny * GRID + nx);
      }
    }
  }

  // The three terms of the rank, folded over a persona's columns in the order they were built — the
  // same order, and the same additions, as the name loop this replaces. Only the unseen are ranked:
  // they are the only ones `pick` reads, and by the last wave that is a tenth of the town.
  const unseen = personas.filter((who) => !reactions.has(who.id));
  const cubes = cubeTable(scores, market);
  const flat = flatOf(unseen, market);
  const ranks = new Float64Array(unseen.length);
  for (let i = 0; i < unseen.length; i++) {
    let best = 0;
    let sum = 0;
    let guess = 0;
    for (let k = flat.offsets[i]; k < flat.offsets[i + 1]; k++) {
      const value = share[flat.ids[k]];
      if (value > best) best = value;
      sum += value;
      guess += cubes[flat.ids[k]];
    }
    ranks[i] = 0.6 * best + 0.4 * (sum / (flat.offsets[i + 1] - flat.offsets[i])) + 0.05 * guess + (nearSpreader.has(unseen[i].id) ? 0.1 : 0);
  }
  return pickBy(unseen, ranks, WAVES[Math.min(waveIndex, WAVES.length - 1)], random);
}

/** Glad reactions minus sorry ones, as a share of the wave. waveReactions: the reaction ids of that wave alone. */
export function mood(presetId, waveReactions) {
  const preset = PRESETS[presetId];
  const net = waveReactions.reduce((sum, reaction) => sum + (preset.reactions[reaction]?.tone ?? 0), 0);
  return net / Math.max(1, waveReactions.length);
}

/** Does a finished wave send the text further? */
export const travels = (presetId, waveReactions) => mood(presetId, waveReactions) >= GLAD_ENOUGH;

/**
 * Whether somebody in town has not seen the text yet: a byte of `reactions` still at 0. `inTown`
 * limits the town to the people whose byte in it is 1.
 */
export function anyoneLeft(reactions, inTown = null) {
  for (let id = 0; id < reactions.length; id++) if (!reactions[id] && (!inTown || inTown[id])) return true;
  return false;
}

// -- who is asked the closing questions (presets.js:ASKS)

/** Every question is one request of about 100 personas; a resident counts as four (resident.js:RESIDENT_WEIGHT). */
export const ASK_WEIGHT = 100;
/**
 * Why is asked of those who got annoyed up to this weight first. In the order the feed picked people
 * they would be few: first waves give sorry reactions 0.00 to 0.01 on five of six strong texts, and
 * 0.07, 0.19 and 0.44 on the spam, the rage post and the scam listing (docs/measurements.md §6), so a
 * mixed sample of the spam would be mostly scrollers.
 */
export const SORRY_WHY = 40;
/** A question is asked only when this many people fit: fewer would pay for a list the page does not show. */
export const MIN_ASKED = 10;

/** The people a check keeps for its closing questions, by what they did: none yet. */
export const emptyGathered = () => ({ scrolled: [], sorry: [], glad: [], stopped: [] });

/**
 * Adds the people of a wave to those kept for the closing questions, in the order the feed picked
 * them: the best-ranked first and the random ones last, so the first wave's people come first and,
 * among them, those Jev thought the text was for. scrolled is who scrolled past, sorry who got
 * annoyed, glad who was glad (spreading included), stopped everybody who stopped. Nobody Jev did not
 * answer for, and nobody it could not tell about, is kept. Each group stops at ASK_WEIGHT; a person
 * too heavy for the room left is skipped while lighter people after them still fit.
 * reactionOf(id) → reaction id, or undefined. → a new { scrolled, sorry, glad, stopped }
 */
export function gatherAsked(presetId, picked, reactionOf, gathered = emptyGathered(), weightOf = () => 1) {
  const preset = PRESETS[presetId];
  const next = {};
  const room = {};
  for (const group of Object.keys(emptyGathered())) {
    next[group] = [...(gathered[group] ?? [])];
    room[group] = ASK_WEIGHT - next[group].reduce((sum, id) => sum + weightOf(id), 0);
  }
  const add = (group, id, weight) => {
    if (weight > room[group]) return;
    next[group].push(id);
    room[group] -= weight;
  };
  for (const id of picked) {
    const reaction = preset.reactions[reactionOf(id)];
    if (!reaction || reaction.hollow) continue;
    const weight = weightOf(id);
    if (!reaction.stopped) add('scrolled', id, weight);
    if (reaction.tone === -1) add('sorry', id, weight);
    if (reaction.tone === 1) add('glad', id, weight);
    if (reaction.stopped) add('stopped', id, weight);
  }
  return next;
}

/** The ids, in order, that fit under the weight `limit` together with those already `taken`. */
function upTo(ids, limit, taken, weightOf) {
  let weight = taken.reduce((sum, id) => sum + weightOf(id), 0);
  const chosen = [];
  for (const id of ids) {
    if (weight + weightOf(id) > limit) continue;
    chosen.push(id);
    weight += weightOf(id);
  }
  return chosen;
}

/**
 * Who a question goes to. Why: those who got annoyed up to SORRY_WHY, then those who scrolled past,
 * then more of the annoyed if there is room. What made them stop: the glad. What they would comment
 * and how far they read: the same people, everybody who stopped.
 */
export function whoIsAsked(question, gathered, weightOf = () => 1) {
  if (question === 'hook') return gathered.glad;
  if (question !== 'why') return gathered.stopped;
  const sorry = upTo(gathered.sorry, SORRY_WHY, [], weightOf);
  const scrolled = upTo(gathered.scrolled, ASK_WEIGHT, sorry, weightOf);
  const more = upTo(gathered.sorry.filter((id) => !sorry.includes(id)), ASK_WEIGHT, [...sorry, ...scrolled], weightOf);
  return [...sorry, ...scrolled, ...more];
}

/** The closing questions of a text and who each goes to; a question with fewer than MIN_ASKED people is left out. → [{ question, ids }] */
export function asking(presetId, text, gathered, weightOf = () => 1) {
  return asksFor(presetId)
    .map((question) => ({ question, ids: whoIsAsked(question, gathered, weightOf) }))
    .filter((asked) => asked.ids.length >= MIN_ASKED);
}

// -- an audience in words (requests.js:audienceRequest): only the people who fit it read the text

/** A part a description names counts when one of its groups scores at least this, "Some of them". Not measured yet (scripts/probe.js audience). */
export const PART_FROM = 0.5;
/**
 * Within a part that counts, a group counts from this share of the part's best group: with the best
 * at "All of them", "Most of them" counts and "Some of them" does not. Not measured yet.
 */
export const PASS_SHARE = 0.7;
/** The fewest people an audience may have: fewer would be a handful of noise, and one resident would not do. Not measured yet. */
export const MIN_AUDIENCE = 50;

/** Where each part of a description lives in a persona. Looking to buy nothing fits no shopping. */
const VALUES_OF = {
  interest: (who) => who.interests,
  field: (who) => [who.field],
  age: (who) => [who.ageGroup],
  budget: (who) => [who.budget],
  shopping: (who) => (who.shopping === 'nothing' ? [] : [who.shopping]),
};

/**
 * The parts of a description that count, and the groups that count in each, from Jev's scores of
 * an audience request and the parts it says the description names. A part the description does not
 * name excludes nobody. → { interest: ['startups'], field: ['it'] }, or null when no part counts.
 */
export function partsOf(scores, named) {
  const parts = {};
  for (const part of named) {
    const groups = Object.entries(scores).filter(([id]) => id.startsWith(`${part}:`)).map(([id, score]) => [id.slice(part.length + 1), score]);
    const best = Math.max(0, ...groups.map(([, score]) => score));
    if (best >= PART_FROM) parts[part] = groups.filter(([, score]) => score >= PASS_SHARE * best).map(([value]) => value);
  }
  return Object.keys(parts).length ? parts : null;
}

/** The personas with a counting group in every counting part, in the order given; within a part one group is enough. */
export function audienceOf(personas, parts) {
  const wanted = Object.entries(parts).map(([part, values]) => [VALUES_OF[part], new Set(values)]);
  return personas.filter((who) => wanted.every(([valuesOf, values]) => valuesOf(who).some((value) => values.has(value))));
}

/** A byte per person of a town of `size`: 1 for the members of an audience. */
export function audienceMask(members, size) {
  const mask = new Uint8Array(size);
  for (const who of members) mask[who.id] = 1;
  return mask;
}

/** How many people the waves have reached after each wave, in a town or an audience of `total`: the town's waves, cut where they reach everybody. */
export function waveReach(total) {
  const reach = [];
  for (const wave of WAVES) {
    reach.push(Math.min(total, (reach.at(-1) ?? 0) + wave.size));
    if (reach.at(-1) >= total) break;
  }
  return reach;
}
