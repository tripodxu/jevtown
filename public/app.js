// 前端编排：发文本 → 分步驱动检查（batch/wave）→ 交给 render.js 渲染。
// 支持"改一版再发"（POST /api/version，新版本重跑波次）与两版并排对比。
import { renderCheck, renderDelta, esc, stat } from './render.js';
import { initThemeSwitcher } from './theme.js';
import { BLOCKED_ZH, AWAY_ZH, AUDIENCE_ZH, presetNoun as PRESET_NOUN_OF, signed, COMPOSE_ZH, WAVE_ZH, FEED_ZH } from './shared/labels.js';
import { PRESETS, DEFAULT_PRICES } from './shared/presets.js';
import { drawGrid, paintDelta } from './grid.js';
import { fmtMs, rollingChart, shareChart, CHART_PADS } from './charts.js';
import { newTally, foldBatch } from './tally.js';
import { renderShareCard } from './sharecard.js';
import { crowd, CROWD } from './shared/personas.js';
import { pickableGroups, filterGroups, pickLabelZh } from './shared/summary.js';
import { decodeBytes } from './shared/bytes.js';

const $ = (id) => document.getElementById(id);
// 当前正在做的检查：哪个 post 的哪个版本。
const current = { post: null, version: 1 };
// 最近一次渲染的报告 payload（分享卡片的数据源）
let lastView = null;

// 通道选择：访客自填的 Jev key（BYOK，localStorage）随请求头发给 Worker；显式选 mock 时
// 只发通道名不发 key——2026-10-07 起站点默认通道是真模型（Zen 免费档），mock 必须显式点选
// 才能回到离线假答案，"清空"回到站点默认。
const byok = () => {
  const provider = localStorage.getItem('jevtown.provider');
  const key = localStorage.getItem('jevtown.key');
  return provider && key && provider !== 'mock' ? { provider, key } : null;
};
const mockChosen = () => localStorage.getItem('jevtown.provider') === 'mock';
let currentAuthor = null; // 当前检查的作者令牌（/api/check 响应带回；刷新页面即失效，需重开检查）
const authHeaders = () => {
  const picks = byok();
  return {
    ...(picks ? { 'x-jev-provider': picks.provider, 'x-jev-key': picks.key } : {}),
    ...(mockChosen() ? { 'x-jev-provider': 'mock' } : {}),
    ...(currentAuthor ? { 'x-jev-author': currentAuthor } : {}),
  };
};

/**
 * BYOK 的 key 只跟"Worker 会拿它去问 Jev 的路由"有关：/api/check、/api/version、/api/batch、
 * /api/wave。纯读路由（/api/post、/api/feed）Worker 一个 Jev 调用也不发，key 没有理由跟过去——
 * 少一条路，key 就少一次出现在别处的机会。
 */
const readJSON = async (url) => {
  const res = await fetch(url, { headers: currentAuthor ? { 'x-jev-author': currentAuthor } : {} });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
};

/**
 * 批次与开局的限流退避：匿名免费档是全站共享的通道，撞 429 是常态而非异常（线上冒烟
 * 实测开局就能撞上）。Worker 侧对 Jev 的重试耗尽后把限流以 503 浮上来，此时批次的认领
 * 已在服务端条件回滚、开局还没写任何行（provider.ask 先于全部 INSERT），原地重试安全。
 * 指数退避（2s→30s，带抖动）最多 6 轮 ≈ 90s，仍失败才报错；网络层失败同样值得原地重试。
 * 可重试的状态码按路由区分：批次 409 是认领冲突（提示语就是 retry），开局/版本 409 是
 * 确定性冲突（上一版还在跑），重试它没有意义。
 */
const BATCH_BACKOFF = [2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
const retrying = async (label, send, { conflictRetryable }) => {
  for (let attempt = 0; ; attempt++) {
    const res = await send().catch(() => null);
    const data = (await res?.json().catch(() => undefined)) ?? {};
    if (res?.ok) return data;
    const code = res?.status ?? 0; // 0 = 网络/浏览器层失败，同样值得原地重试
    const retryable = code === 0 || code === 429 || code >= 500 || (conflictRetryable && code === 409);
    if (!retryable || attempt >= BATCH_BACKOFF.length) {
      throw new Error(data?.error ?? res?.statusText ?? 'network error');
    }
    status(`Jev 通道繁忙或限流，${BATCH_BACKOFF[attempt] / 1000}s 后重试（第 ${attempt + 1}/${BATCH_BACKOFF.length} 轮）`);
    await new Promise((resolve) => setTimeout(resolve, BATCH_BACKOFF[attempt] * (0.8 + Math.random() / 2.5)));
  }
};
const getBatch = (url) => retrying('批次', () => fetch(url, { headers: authHeaders() }), { conflictRetryable: true });
const postRetry = (url, body) =>
  retrying('开局', () => fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body ?? {}),
  }), { conflictRetryable: false });

const postJSON = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
};

const status = (line, ratio) => {
  $('status').hidden = false;
  $('statusLine').textContent = line;
  // 进度条用 scaleX 缩放（合成器友好），宽度恒为 100%。
  $('statusBar').style.transform = `scaleX(${Math.min(1, Math.max(0, ratio ?? 0))})`;
};

