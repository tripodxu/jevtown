// From the bytes of a finished check to what the post page shows: counters, the segments that
// stopped or got annoyed, the buyers' questions, the demand curve, what the town said when asked,
// the voices. The page, the terminal and whoever reads a check through runCheck read it the same way.
import { PRESETS, REASONS, lookOf, answersFor, questionOfList, NOT_SHOWN, CANT_TELL } from './presets.js';
import { MIN_ASKED } from './feed.js';
import { INTERESTS, INTEREST_COLUMNS, INTEREST_ROW_ZH } from './vocab.js';
import { unit } from './rng.js';

/** Segments smaller than this are not reported: a handful of people is noise. */
const MIN_SEGMENT = 40;
/** The same floor for a crowd of `count`: 40 in the town, down to 15 in a small audience, where every group is small. */
export const minSegment = (count) => Math.min(MIN_SEGMENT, Math.max(15, Math.round(0.004 * count)));

/** The people of a town who are in an audience: all of them without one. A resident who moved in after the check is past the mask's end and left out. */
export const inAudience = (people, mask) => (mask ? people.filter((who) => mask[who.id] === 1) : people);

/** How many personas did what. → { reach, stopped, glad, sorry, byReaction: { liked: 12, ... } } */
export function counters(presetId, keys, reactions) {
  const preset = PRESETS[presetId];
  const byReaction = Object.fromEntries(keys.map((key) => [key, 0]));
  const totals = { reach: 0, stopped: 0, glad: 0, sorry: 0 };
  for (const byte of reactions) {
    if (byte === NOT_SHOWN) continue;
    const reaction = preset.reactions[keys[byte - 1]];
    byReaction[keys[byte - 1]] += 1;
    totals.reach += 1;
    if (reaction.stopped) totals.stopped += 1;
    if (reaction.tone === 1) totals.glad += 1;
    if (reaction.tone === -1) totals.sorry += 1;
  }
  return { ...totals, byReaction };
}

const SEGMENTS = {
  interest: (who) => who.interests,
  field: (who) => [who.field],
  age: (who) => [who.ageGroup],
  temper: (who) => [who.temper],
  budget: (who) => [who.budget],
  shopping: (who) => (who.shopping === 'nothing' ? [] : [who.shopping]),
  city: (who) => [who.city.zh], // 本项目界面用中文城市名
};

/**
 * 人群 → 分组号的紧凑表（CSR），按 people 数组身份缓存，只算一次。
 *
 * 原来 `segments()` 每次调用都要在对 10 000 个人的外层循环里重做三件本该只做一次的事：
 * `Object.entries(SEGMENTS)`（10 000 次分配）、每个维度的取值函数与数组字面量（70 000 次）、
 * `` `${attribute}:${value}` `` 拼串再哈希（70 000 次）。实测这让 `segments()` 成了报告页
 * 的头号开销。编码一次之后，热路径只剩整数读写。
 *
 * 分组号按首次出现顺序分配，所以输出顺序与旧的 Map 插入顺序一致。
 * people 视为不可变（`crowd()` 的产物）；传进来的子集各自成表，随数组一起被 WeakMap 回收。
 */
const GROUP_TABLES = new WeakMap();

function groupTable(people) {
  const cached = GROUP_TABLES.get(people);
  if (cached) return cached;
  const groups = [];
  const index = new Map();
  const slot = (attribute, value) => {
    const key = `${attribute}:${value}`;
    let id = index.get(key);
    if (id === undefined) {
      index.set(key, (id = groups.length));
      groups.push({ attribute, value });
    }
    return id;
  };
  const dimensions = Object.entries(SEGMENTS);
  const ids = new Int32Array(people.length);
  const start = new Int32Array(people.length + 1);
  const owned = [];
  for (let i = 0; i < people.length; i++) {
    const who = people[i];
    ids[i] = who.id;
    for (const [attribute, valuesOf] of dimensions) {
      for (const value of valuesOf(who)) owned.push(slot(attribute, value));
    }
    start[i + 1] = owned.length;
  }
  const table = {
    ids,
    start,
    group: Int32Array.from(owned),
    groups,
    shopping: Uint8Array.from(groups, (one) => (one.attribute === 'shopping' ? 1 : 0)),
  };
  GROUP_TABLES.set(people, table);
  return table;
}

