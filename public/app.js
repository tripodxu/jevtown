// 前端编排：发文本 → 分步驱动检查（batch/wave）→ 交给 render.js 渲染。
// 支持"改一版再发"（POST /api/version，新版本重跑波次）与两版并排对比。
import { renderCheck, esc, stat } from './render.js';
import { initThemeSwitcher } from './theme.js';
import { BLOCKED_ZH, presetNoun as PRESET_NOUN_OF } from './shared/labels.js';
import { PRESETS } from './shared/presets.js';
import { drawGrid } from './grid.js';
import { fmtMs } from './charts.js';
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
const authHeaders = () => {
  const picks = byok();
  return picks ? { 'x-jev-provider': picks.provider, 'x-jev-key': picks.key } : {};
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

// -- 实时监控（检查进行中的动态地图与调用流水） ----------------------------------

let live = null;

function showLive(presetId) {
  live = {
    bytes: new Uint8Array(CROWD),
    keys: Object.keys(PRESETS[presetId].reactions),
    preset: presetId,
    start: performance.now(),
    requests: 0,
    tokens: 0,
    usd: 0,
    ms: 0,
  };
  $('monitorBody').innerHTML = '';
  $('live').hidden = false;
  drawGrid($('liveMap'), live.bytes, presetId);
  updateLiveStats();
}

function updateLiveStats() {
  let judged = 0;
  for (const b of live.bytes) if (b) judged += 1;
  $('liveStats').innerHTML =
    stat(`${judged.toLocaleString()} / ${CROWD.toLocaleString()}`, 'Jev 已判定') +
    stat(live.requests, 'Jev 请求') +
    stat(live.tokens.toLocaleString(), 'tokens') +
    stat(fmtMs(live.ms), '模型耗时') +
    stat(`$${live.usd.toFixed(4)}`, '累计花费');
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
  for (const { id, reaction } of batch.drawn ?? []) {
    const idx = live.keys.indexOf(reaction);
    if (idx >= 0) live.bytes[id] = idx + 1;
  }
  drawGrid($('liveMap'), live.bytes, live.preset);
  live.requests += 1;
  live.tokens += batch.tokens ?? 0;
  live.usd += batch.usd ?? 0;
  live.ms += batch.ms ?? 0;
  updateLiveStats();
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

    if (opening.state === 'blocked') {
      status(`Jev 拒绝发布：${opening.blocked.map((id) => BLOCKED_ZH[id] ?? id).join('、')}`, 1);
      return;
    }
    current.post = opening.post;
    current.version = opening.version;
    showLive(preset);
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
      } else {
        monitorRow([`第 ${wave.wave.index + 1} 波收束`, `情绪 ${wave.wave.mood >= 0 ? '+' : ''}${wave.wave.mood}`, `${wave.wave.size} 人`, '', ''], 'wave-row');
        status(`第 ${wave.wave.index + 1} 波完成，情绪 ${wave.wave.mood >= 0 ? '+' : ''}${wave.wave.mood}，文字继续传给第 ${wave.next.index + 1} 波（${wave.next.total} 人）`, 0.5);
      }
    }

    const view = await getJSON(`/api/post/${current.post}?v=${current.version}`);
    $('live').hidden = true;
    showResult(view);
    status('完成。', 1);
    await loadFeed();
  } catch (error) {
    $('statusLine').innerHTML = `<span class="error">${esc(error.message)}</span>`;
    $('statusBar').style.transform = 'scaleX(0)';
  } finally {
    $('go').disabled = false;
  }
});

function showResult(view) {
  renderCheck($('result'), view);
  $('resultActions').hidden = false;
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
        renderCheck(aside, v1);
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
              `<li><a href="javascript:openPost('${post.id}')">${esc(post.excerpt)}</a>` +
              `<span class="meta">${esc(PRESET_NOUN_OF(post.preset))} · ${post.state === 'done' ? '已完成' : post.state === 'running' ? '进行中' : '已拒绝'}</span></li>`,
          )
          .join('')
      : '<li style="color:var(--muted)">还没有检查。发一段文字试试。</li>';
  } catch {
    $('feed').innerHTML = '<li class="error">读取失败：worker 没在跑？先 npm run dev。</li>';
  }
}

async function openPost(id) {
  try {
    const view = await getJSON(`/api/post/${id}`);
    current.post = id;
    current.version = view.versions?.at(-1)?.number ?? 1;
    showResult(view);
  } catch (error) {
    status(error.message, 0);
  }
}
window.openPost = openPost;

// 人格声音"看全部"：展开折叠的第 25 张起，按钮自己消失。
document.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-expand-voices]');
  if (!btn) return;
  btn.parentElement.querySelector('.voices')?.classList.remove('collapsed');
  btn.remove();
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