// 里程碑播报（开局/收波/完成/错误）：statusLine 逐批更新是视觉行，
// 屏幕阅读器只听这里——逐批播报会把一次检查刷成约 100 条公告。
const announce = (text) => {
  const live = $('statusLive');
  if (live) live.textContent = text;
};

// -- 实时监控（检查进行中的动态地图与调用流水） ----------------------------------

let live = null;

function showLive(presetId, seedDrawn = null) {
  const reactions = PRESETS[presetId].reactions;
  const keys = Object.keys(reactions);
  live = {
    tally: newTally(CROWD),
    keys,
    tone: keys.map((id) => reactions[id]?.tone ?? 0), // 序号 → 1/0/-1
    preset: presetId,
    start: performance.now(),
    requests: 0,
    tokens: 0,
    usd: 0,
    ms: 0,
    tput: [],
    msSeries: [],
    shares: [],
    lastSample: null,
  };
  // 续跑种子：foldBatch 幂等（重折同一个人只改字节不动计数），已判定的人先铺回地图与统计。
  if (seedDrawn?.length) {
    foldBatch(live.tally, seedDrawn, (reaction) => keys.indexOf(reaction), (index) => live.tone[index] ?? 0);
    live.shares.push({ glad: live.tally.glad, sorry: live.tally.sorry, judged: live.tally.judged });
  }
  $('monitorBody').innerHTML = '';
  $('live').hidden = false;
  // 点了「让小镇来读」之后最想看的是地图逐批判定点亮——实时区在首屏折叠线下，
  // 不滚过去的话整段监控都是不可见的（用户盯着发帖框只看得到状态行）。
  $('live').scrollIntoView({ behavior: 'smooth' });
  drawGrid($('liveMap'), live.tally.bytes, presetId);
  updateLiveStats();
  updateCharts();
}

function updateLiveStats() {
  $('liveStats').innerHTML =
    stat(`${live.tally.judged.toLocaleString()} / ${CROWD.toLocaleString()}`, 'Jev 已判定') +
    stat(live.requests, 'Jev 请求') +
    stat(live.tokens.toLocaleString(), '输入 tokens') +
    stat(fmtMs(live.ms), '模型耗时') +
    stat(`$${live.usd.toFixed(4)}`, '累计花费');
}

function updateCharts() {
  // 同 render.js：viewBox 跟着容器走，否则窄屏把 11px 的标注缩到看不清。
  const wide = Math.min(940, Math.max(300, $('chartShare').clientWidth || 900));
  const narrow = Math.min(420, Math.max(260, $('chartTput').clientWidth || 420));
  $('chartTput').innerHTML = rollingChart(live.tput, { width: narrow, color: 'var(--accent)', unit: ' 人/s' });
  $('chartMs').innerHTML = rollingChart(live.msSeries, { width: narrow, color: 'var(--face-spreads)', unit: 'ms', format: (v) => Math.round(v) });
  $('chartShare').innerHTML = shareChart(live.shares, { width: wide });
}

// -- 图表悬停读数：容器常驻（svg 每批重建），委托挂容器上不丢 -------------------
// offsetX 不用 event.offsetX（target 可能是 svg 内部元素），一律按 svg 的 rect 换算；
// 图表只画最近一个窗口（roll 48 / share 60），读数标注的是"第 N 批"的绝对批次号。

const hoverLine = (svg, x) => {
  svg?.querySelector('.hover-line')?.remove();
  if (x == null || !svg) return;
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', x);
  line.setAttribute('x2', x);
  line.setAttribute('y1', '0');
  line.setAttribute('y2', '100%');
  line.setAttribute('class', 'hover-line');
  svg.append(line);
};

const hoverReadout = (host, text) => {
  let el = host.querySelector('.chart-read');
  if (!text) {
    el?.remove();
    return;
  }
  if (!el) {
    el = Object.assign(document.createElement('div'), { className: 'chart-read' });
    host.append(el);
  }
  el.textContent = text;
};

function wireChartHover(host, kind, readoutOf) {
  host.addEventListener('pointermove', (event) => {
    if (!live) return;
    const svg = host.querySelector('svg[data-chart]');
    if (!svg) return;
    const samples = kind === 'share' ? live.shares : kind === 'tput' ? live.tput : live.msSeries;
    const win = kind === 'share' ? 60 : 48;
    const data = samples.slice(-win);
    if (data.length < 2) return;
    const pad = CHART_PADS[kind === 'share' ? 'share' : 'roll']; // 两张折线图共用 roll 的留白
    const rect = svg.getBoundingClientRect();
    const innerW = rect.width - pad.l - pad.r;
    const frac = (event.clientX - rect.left - pad.l) / innerW;
    if (frac < 0 || frac > 1) return; // 出了绘图区就不显示读数
    const i = Math.round(frac * (data.length - 1));
    const batchNo = samples.length - data.length + i + 1;
    hoverLine(svg, (pad.l + (i / (data.length - 1)) * innerW).toFixed(1));
    hoverReadout(host, readoutOf(data[i], batchNo));
  });
  host.addEventListener('pointerleave', () => {
    hoverLine(host.querySelector('svg[data-chart]'), null);
    hoverReadout(host, '');
  });
}