/**
 * Every segment of the crowd: how many of its people the text reached, and what share of the whole
 * segment stopped, was glad, was sorry. People the text never reached count as not stopped, the way
 * a network counts: "56% of all runners stopped" against "10% of everybody". The lifts are those
 * shares over the crowd's. → [{ attribute, value, size, reached, stopped, glad, sorry, stoppedLift, gladLift, sorryLift }]
 */
export function segments(presetId, keys, reactions, people) {
  const preset = PRESETS[presetId];
  const all = counters(presetId, keys, reactions);
  const { ids, start, group, groups, shopping } = groupTable(people);
  const reactionsOf = preset.reactions;
  const market = Boolean(preset.market);
  const width = groups.length;
  const reach = new Int32Array(width);
  const stopped = new Int32Array(width);
  const glad = new Int32Array(width);
  const sorry = new Int32Array(width);
  const sizes = new Int32Array(width);

  for (let i = 0; i < people.length; i++) {
    const byte = reactions[ids[i]];
    let hit = 0;
    let tone = 0;
    if (byte !== NOT_SHOWN) {
      const reaction = reactionsOf[keys[byte - 1]];
      hit = reaction?.stopped ? 1 : 0;
      tone = reaction?.tone ?? 0;
    }
    for (let k = start[i]; k < start[i + 1]; k++) {
      const g = group[k];
      if (!market && shopping[g]) continue; // 非市场预设不统计"想买"，这些组保持 0 而被下面滤掉
      sizes[g] += 1;
      if (!byte) continue;
      reach[g] += 1;
      stopped[g] += hit;
      if (tone === 1) glad[g] += 1;
      else if (tone === -1) sorry[g] += 1;
    }
  }

  const floor = minSegment(people.length);
  const lift = (count, sizeOf, total) => (total ? count / sizeOf / (total / people.length) : 0);
  const out = [];
  for (let g = 0; g < width; g++) {
    if (sizes[g] < floor) continue;
    out.push({
      attribute: groups[g].attribute,
      value: groups[g].value,
      size: sizes[g],
      reached: reach[g],
      stopped: stopped[g],
      glad: glad[g],
      sorry: sorry[g],
      stoppedLift: lift(stopped[g], sizes[g], all.stopped),
      gladLift: lift(glad[g], sizes[g], all.glad),
      sorryLift: lift(sorry[g], sizes[g], all.sorry),
    });
  }
  return out;
}

/**
 * What the feed algorithm scores people by (feed.js:namesOf): a temper would name the trolls of every
 * broad text, and a city is not whom a text is written for. Shopping and budget count only for a market.
 */
const SCORED = ['interest', 'field', 'age'];
const SCORED_IN_MARKET = [...SCORED, 'shopping', 'budget'];

/**
 * The group most often annoyed among the people the text reached: at least MIN_SEGMENT of them reached,
 * at least 8 annoyed, and 1.3 times the share of the whole reach. Counted over the reached, since a
 * group shown the text more would otherwise look more annoyed. → a segment of segments(), or null
 */
export function mostAnnoyed(all, totals, presetId) {
  if (!totals.reach) return null;
  const share = totals.sorry / totals.reach;
  const scored = PRESETS[presetId].market ? SCORED_IN_MARKET : SCORED;
  return all
    .filter((segment) => scored.includes(segment.attribute) && segment.reached >= MIN_SEGMENT && segment.sorry >= 8 && segment.sorry / segment.reached >= 1.3 * share)
    .sort((a, b) => b.sorry / b.reached - a.sorry / a.reached)[0] ?? null;
}

/** The few segments worth naming for one of 'stopped', 'glad', 'sorry': clearly above the crowd, and not a handful of people. */
export function topSegments(all, what, count = 5) {
  return all
    .filter((segment) => segment[what] >= 8 && segment[`${what}Lift`] >= 1.3)
    .sort((a, b) => b[`${what}Lift`] - a[`${what}Lift`])
    .slice(0, count);
}

/** 街区判定少于这个数就不给颜色：一格 ≈ 200 人，几十个判定撑不起一个占比结论。 */
export const MIN_SLICE = 25;

