// 前端编排：发文本 → 分步驱动检查（batch/wave）→ 交给 render.js 渲染。
// 支持"改一版再发"（POST /api/version，新版本重跑波次）与两版并排对比。
import { renderCheck, renderDelta, esc, stat } from './render.js';
import { initThemeSwitcher } from './theme.js';
import { BLOCKED_ZH, AWAY_ZH, AUDIENCE_ZH, presetNoun as PRESET_NOUN_OF, signed } from './shared/labels.js';
import { PRESETS } from './shared/presets.js';
import { drawGrid, paintDelta } from './grid.js';
import { fmtMs, rollingChart, shareChart, CHART_PADS } from './charts.js';
import { newTally, foldBatch } from './tally.js';
import { renderShareCard } from './sharecard.js';
import { crowd, CROWD } from './shared/personas.js';
import { pickableGroups, filterGroups, pickLabelZh } from './shared/summary.js';

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

const getJSON = async (url) => {
  const res = await fetch(url, { headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
};

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

function showLive(presetId) {
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
  $('monitorBody').innerHTML = '';
  $('live').hidden = false;
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

const pace = () => new Promise((resolve) => setTimeout(resolve, 180)); // 节奏化：让点亮过程可见

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

// -- 提交与分步驱动 -------------------------------------------------------------

$('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = $('text').value.trim();
  const preset = $('preset').value;
  const audience = audienceInput();
  if (!text) return;
  $('go').disabled = true;
  try {
    status(current.post ? '再发一版：Jev 重新掂量……' : '开局：Jev 正在掂量这段文字是写给谁的……', 0.02);
    const opening = current.post
      ? await postJSON('/api/version', { post: current.post, text, audience })
      : await postJSON('/api/check', { preset, text, prices: preset === 'product' ? [9, 19, 39, 79] : undefined, audience });

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
    showLive(preset);
    announce(`检查开始，第 1 波 ${opening.wave?.total ?? ''} 人`);
    if (opening.unlisted?.length) {
      status(`注意：${opening.unlisted.map((id) => BLOCKED_ZH[id] ?? id).join('、')}（仍会照常检查，但不进公共流）`, 0.04);
    }

    // 波次循环：一批批问 Jev（每批 100 人），收波定去留，直到检查结束。
    let done = false;
    while (!done) {
      for (;;) {
        const batch = await getJSON(`/api/batch?post=${current.post}&v=${current.version}`);
        if (batch.done) break;
        paintBatch(batch);
        status(`第 ${batch.wave + 1} 波：Jev 已判定 ${batch.answered} / ${batch.total} 人`, batch.answered / Math.max(1, batch.total));
        await pace();
      }
      const wave = await postJSON(`/api/wave?post=${current.post}&v=${current.version}`);
      if (wave.done) {
        done = true;
        monitorRow(['收尾', `到达 ${wave.reach}`, '', '', ''], 'wave-row');
        status('收尾完成。', 0.98);
        announce(`检查收尾，共到达 ${wave.reach} 人`);
      } else {
        const line = `第 ${wave.wave.index + 1} 波完成，情绪 ${signed(wave.wave.mood, 2)}，文字继续传给第 ${wave.next.index + 1} 波（${wave.next.total} 人）`;
        monitorRow([`第 ${wave.wave.index + 1} 波收束`, `情绪 ${signed(wave.wave.mood, 2)}`, `${wave.wave.size} 人`, '', ''], 'wave-row');
        status(line, 0.5);
        announce(line);
      }
    }

    const view = await readJSON(`/api/post/${current.post}?v=${current.version}`);
    $('live').hidden = true;
    showResult(view);
    status('完成。', 1);
    announce('检查完成，报告已生成');
    await loadFeed();
  } catch (error) {
    $('statusLine').innerHTML = `<span class="error">${esc(error.message)}</span>`;
    $('statusBar').style.transform = 'scaleX(0)';
    announce(`检查失败：${error.message}`);
  } finally {
    $('go').disabled = false;
  }
});

function showResult(view) {
  lastView = view;
  renderCheck($('result'), view);
  $('resultActions').hidden = false;
  // 焦点随视线走：键盘/屏幕阅读器从报告标题继续，而不是留在触发处
  $('result').querySelector('h2')?.focus({ preventScroll: true });
  // 版本 ≥2 时提供对比入口：对比卡懒加载（点按钮才拉第 1 版全量视图，不自动翻倍负载）。
  const aside = $('compare');
  if (current.version > 1) {
    const slot = aside.querySelector('.compare-slot') ?? Object.assign(document.createElement('div'), { className: 'compare-slot' });
    slot.innerHTML = '<button class="ghost" type="button" id="loadCompare">载入第 1 版对比</button><span class="hint">完整重放第 1 版（地图、图谱、报告），点击才加载。</span>';
    aside.append(slot);
    aside.hidden = false;
    slot.querySelector('#loadCompare').addEventListener('click', async () => {
      slot.textContent = '载入中……';
      try {
        const v1 = await readJSON(`/api/post/${current.post}?v=1`);
        // renderCheck 会清空容器，所以第 1 版渲染进子节点，差分卡才不会被一起清掉
        const diff = document.createElement('div');
        const v1card = document.createElement('div');
        slot.replaceChildren(diff, v1card);
        renderCheck(v1card, v1);
        renderDelta(diff, view, v1);
        // 焦点随内容走：载入完成后落在差分卡标题，键盘/SR 用户不被留在已消失的按钮处
        const deltaTitle = diff.querySelector('h3');
        if (deltaTitle) {
          deltaTitle.tabIndex = -1;
          deltaTitle.focus({ preventScroll: true });
        }
      } catch (error) {
        slot.innerHTML = `<span class="error">${esc(error.message)}</span>`;
      }
    });
  } else {
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
  $('text').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// -- 最近检查列表 ----------------------------------------------------------------

async function loadFeed() {
  try {
    const data = await readJSON('/api/feed');
    $('feed').innerHTML = data.posts.length
      ? data.posts
          .map(
            (post) =>
              // 真 URL：报告可分享/刷新/中键新开；点击在本页拦截打开（下方委托）
              `<li><a href="/?post=${encodeURIComponent(post.id)}" data-post="${esc(post.id)}">${esc(post.excerpt)}</a>` +
              `<span class="meta">${esc(PRESET_NOUN_OF(post.preset))} · ${post.state === 'blocked' ? '已拒绝' : post.state === 'done' ? '已完成' : '进行中'}</span></li>`,
          )
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
  $('resultActions').hidden = true;
  $('compare').hidden = true;
  current.post = null;
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
    showResult(view);
  } catch (error) {
    result.hidden = true; // 骨架不留在原地装样子
    status(error.message, 0);
    announce(`打开失败：${error.message}`);
  }
}
window.openPost = openPost;

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
  $('providerSel').value = localStorage.getItem('jevtown.provider') ?? 'mock';
  $('keyInput').value = localStorage.getItem('jevtown.key') ?? '';
  $('settings').showModal();
});

$('saveKey').addEventListener('click', () => {
  const provider = $('providerSel').value;
  const key = $('keyInput').value.trim();
  if (provider === 'mock') {
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

initThemeSwitcher();
loadFeed();

// 深链：带着 ?post=<id>（可选 &v=<版本号>）打开页面时直接呈现那份报告
const params = new URLSearchParams(location.search);
const wanted = params.get('post');
if (wanted) openPost(wanted, Number(params.get('v')) || null);