wireChartHover($('chartTput'), 'tput', (v, n) => `第 ${n} 批 · ${Math.round(v)} 人/s`);
wireChartHover($('chartMs'), 'ms', (v, n) => `第 ${n} 批 · ${Math.round(v)}ms`);
wireChartHover($('chartShare'), 'share', (v, n) =>
  v.judged ? `第 ${n} 批 · 乐见 ${Math.round((v.glad / v.judged) * 100)}% · 反感 ${Math.round((v.sorry / v.judged) * 100)}%` : `第 ${n} 批`);

function monitorRow(cells, cls = '') {
  const tr = document.createElement('tr');
  if (cls) tr.className = cls;
  const sec = ((performance.now() - live.start) / 1000).toFixed(1);
  tr.innerHTML = `<td>${sec}s</td>` + cells.map((c) => `<td>${c}</td>`).join('');
  const body = $('monitorBody');
  body.prepend(tr);
  while (body.children.length > 150) body.lastChild.remove();
}

function paintBatch(batch) {
  // 增量：只走本批这 100 人，不再每批把全镇一万格重扫两遍。
  const { tally, keys, tone } = live;
  foldBatch(tally, batch.drawn ?? [], (reaction) => keys.indexOf(reaction), (index) => tone[index] ?? 0);
  paintDelta($('liveMap'), tally.bytes, live.preset);
  live.requests += 1;
  live.tokens += batch.tokens ?? 0;
  live.usd += batch.usd ?? 0;
  live.ms += batch.ms ?? 0;

  // 心电图采样：吞吐 = 本批判定数 / 距上次采样的墙钟；耗时 = 本批模型 ms
  const now = performance.now();
  const wall = live.lastSample ? (now - live.lastSample.t) / 1000 : 0;
  const judged = tally.judged;
  live.tput.push(wall > 0.05 ? (judged - live.lastSample.judged) / wall : 0);
  live.msSeries.push(batch.ms ?? 0);
  live.shares.push({ glad: tally.glad, sorry: tally.sorry, judged });
  live.lastSample = { t: now, judged };

  updateLiveStats();
  updateCharts();
  monitorRow([`第 ${batch.wave + 1} 波`, `${batch.answered} / ${batch.total}`, `${batch.ms ?? 0}ms`, `${(batch.tokens ?? 0).toLocaleString()}`, `$${live.usd.toFixed(4)}`]);
}

// 节奏化：让点亮过程可见。第 1 波是揭示（慢一点），之后是量（快一点）——全城广播
// 130 批全按 180ms 会白等二十多秒，首波之后 90ms 足够看清逐批推进。
const pace = () => new Promise((resolve) => setTimeout(resolve, live && live.tally.judged >= 600 ? 90 : 180));

// -- 「这段话是给谁的」（R35）：一句自述 + 从清单里挑几组 --------------------------

/**
 * 挑的是段 id（`attribute:value`），不是作者的原话。实测 12 句中文自述只有 6 句能被朴素
 * 匹配撞上（probe-mention.js），撞不上的正是「年轻人」「做创意的人」这类最普通的说法——让
 * Jev 去猜（rho 0.264，probe-audience.js）更糟。所以这里不猜：作者从 115 项清单里点，
 * 点中的就是报告里对账的那一项。零花费、零延迟、不会错。
 */
const pickedGroups = new Set();
/** 清单按镇子人群算出，进程内只算一次（pickableGroups 内部按 people 身份还有一层 WeakMap）。 */
const pickable = () => pickableGroups(crowd('zh'));

/** 挑中的组有没有变，视觉上只表现为标签多了一个；读屏用户听不到，所以另开一句播报。
 *  先清空再写：live region 只在内容变化时通知，同一个字符串连写两次不会播第二遍。 */
const sayAudienceLive = (word) => {
  const box = $('audienceLive');
  box.textContent = '';
  if (word) box.textContent = word;
};

/**
 * 渲染已选标签并报一次总数。`word` 是这一句额外要说的话（挑进来/摘掉的是哪一组）；
 * 每次渲染都必须带一句——这是唯一一次「用户做了个动作」的机会，下一次渲染可能由别处触发。
 * 没带就算报了总数，听的人还是不知道动了哪一组。
 */
function renderAudienceTags(word = '') {
  $('audienceTags').innerHTML = [...pickedGroups]
    .map((id) => `<button type="button" class="aud-tag" data-pick="${esc(id)}">${esc(labelOfGroup(id))}</button>`)
    .join('');
  const n = pickedGroups.size;
  const total = n ? AUDIENCE_ZH.pickedCount.replace('%1', String(n)) : '';
  $('audienceCount').textContent = total;
  sayAudienceLive(word || total);
}

/** 清单里某一组的中文标签，找不到就退回段 id（陌生 id 不会走到这里，但别为了它崩掉表单）。 */
const labelOfGroup = (id) => {
  const one = pickable().find((g) => g.id === id);
  return pickLabelZh(one ?? { attribute: '', zh: id });
};

/** 作者填的受众：一句自述 + 挑中的段 id。两样都空时返回 null——不填就不占存档一列。 */
const audienceInput = () => {
  const said = $('audienceSaid').value.trim();
  return said || pickedGroups.size ? { said, picked: [...pickedGroups] } : null;
};

/** 过滤框回车/点候选：把那一项收进已选。词表里没有就是没有，UI 直说，不去猜作者想说什么。 */
function pickGroup(id) {
  if (pickedGroups.has(id)) return;
  const label = labelOfGroup(id);
  pickedGroups.add(id);
  $('audienceFilter').value = '';
  // 播报带组名，不只是「已选 N 组」——听的人要知道多了谁。
  renderAudienceTags(`${label}${AUDIENCE_ZH.picked}`);
  renderAudienceList();
}

