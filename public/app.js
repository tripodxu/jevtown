// 前端编排：发文本 → 分步驱动检查（batch/wave）→ 交给 render.js 渲染。
// 支持"改一版再发"（POST /api/version，新版本重跑波次）与两版并排对比。
import { renderCheck, renderDelta, esc, stat } from './render.js';
import { initThemeSwitcher } from './theme.js';
import { BLOCKED_ZH, presetNoun as PRESET_NOUN_OF } from './shared/labels.js';
import { PRESETS } from './shared/presets.js';
import { drawGrid, paintDelta } from './grid.js';
import { fmtMs, rollingChart, shareChart } from './charts.js';
import { newTally, foldBatch } from './tally.js';
import { CROWD } from './shared/personas.js';

const $ = (id) => document.getElementById(id);
// 当前正在做的检查：哪个 post 的哪个版本。
const current = { post: null, version: 1 };

// BYOK：访客自填的 Jev key（localStorage），随每个 API 请求头发给 Worker；mock 通道不发。
const byok = () => {
  const provider = localStorage.getItem('jevtown.provider');
  const key = localStorage.getItem('jevtown.key');
  return provider && key && provider !== 'mock' ? { provider, key } : null;
};
let currentAuthor = null; // 当前检查的作者令牌（/api/check 响应带回；刷新页面即失效，需重开检查）
const authHeaders = () => {
  const picks = byok();
  return {
    ...(picks ? { 'x-jev-provider': picks.provider, 'x-jev-key': picks.key } : {}),
    ...(currentAuthor ? { 'x-jev-author': currentAuthor } : {}),
  };
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
  $('chartMs').innerHTML = rollingChart(live.msSeries, { width: narrow, color: 'var(--map-yellow)', unit: 'ms', format: (v) => Math.round(v) });
  $('chartShare').innerHTML = shareChart(live.shares, { width: wide });
}

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

// -- 提交与分步驱动 -------------------------------------------------------------

$('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = $('text').value.trim();
  const preset = $('preset').value;
  if (!text) return;
  $('go').disabled = true;
  try {
    status(current.post ? '再发一版：Jev 重新掂量……' : '开局：Jev 正在掂量这段文字是写给谁的……', 0.02);
    const opening = current.post
      ? await postJSON('/api/version', { post: current.post, text })
      : await postJSON('/api/check', { preset, text, prices: preset === 'product' ? [9, 19, 39, 79] : undefined });

    if (opening.author) {
      currentAuthor = opening.author;
      localStorage.setItem(`jevtown.author.${opening.post}`, opening.author);
    }
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
        const line = `第 ${wave.wave.index + 1} 波完成，情绪 ${wave.wave.mood >= 0 ? '+' : ''}${wave.wave.mood}，文字继续传给第 ${wave.next.index + 1} 波（${wave.next.total} 人）`;
        monitorRow([`第 ${wave.wave.index + 1} 波收束`, `情绪 ${wave.wave.mood >= 0 ? '+' : ''}${wave.wave.mood}`, `${wave.wave.size} 人`, '', ''], 'wave-row');
        status(line, 0.5);
        announce(line);
      }
    }

    const view = await getJSON(`/api/post/${current.post}?v=${current.version}`);
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
        const v1 = await getJSON(`/api/post/${current.post}?v=1`);
        // renderCheck 会清空容器，所以第 1 版渲染进子节点，差分卡才不会被一起清掉
        const diff = document.createElement('div');
        const v1card = document.createElement('div');
        slot.replaceChildren(diff, v1card);
        renderCheck(v1card, v1);
        renderDelta(diff, view, v1);
      } catch (error) {
        slot.innerHTML = `<span class="error">${esc(error.message)}</span>`;
      }
    });
  } else {
    aside.hidden = true;
  }
  $('result').scrollIntoView({ behavior: 'smooth' });
}

// -- 改一版再发 ------------------------------------------------------------------

$('revise').addEventListener('click', async () => {
  if (!current.post) return;
  const view = await getJSON(`/api/post/${current.post}?v=${current.version}`);
  $('text').value = view.post.text;
  $('preset').value = view.post.preset;
  $('text').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// -- 最近检查列表 ----------------------------------------------------------------

async function loadFeed() {
  try {
    const data = await getJSON('/api/feed');
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

// 回退/前进：URL 带 ?post= 就开对应报告，没有就收起报告回首页
window.addEventListener('popstate', () => {
  const id = new URLSearchParams(location.search).get('post');
  if (id) {
    openPost(id);
    return;
  }
  $('result').replaceChildren();
  $('result').hidden = true;
  $('resultActions').hidden = true;
  $('compare').hidden = true;
  current.post = null;
});

async function openPost(id) {
  status('正在打开报告……', 0.15);
  announce('正在打开报告');
  try {
    const view = await getJSON(`/api/post/${id}`);
    current.post = id;
    currentAuthor = localStorage.getItem(`jevtown.author.${id}`);
    current.version = view.versions?.at(-1)?.number ?? 1;
    showResult(view);
  } catch (error) {
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

// -- 通道设置（BYOK） -----------------------------------------------------------

const modeChip = $('modeChip');
const refreshModeChip = () => {
  const picks = byok();
  modeChip.textContent = picks ? `BYOK · ${picks.provider}` : '默认通道';
};

$('settingsBtn').addEventListener('click', () => {
  $('providerSel').value = localStorage.getItem('jevtown.provider') ?? 'mock';
  $('keyInput').value = localStorage.getItem('jevtown.key') ?? '';
  $('settings').showModal();
});

$('saveKey').addEventListener('click', () => {
  const provider = $('providerSel').value;
  const key = $('keyInput').value.trim();
  if (provider === 'mock' || !key) {
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

// 深链：带着 ?post=<id> 打开页面时直接呈现那份报告（feed 链接与分享链接都落在这里）
const wanted = new URLSearchParams(location.search).get('post');
if (wanted) openPost(wanted);