/**
 * 人群切片热力图：把反应场聚合到人格网格固有的 40 个「兴趣街区」上。
 * 兴趣在网格上按 5 个年龄段 × 8 列铺开（vocab.js 的 INTERESTS 布局），每个街区 ≈ 200 个
 * 同兴趣同龄段的邻居——segments 的边际统计答不了"哪个年龄段 × 哪类兴趣一起叫好"的组合
 * 效应，这个切面答得了。每人按**主兴趣**（interests[0] = 离它最近的兴趣家）归入唯一街区，
 * 边界毛边人群按真实属性算，不按网格坐标硬切。
 * → { rows: [{ zh, cells: [{ id, zh, judged, glad, share }] × 8 } × 5], cityShare, judged, minSample }
 */
export function sliceHeatmap(presetId, keys, reactions, people) {
  const reactionsOf = PRESETS[presetId].reactions;
  const slots = new Map(INTERESTS.map((interest, index) => [interest.id, index]));
  const slices = INTERESTS.map((interest, index) => ({
    id: interest.id,
    zh: interest.zh,
    row: Math.floor(index / INTEREST_COLUMNS),
    col: index % INTEREST_COLUMNS,
    judged: 0,
    glad: 0,
    share: null,
  }));
  let judged = 0;
  let glad = 0;
  for (const who of people) {
    const byte = reactions[who.id];
    if (!byte) continue;
    judged += 1;
    const slice = slices[slots.get(who.interests[0])];
    slice.judged += 1;
    if (reactionsOf[keys[byte - 1]]?.tone === 1) {
      slice.glad += 1;
      glad += 1;
    }
  }
  for (const slice of slices) slice.share = slice.judged >= MIN_SLICE ? slice.glad / slice.judged : null;
  const rows = INTEREST_ROW_ZH.map((zh, row) => ({
    zh,
    cells: slices.filter((slice) => slice.row === row).sort((a, b) => a.col - b.col),
  }));
  return { rows, cityShare: judged ? glad / judged : 0, judged, minSample: MIN_SLICE };
}

/**
 * When nobody stands out (the text worked on everybody alike, as a text that reached the whole crowd
 * does): the biggest groups, ordered by how much of each took part.
 */
export function biggestSegments(all, what, count = 5) {
  return [...all]
    .sort((a, b) => b.size - a.size)
    .slice(0, count * 3)
    .filter((segment) => segment[what] >= 8)
    .sort((a, b) => b[what] / b.size - a[what] / a.size)
    .slice(0, count);
}

/** The buyers' questions, most asked first. → [{ id, text, share }] */
export function rankedAnswers(followUp) {
  return Object.entries(followUp.totals)
    .map(([id, total]) => ({ id, text: followUp.answers[id], share: followUp.asked ? total / followUp.asked : 0 }))
    .sort((a, b) => b.share - a.share);
}

/**
 * The demand curve from the price ladder. A shopper who would pay "up to $19" buys at $9 and at $19.
 * → [{ price, buyers, revenue }], buyers being people out of the whole crowd reached.
 */
export function demandCurve(followUp, prices) {
  let buyers = 0;
  const curve = [];
  for (let step = prices.length; step >= 1; step--) {
    buyers += followUp.totals[`p${step}`] ?? 0;
    const people = Math.round(buyers); // the totals are sums of probabilities; the page shows whole people, and the revenue is theirs
    curve.unshift({ price: prices[step - 1], buyers: people, revenue: people * prices[step - 1] });
  }
  return curve;
}

// -- what the town said when asked (presets.js:ASKS)

/** From this share of the people asked, a list says that Jev could place nobody: about three times the most the reaction question's own "can't tell" takes. */
export const DRAIN_NOTE_FROM = 0.2;
/** Where a text check reads as yes or no; between them Jev did not decide. */
export const CHECK_YES_FROM = 0.7;
export const CHECK_NO_UNTIL = 0.3;

/**
 * Which answers lead a list. Answer k is about equal to the leader when the gap between their shares
 * is within two standard errors of it, `2·sqrt((p1 + pk − (p1 − pk)²) / n)`, the summed probabilities
 * taken as n draws. One leader alone is 'one', two or three about equal are 'equal', more are 'none':
 * then no answer stands out. rows: [{ id, share }], most given first. → { kind, ids }
 */