/**
 * 候选按钮在 input 的下面，但作者的眼睛在 input 上。按 ↑/↓ 只换候选而不碰焦点，
 * 键盘用户于是不知道列表变了——所以把焦点真的移到候选上：Space/Enter 在 button 上
 * 天然会触发 click，Tab 顺序也顺（input → 候选 → 已选标签）。
 */
function moveAudienceFocus(step) {
  const box = $('audienceList');
  const rows = [...box.querySelectorAll('button[data-pick]')];
  if (!rows.length) return;
  const now = rows.indexOf(document.activeElement);
  const next = now < 0 ? (step > 0 ? 0 : rows.length - 1) : (now + step + rows.length) % rows.length;
  rows[next].focus();
}

function renderAudienceList() {
  const box = $('audienceList');
  const query = $('audienceFilter').value.trim();
  if (!query) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const { list, total } = filterGroups(pickable(), query);
  // 已挑过的候选用 aria-pressed 而不是 disabled：disabled 的按钮读屏软件直接跳过，
  // 于是读屏用户根本听不到「这项已经算上了」。aria-pressed 让它仍在列表里被读到，
  // 只是被标成按下状态；点它也不该有反应（pickGroup 见到已有的 id 就返回）。
  const rows = list.map((one) => `<button type="button" data-pick="${esc(one.id)}" aria-pressed="${pickedGroups.has(one.id)}">${esc(pickLabelZh(one))} <span class="aud-n">${one.size}</span></button>`);
  if (!rows.length) rows.push(`<span class="hint">${esc(AUDIENCE_ZH.notFound)}</span>`);
  if (total > list.length) rows.push(`<span class="hint">${esc(AUDIENCE_ZH.more.replace('%1', String(total - list.length)))}</span>`);
  box.innerHTML = rows.join('');
  box.hidden = false;
}

$('audienceFilter').addEventListener('input', renderAudienceList);
$('audienceFilter').addEventListener('keydown', (event) => {
  // ↑/↓ 在候选之间走位，Enter 取第一个：候选按钮是普通 button，焦点移过去之后
  // Space/Enter 天然触发 click，不用在这里另写一套激活逻辑。
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    moveAudienceFocus(event.key === 'ArrowDown' ? 1 : -1);
    return;
  }
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const first = $('audienceList').querySelector('button[data-pick]');
  if (first) pickGroup(first.dataset.pick);
});
$('audienceList').addEventListener('click', (event) => {
  const id = event.target.closest('button[data-pick]')?.dataset.pick;
  if (id) pickGroup(id);
});
$('audienceTags').addEventListener('click', (event) => {
  const id = event.target.closest('button[data-pick]')?.dataset.pick;
  if (!id) return;
  // 摘掉的那一组要报出来：「已选 2 组」变「已选 1 组」，光听数字不知道少了谁。
  const said = `${labelOfGroup(id)}${AUDIENCE_ZH.dropped}`;
  pickedGroups.delete(id);
  renderAudienceTags(said);
  renderAudienceList();
});

// -- 发帖框的可玩性：试一句样例、按预设换占位句、字数计、Ctrl+Enter、定价阶梯 ----------------

/** 每个预设轮换到第几条样例（chip 再点一次换下一条；起点固定 ⇒ 同起点同序列）。 */
const sampleAt = { post: 0, listing: 0, product: 0, headline: 0 };

function buildSampleChips() {
  // chip 文案来自 labels.js 的 COMPOSE_ZH（中文单源），不在这里硬编码。
  $('sampleChips').innerHTML = Object.keys(COMPOSE_ZH.samples)
    .map((presetId) => `<button type="button" class="sample-chip" data-sample="${esc(presetId)}" title="${esc(COMPOSE_ZH.tryAgain)}">${esc(COMPOSE_ZH.chips[presetId])}</button>`)
    .join('');
}

$('sampleChips').addEventListener('click', (event) => {
  const chip = event.target.closest('button[data-sample]');
  if (!chip) return;
  const presetId = chip.dataset.sample;
  const list = COMPOSE_ZH.samples[presetId] ?? [];
  if (!list.length) return;
  const text = list[sampleAt[presetId] % list.length];
  sampleAt[presetId] += 1;
  $('preset').value = presetId;
  syncComposeForPreset();
  $('text').value = text;
  updateTextCount();
  // 焦点与光标交给输入框尾部：样例只是起点，改两个字才算玩起来。
  $('text').focus();
  $('text').setSelectionRange(text.length, text.length);
});

/** 占位句随预设走 + 商品的定价阶梯行只在商品预设出现。 */
function syncComposeForPreset() {
  const presetId = $('preset').value;
  const placeholder = COMPOSE_ZH.placeholders[presetId];
  if (placeholder) $('text').placeholder = placeholder;
  $('pricesRow').hidden = presetId !== 'product';
}

const updateTextCount = () => {
  const max = $('text').maxLength;
  $('textCount').textContent = COMPOSE_ZH.textCount.replace('%1', String($('text').value.length)).replace('%2', String(max));
};

$('text').addEventListener('input', updateTextCount);
$('preset').addEventListener('change', syncComposeForPreset);

// 写完顺手一发：Ctrl/Cmd+Enter 直接提交（textarea 里 Enter 仍该换行）。
$('text').addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    $('form').requestSubmit();
  }
});

/**
 * 商品的定价阶梯：**留空 = 不表态**（开局走默认档 DEFAULT_PRICES，改版沿用上一版的阶梯——
 * 阶梯是帖子的属性，不该因为改版静默换回默认）；填了就按用户的算。
 * 读不出来返回 null——校验失败绝不能悄悄落回默认档：用户看着报告以为是自己的价格。
 */
const parsePrices = () => {
  if ($('preset').value !== 'product') return undefined;
  const raw = $('pricesInput').value.trim();
  if (!raw) return undefined;
  const nums = raw.split(/[,，、;；\s]+/).filter(Boolean).map(Number);
  return nums.length >= 2 && nums.every((n) => Number.isFinite(n) && n > 0) ? nums : null;
};

// -- 改版模式指示与「发一条新帖」--------------------------------------------------
// 做完一次检查后 current.post 一直挂着，下一次提交静默变成同一帖的新版本——玩家不知道，
// 也找不到发全新帖的入口。这里把状态说穿（引用上一条的摘要），并给一个出口。

function refreshComposeMode() {
  const asVersion = Boolean(current.post && currentAuthor);
  $('nextPostRow').hidden = !asVersion;
  if (asVersion) {
    $('nextPostNote').textContent = COMPOSE_ZH.nextVersionNote.replace('%1', current.excerpt ?? current.post);
  }
}