export function leaders(rows, n, most = 3) {
  if (!rows.length) return { kind: 'none', ids: [] };
  const top = rows[0].share;
  const equal = rows.filter((row) => top - row.share <= 2 * Math.sqrt(Math.max(0, top + row.share - (top - row.share) ** 2) / n));
  if (equal.length > most) return { kind: 'none', ids: [] };
  return { kind: equal.length === 1 ? 'one' : 'equal', ids: equal.map((row) => row.id) };
}

/**
 * One list of what the town said, as the page shows it, or null when it was not asked or fewer than
 * MIN_ASKED people's worth of real answers came back. Shares are counted among the real answers, the
 * drain left out, and so is the error of `leaders`: n is the real mass, not the headcount. Every real
 * answer offered is a row, zeros included, most given first and ties in the order offered; an id no
 * longer offered is dropped. → { asked, real, drain, rows: [{ id, share }], lead: { kind, ids } }
 */
export function listView(said, list, presetId) {
  const stored = said?.lists?.[list];
  if (!stored) return null;
  const offered = Object.keys(answersFor(questionOfList(list), presetId, list)).filter((id) => id !== CANT_TELL);
  const real = offered.reduce((sum, id) => sum + (stored.totals[id] ?? 0), 0);
  if (real < MIN_ASKED) return null;
  const rows = offered.map((id) => ({ id, share: (stored.totals[id] ?? 0) / real })).sort((a, b) => b.share - a.share);
  return { asked: stored.asked, real, drain: (stored.totals[CANT_TELL] ?? 0) / stored.asked, rows, lead: leaders(rows, real) };
}

/** A text check's probability → 'yes', 'no' or 'unclear'. */
export const readCheck = (probability) => (probability >= CHECK_YES_FROM ? 'yes' : probability <= CHECK_NO_UNTIL ? 'no' : 'unclear');

/** How much of why they scrolled past is about the text and how much about who read it. view: listView of 'scrolled'. → { text, readers } or null */
export function whySplit(view) {
  if (!view) return null;
  const sum = (audience) => view.rows.reduce((total, row) => total + (Boolean(REASONS[row.id].audience) === audience ? row.share : 0), 0);
  return { text: sum(false), readers: sum(true) };
}

/**
 * People to quote under a post: a seeded shuffle of those who reacted, the rarer reactions first.
 * saidOf(id) → the person's answer to a closing question, or null: with it, people who scrolled past
 * join the mix when they gave a real answer, and whoever answered leads their group. Without it the
 * voices are the ones a post had before the town was asked anything. → [{ id, reaction, look }], and `total`
 */
export function voicesOf(postId, presetId, reactions, only = null, saidOf = null) {
  const keys = Object.keys(PRESETS[presetId].reactions);
  const turn = ['spreads', 'sorry', 'glad', 'stopped', 'scrolled']; // the rare reactions speak first: they are the interesting ones
  const keep = only ? 400 : 60; // per reaction; a few thousand objects per card of the feed would be a waste
  const byReaction = new Map();
  for (let id = 0; id < reactions.length; id++) {
    if (!reactions[id]) continue;
    const reaction = keys[reactions[id] - 1];
    const look = lookOf(presetId, reaction);
    const answered = Boolean(saidOf?.(id));
    if (only ? reaction !== only : !turn.includes(look) || (look === 'scrolled' && !answered)) continue;
    let group = byReaction.get(reaction);
    if (!group) byReaction.set(reaction, (group = { look, total: 0, people: [] }));
    group.total += 1;
    group.people.push({ id, reaction, look, order: unit('voice', postId, id) - (answered ? 1 : 0) });
    if (group.people.length > keep * 2) group.people = group.people.sort((a, b) => a.order - b.order).slice(0, keep);
  }
  const groups = [...byReaction.values()].sort((a, b) => turn.indexOf(a.look) - turn.indexOf(b.look));
  for (const group of groups) group.people = group.people.sort((a, b) => a.order - b.order).slice(0, keep);
  // Two of each reaction, then two more of each: no reaction drowns the others because it is ten times as common.
  const found = [];
  for (let round = 0; found.length < groups.reduce((sum, group) => sum + group.people.length, 0); round++) {
    for (const group of groups) found.push(...group.people.slice(round * 2, round * 2 + 2));
  }
  found.total = groups.reduce((sum, group) => sum + group.total, 0);
  return found;
}