$('newPostBtn').addEventListener('click', () => {
  current.post = null;
  currentAuthor = null;
  current.version = 1;
  // 受众是跟着这次检查走的语境，新帖不该继承上一条的挑组与自述。
  pickedGroups.clear();
  renderAudienceTags();
  $('audienceSaid').value = '';
  $('text').value = '';
  updateTextCount();
  refreshComposeMode();
  $('text').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// -- 提交与分步驱动 -------------------------------------------------------------

$('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = $('text').value.trim();
  const preset = $('preset').value;
  const audience = audienceInput();
  if (!text) return;
  // 定价阶梯先校验后发：读不对就停在表单，绝不带着用户以为的价格跑默认档。
  const prices = parsePrices();
  if (prices === null) {
    status(COMPOSE_ZH.pricesBad, 0);
    announce(COMPOSE_ZH.pricesBad);
    return;
  }
  $('go').disabled = true;
  const broadcast = $('broadcast').checked;
  // 只有本机持有这一帖的作者令牌才走改版；看过别人的帖子后 current.post 也挂着，
  // 那种时候提交该是全新一帖（走 /api/version 只会 403「不是你的帖」）。
  const asVersion = Boolean(current.post && currentAuthor);
  try {
    status(asVersion ? '再发一版：Jev 重新掂量……' : '开局：Jev 正在掂量这段文字是写给谁的……', 0.02);
    const opening = asVersion
      ? await postRetry('/api/version', { post: current.post, text, audience, broadcast, prices })
      : await postRetry('/api/check', { preset, text, prices: preset === 'product' ? (prices ?? DEFAULT_PRICES) : undefined, audience, broadcast });

    if (opening.author) {
      currentAuthor = opening.author;
      localStorage.setItem(`jevtown.author.${opening.post}`, opening.author);
    }
    siteProvider = opening.provider ?? siteProvider;
    refreshModeChip();
    if (opening.state === 'blocked') {
      const reason = `Jev 拒绝发布：${opening.blocked.map((id) => BLOCKED_ZH[id] ?? id).join('、')}`;
      status(reason, 1);
      announce(reason);
      return;
    }
    current.post = opening.post;
    current.version = opening.version;
    if (opening.unlisted?.length) {
      status(`注意：${opening.unlisted.map((id) => BLOCKED_ZH[id] ?? id).join('、')}（仍会照常检查，但不进公共流）`, 0.04);
    }
    await driveCheck(preset, null, `检查开始，第 1 波 ${opening.wave?.total ?? ''} 人`);
    await finishCheck();
  } catch (error) {
    // 免费通道走 Worker 共享出口，被上游按 IP 限流是常态（2026-10-07 线上实测：本机畅通、
    // Worker 出口持续 429）——退避 6 轮仍失败时给访客一条真正能走的路，而不是一句裸报错。
    const limited = /rate limit|限流/i.test(error.message);
    const message = limited
      ? `${error.message}——免费通道此刻繁忙。在 Key… 里填自己的 key（如 OpenCode Zen 免费领取）可立即走专用额度。`
      : error.message;
    $('statusLine').innerHTML = `<span class="error">${esc(message)}</span>`;
    $('statusBar').style.transform = 'scaleX(0)';
    announce(`检查失败：${message}`);
  } finally {
    $('go').disabled = false;
  }
});

/**
 * 波次驱动：一批批问 Jev（每批 100 人）、收波定去留，直到检查结束；live 监控全程更新。
 * 新开检查与续跑（页面刷新后从报告回看一个 running 的版本）共用这一段。
 * `seedDrawn`：续跑时已判定过的人（[{ id, reaction }]，从报告的 looks 字节还原），
 * 先折进快照把地图铺到当前进度——否则续跑地图从头黑起，前几波的成果全看不见。
 */
async function driveCheck(presetId, seedDrawn = null, openingSay = '') {
  showLive(presetId, seedDrawn);
  if (openingSay) announce(openingSay);
  let done = false;
  while (!done) {
    for (;;) {
      const batch = await getBatch(`/api/batch?post=${current.post}&v=${current.version}`);
      if (batch.done) break;
      paintBatch(batch);
      status(`第 ${batch.wave + 1} 波：Jev 已判定 ${batch.answered} / ${batch.total} 人`, batch.answered / Math.max(1, batch.total));
      await pace();
    }
    const wave = await postJSON(`/api/wave?post=${current.post}&v=${current.version}`);
    if (wave.done) {
      done = true;
      monitorRow(['收尾', `到达 ${wave.reach}`, '', '', ''], 'wave-row');
      // 结束原因分两说：gate = 情绪没过线被拦下（告诉作者差在哪、还有广播这条路）；
      // capacity = 波次跑满或全城都看到了，正常谢幕不用解释。
      const gateLine = wave.endedBy === 'gate'
        ? WAVE_ZH.stoppedSay.replace('%1', String(wave.wave.index + 1))
        : '收尾完成。';
      status(gateLine, 0.98);
      announce(gateLine);
    } else {
      // 广播模式下情绪不过线也继续推：状态行要把「为什么还在传」说穿，不然读着像矛盾。
      const push = wave.broadcast && !wave.wave.travels ? `，${WAVE_ZH.broadcastGo}（不看门槛）` : '';
      const line = `第 ${wave.wave.index + 1} 波完成，情绪 ${signed(wave.wave.mood, 2)}${push}，文字传给第 ${wave.next.index + 1} 波（${wave.next.total} 人）`;
      monitorRow([`第 ${wave.wave.index + 1} 波收束`, `情绪 ${signed(wave.wave.mood, 2)}`, `${wave.wave.size} 人`, '', ''], 'wave-row');
      status(line, 0.5);
      announce(line);
    }
  }
}

/** 检查跑完的收尾：关监控、出报告、版本 ≥2 时自动载入对比（作者刚等完一整轮，他要的下一眼就是对比）、刷新 feed。 */
async function finishCheck() {
  const view = await readJSON(`/api/post/${current.post}?v=${current.version}`);
  $('live').hidden = true;
  showResult(view);
  status('完成。', 1);
  announce('检查完成，报告已生成');
  if (compareLoader) await compareLoader();
  await loadFeed();
}

// 第 1 版对比的装载器：showResult 每次重建（renderCheck 清容器，闭包跟容器走），
// finishCheck 在作者自己跑完版本 ≥2 时直接调用它——他要的下一眼就是对比，不用再点一次按钮。
// 深链/他人打开不自动调：那是一份读动作，多拉一整版报告是翻倍负载。
let compareLoader = null;

function showResult(view) {
  lastView = view;
  current.excerpt = view.post.text.slice(0, 24) + (view.post.text.length > 24 ? '…' : '');
  refreshComposeMode();
  renderCheck($('result'), view);
  $('resultActions').hidden = false;
  // 焦点随视线走：键盘/屏幕阅读器从报告标题继续，而不是留在触发处
  $('result').querySelector('h2')?.focus({ preventScroll: true });
  // 版本 ≥2 时提供对比入口：对比卡懒加载（点按钮才拉所选版本的全量视图，不自动翻倍负载）。
  // 对比对象：只有两版时就是第 1 版；三版起给「第 1 版 / 上一版」两个选择——
  // 改到第三版的人通常想看的是这版相对上一版改了什么，而不是相对初版。
  const aside = $('compare');
  if (current.version > 1) {
    const slot = aside.querySelector('.compare-slot') ?? Object.assign(document.createElement('div'), { className: 'compare-slot' });
    const prev = current.version - 1;
    const targets = prev === 1 ? [1] : [1, prev];
    slot.innerHTML = targets.map((n) => `<button class="ghost" type="button" data-compare="${n}">对比第 ${n} 版</button>`).join('') +
      `<span class="hint">完整重放所选版本（地图、图谱、报告），点击才加载。</span>`;
    aside.append(slot);
    aside.hidden = false;
    const loadInto = async (n) => {
      slot.textContent = '载入中……';
      try {
        const other = await readJSON(`/api/post/${current.post}?v=${n}`);
        // renderCheck 会清空容器，所以所选版本渲染进子节点，差分卡才不会被一起清掉
        const diff = document.createElement('div');
        const card = document.createElement('div');
        slot.replaceChildren(diff, card);
        renderCheck(card, other);
        renderDelta(diff, view, other);
        // 焦点随内容走：载入完成后落在差分卡标题，键盘/SR 用户不被留在已消失的按钮处
        const deltaTitle = diff.querySelector('h3');
        if (deltaTitle) {
          deltaTitle.tabIndex = -1;
          deltaTitle.focus({ preventScroll: true });
        }
      } catch (error) {
        slot.innerHTML = `<span class="error">${esc(error.message)}</span>`;
      }
    };
    // 自动对比（finishCheck 调用）选上一版：v2 时即第 1 版，与旧行为一致。
    compareLoader = async () => loadInto(prev);
    slot.addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-compare]');
      if (btn) loadInto(Number(btn.dataset.compare));
    });
  } else {
    compareLoader = null;
    aside.hidden = true;
  }
  $('result').scrollIntoView({ behavior: 'smooth' });
}

// -- 哪一句在撑（R32）-----------------------------------------------------------

// 委托在 #result 上而不是绑在按钮上：renderCheck 每次都把 innerHTML 换掉，
// 重绑容易漏（报告刷新、对照卡重渲染都会丢），委托跟着容器走就不会。
$('result').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-away]');
  if (!button || !current.post) return;
  button.disabled = true;
  const hint = $('result').querySelector('[data-away-hint]');
  // 按钮旁边没有 statusLine（那行属于检查流程），进度写在这一节自己的提示位上。
  if (hint) hint.textContent = AWAY_ZH.running;
  announce(AWAY_ZH.running);
  try {
    const res = await postJSON(`/api/away?post=${encodeURIComponent(current.post)}&v=${current.version}`);
    const view = await readJSON(`/api/post/${current.post}?v=${current.version}`);
    showResult(view);
    announce(`已算出：${res.away.sentences.filter((s) => s.readable).length} 句读得出承重`);
  } catch (error) {
    button.disabled = false;
    const text = AWAY_ZH.failed.replace('%1', error.message);
    if (hint) {
      hint.innerHTML = `<span class="error">${esc(text)}</span>`;
    } else {
      $('statusLine').innerHTML = `<span class="error">${esc(text)}</span>`;
    }
    announce(`算逐句承重失败：${error.message}`);
  }
});

// -- 改一版再发 ------------------------------------------------------------------

// 分享卡片：报告读数 + 地图快照合成 PNG 下载（纯浏览器合成，数据是 lastView 的既有字段）
$('saveCard').addEventListener('click', async () => {
  if (!lastView) return;
  const mapCanvas = document.querySelector('#result canvas.grid');
  const card = renderShareCard(lastView, mapCanvas);
  const blob = await new Promise((resolve) => card.toBlob(resolve, 'image/png'));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: `jevtown-${lastView.post.id}.png` });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});

$('revise').addEventListener('click', async () => {
  if (!current.post) return;
  const view = await readJSON(`/api/post/${current.post}?v=${current.version}`);
  $('text').value = view.post.text;
  $('preset').value = view.post.preset;
  syncComposeForPreset();
  updateTextCount();
  $('text').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// -- 最近检查列表 ----------------------------------------------------------------

async function loadFeed() {
  try {
    const data = await readJSON('/api/feed');
    $('feed').innerHTML = data.posts.length
      ? data.posts
          .map((post) => {
            // 读数摘要（Worker 侧从 reactions 聚好带回）：feed 不再是光秃秃的摘要行——
            // 「这条被人发了，小镇这么回应」一眼可见，比「已完成」有吸引力。
            const state = post.state === 'blocked' ? '已拒绝' : post.state === 'done' ? '已完成' : '进行中';
            const reading = post.reading
              ? FEED_ZH.reading
                  .replace('%1', post.reading.reach.toLocaleString())
                  .replace('%2', String(Math.round((post.reading.glad / post.reading.reach) * 100)))
                  .replace('%3', String(Math.round((post.reading.sorry / post.reading.reach) * 100)))
              : '';
            return `<li><a href="/?post=${encodeURIComponent(post.id)}" data-post="${esc(post.id)}">${esc(post.excerpt)}</a>` +
              `<span class="meta">${esc(PRESET_NOUN_OF(post.preset))} · ${state}${reading ? ` · ${esc(reading)}` : ''}</span></li>`;
          })
          .join('')
      : '<li style="color:var(--muted)">还没有检查。发一段文字试试。</li>';
  } catch {
    $('feed').innerHTML = '<li class="error">读取失败：worker 没在跑？先 npm run dev。</li>';
  }
}

// feed 点击委托：本页打开报告并 pushState（回退键可回首页）；修饰键点击仍走浏览器默认（新标签）
$('feed').addEventListener('click', (event) => {
  const link = event.target.closest('a[data-post]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  history.pushState(null, '', `/?post=${encodeURIComponent(link.dataset.post)}`);
  openPost(link.dataset.post);
});

// 回退/前进：URL 带 ?post= 就开对应报告（?v= 指定版本），没有就收起报告回首页
window.addEventListener('popstate', () => {
  const params = new URLSearchParams(location.search);
  const id = params.get('post');
  if (id) {
    openPost(id, Number(params.get('v')) || null);
    return;
  }
  $('result').replaceChildren();
  $('result').hidden = true;
  $('resume').hidden = true;
  $('resultActions').hidden = true;
  $('compare').hidden = true;
  current.post = null;
  refreshComposeMode();
});

async function openPost(id, versionHint = null) {
  status('正在打开报告……', 0.15);
  announce('正在打开报告');
  // 骨架过渡：匹配报告的布局形状（标题行 + 两行文字 + 一大块），比空白和转圈都诚实
  const result = $('result');
  result.hidden = false;
  result.innerHTML = '<div class="skeleton" aria-hidden="true"><div class="sk sk-line" style="width:34%"></div><div class="sk sk-line" style="width:88%"></div><div class="sk sk-line" style="width:72%"></div><div class="sk sk-block"></div><div class="sk sk-line" style="width:60%"></div></div>';
  try {
    const view = await readJSON(`/api/post/${id}${versionHint ? `?v=${versionHint}` : ''}`);
    current.post = id;
    currentAuthor = localStorage.getItem(`jevtown.author.${id}`);
    current.version = versionHint ?? view.versions?.at(-1)?.number ?? 1;
    // 没跑完的检查 + 本机持有作者令牌：刷新/离开不会回滚服务端的进度，但批次要有人驱动——
    // 给出续跑入口。没有令牌（别人的进行中检查）不显示：驱动不了，也不该驱动。
    $('resume').hidden = !(view.post.state === 'running' && currentAuthor);
    showResult(view);
  } catch (error) {
    result.hidden = true; // 骨架不留在原地装样子
    $('resume').hidden = true;
    status(error.message, 0);
    announce(`打开失败：${error.message}`);
  }
}
// 深链入口挂在 window 上：浏览器调试与 E2E 直达某帖用（生产代码不走它，feed 链接走下方委托）。
window.openPost = openPost;

// 续跑：把中断的检查从当前波次接着驱动完。种子来自报告的 looks 字节（已判定的人），
// 地图从当前进度亮起——不是从头黑屏把前几波重演一遍。失败时横幅回来，可再试。
$('resumeBtn').addEventListener('click', async () => {
  const btn = $('resumeBtn');
  btn.disabled = true;
  try {
    const view = await readJSON(`/api/post/${current.post}?v=${current.version}`);
    const keys = Object.keys(PRESETS[view.post.preset].reactions);
    const bytes = decodeBytes(view.looks ?? '');
    const seed = [];
    for (let pid = 0; pid < bytes.length; pid++) if (bytes[pid]) seed.push({ id: pid, reaction: keys[bytes[pid] - 1] });
    $('resume').hidden = true;
    status('续跑：从中断处接着问 Jev……', 0.1);
    await driveCheck(view.post.preset, seed, '继续这次检查');
    await finishCheck();
  } catch (error) {
    btn.disabled = false;
    $('resume').hidden = false;
    $('statusLine').innerHTML = `<span class="error">${esc(error.message)}</span>`;
    announce(`续跑失败：${error.message}`);
  }
});

// 人格声音"看全部"：展开折叠的第 25 张起，按钮自己消失；焦点交给第一张新展开的卡，
// 键盘用户不被扔回页面顶部。
document.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-expand-voices]');
  if (!btn) return;
  const grid = btn.parentElement.querySelector('.voices');
  grid?.classList.remove('collapsed');
  btn.remove();
  const first = grid?.querySelector('.voice:nth-child(25)');
  if (first) {
    first.tabIndex = -1;
    first.focus();
  }
});

// 快报复制（R27）：纯文本进剪贴板，按钮给两秒反馈；失败也说话，不装成功
document.addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-copy-brief]');
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.dataset.copyBrief);
    btn.textContent = '已复制';
  } catch {
    btn.textContent = '复制失败';
  }
  setTimeout(() => { btn.textContent = '复制'; }, 2000);
});

// -- 通道设置（BYOK） -----------------------------------------------------------

const modeChip = $('modeChip');
let siteProvider = null; // 开局响应带回的默认通道名（mock / opencode…）：访客不填 key 也该知道这轮是假答案还是站点免费档
const refreshModeChip = () => {
  const picks = byok();
  modeChip.textContent = picks
    ? `BYOK · ${picks.provider}`
    : mockChosen() ? 'mock（离线）'
    : siteProvider ? `默认 · ${siteProvider}` : '默认通道';
};

$('settingsBtn').addEventListener('click', () => {
  // 没存过通道就选「站点默认」（第一项，value=''）：打开就落在 mock 上是个陷阱——
  // 什么都不改点一下「保存」，就把自己静默切到了离线假答案。
  $('providerSel').value = localStorage.getItem('jevtown.provider') ?? '';
  $('keyInput').value = localStorage.getItem('jevtown.key') ?? '';
  $('settings').showModal();
});

$('saveKey').addEventListener('click', () => {
  const provider = $('providerSel').value;
  const key = $('keyInput').value.trim();
  if (!provider) {
    // 「站点默认」= 不发任何通道头：清掉旧选择，回到免费通道。
    localStorage.removeItem('jevtown.provider');
    localStorage.removeItem('jevtown.key');
  } else if (provider === 'mock') {
    // 显式 mock：记住这个选择，请求头带 x-jev-provider: mock 让 Worker 回离线假答案
    localStorage.setItem('jevtown.provider', 'mock');
    localStorage.removeItem('jevtown.key');
  } else if (!key) {
    localStorage.removeItem('jevtown.provider');
    localStorage.removeItem('jevtown.key');
  } else {
    localStorage.setItem('jevtown.provider', provider);
    localStorage.setItem('jevtown.key', key);
  }
  refreshModeChip();
  $('settings').close();
  status(`通道已切换：${modeChip.textContent}`, 0);
});

$('clearKey').addEventListener('click', () => {
  localStorage.removeItem('jevtown.provider');
  localStorage.removeItem('jevtown.key');
  $('keyInput').value = '';
  refreshModeChip();
});

refreshModeChip();
buildSampleChips();
syncComposeForPreset();
updateTextCount();
refreshComposeMode();

initThemeSwitcher();
loadFeed();

// 深链：带着 ?post=<id>（可选 &v=<版本号>）打开页面时直接呈现那份报告
const params = new URLSearchParams(location.search);
const wanted = params.get('post');
if (wanted) openPost(wanted, Number(params.get('v')) || null);
