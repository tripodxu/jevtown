// 前端编排：发文本 → 分步驱动检查（batch/wave）→ 渲染一页结果。
// 所有引擎逻辑都在 shared/，这个文件只做 fetch、进度和画图。
import { PRESETS, LOOKS, lookOf } from './shared/presets.js';
import { drawGrid, attachTooltip } from './grid.js';
import {
  REACTIONS_ZH, REASONS_ZH, HOOKS_ZH, COMMENTS_ZH, segmentValueZh, CHECKS_ZH, LIST_ZH,
} from './shared/labels.js';

const BLOCKED_ZH = {
  hate: '仇恨攻击', sexual: '露骨色情', violence: '暴力威胁',
  private_data: '他人隐私', illegal: '违法交易', insult: '辱骂人身攻击', gibberish: '无意义乱码',
};

const $ = (id) => document.getElementById(id);
const getJSON = (url) =>
  fetch(url).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    return data;
  });

const status = (line, ratio) => {
  $('status').hidden = false;
  $('statusLine').textContent = line;
  $('statusBar').style.width = `${Math.round((ratio ?? 0) * 100)}%`;
};

const readCheck = (p) => (p >= 0.7 ? 'yes' : p <= 0.3 ? 'no' : 'unclear');

// -- 提交与分步驱动 -------------------------------------------------------------

$('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = $('text').value.trim();
  const preset = $('preset').value;
  if (!text) return;
  $('go').disabled = true;
  $('result').hidden = true;
  try {
    status('开局：小镇在掂量这段文字是写给谁的……', 0.02);
    const opening = await postJSON('/api/check', { preset, text });

    if (opening.state === 'blocked') {
      status(`小镇拒绝发布：${opening.blocked.map((id) => BLOCKED_ZH[id] ?? id).join('、')}`, 1);
      return;
    }
    if (opening.unlisted.length) {
      status(`注意：${opening.unlisted.map((id) => BLOCKED_ZH[id] ?? id).join('、')}——仍会照常检查，但不进公共流。`, 0.04);
    }

    // 波次循环：一批批问 Jev（每批 100 人），收波定去留，直到检查结束。
    let done = false;
    while (!done) {
      for (;;) {
        const batch = await getJSON(`/api/batch?post=${opening.post}`);
        status(`第 ${batch.wave + 1} 波：${batch.answered} / ${batch.total} 人被问过`, batch.answered / Math.max(1, batch.total));
        if (batch.done) break;
      }
      const wave = await postJSON(`/api/wave?post=${opening.post}`);
      if (wave.done) {
        done = true;
        status('收尾：把最后的问题发给小镇……', 0.98);
      } else {
        status(`第 ${wave.wave.index + 1} 波完成，情绪 ${wave.wave.mood >= 0 ? '+' : ''}${wave.wave.mood}——文字继续传给第 ${wave.next.index + 1} 波（${wave.next.total} 人）`, 0.5);
      }
    }

    const result = await getJSON(`/api/post/${opening.post}`);
    render(result);
    status('完成。', 1);
    await loadFeed();
  } catch (error) {
    $('statusLine').innerHTML = `<span class="error">${esc(error.message)}</span>`;
    $('statusBar').style.width = '0%';
  } finally {
    $('go').disabled = false;
  }
});

// 原生的 fetch 不吃第二个参数里的 body —— 用一个带 body 的版本覆盖上面的调用方式。
async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

// -- 渲染 -----------------------------------------------------------------------

function esc(value) {
  return String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function render(result) {
  const el = $('result');
  el.hidden = false;
  const presetId = result.post.preset;
  const html = [];

  html.push('<h2>检查结果</h2>');
  html.push('<div class="blocked-note" style="border-color:var(--line)">');
  html.push(`<div>类型：${esc(PRESET_NOUN(presetId))} · 文本：${esc(result.post.text.slice(0, 80))}${result.post.text.length > 80 ? '…' : ''}</div>`);
  html.push('</div>');

  // 总览
  const c = result.counters;
  html.push('<h3>总览</h3><div class="stats">');
  html.push(stat(c.reach, '到达的人'));
  html.push(stat(c.stopped, '停下来'));
  html.push(stat(c.glad, '乐见'));
  html.push(stat(c.sorry, '反感'));
  html.push(stat(`$${result.spent.usd.toFixed(3)}`, '本次花费'));
  html.push('</div>');

  // 波次
  if (result.waves.length) {
    html.push('<h3>传播波次</h3><table class="waves"><tr><th>波次</th><th>到达</th><th>情绪（乐见−反感）</th><th></th></tr>');
    for (const wave of result.waves) {
      const last = wave.index === result.waves.length - 1;
      const travels = wave.travels && !last ? 'go' : 'stop';
      html.push(
        `<tr><td>第 ${wave.index + 1} 波</td><td>${wave.size} / ${wave.asked}</td><td>${wave.mood >= 0 ? '+' : ''}${wave.mood}</td>` +
          `<td><span class="badge ${travels}">${travels === 'go' ? '继续传播' : last ? '检查结束' : '停在这里'}</span></td></tr>`,
      );
    }
    html.push('</table>');
  }

  // 反应计数
  html.push('<h3>大家做了什么</h3><div class="counts">');
  for (const [reaction, count] of Object.entries(result.counters.byReaction)) {
    if (!count) continue;
    const look = lookOf(presetId, reaction);
    html.push(`<span class="chip" style="border-color:${LOOKS[look]}"><b>${count.toLocaleString()}</b> ${esc(REACTIONS_ZH[reaction] ?? reaction)}</span>`);
  }
  html.push('</div>');

  // 地图
  html.push('<h3>小镇地图</h3><div class="map-wrap"><canvas class="grid" id="grid"></canvas><div class="legend" id="legend"></div></div>');

  // Jev 的解读
  const checkIds = Object.keys(result.checks ?? {});
  if (checkIds.length) {
    html.push('<h3>Jev 对文本本身的解读</h3><div class="checks">');
    for (const id of checkIds) {
      const verdict = readCheck(result.checks[id]);
      html.push(`<span class="chip ${verdict}">${esc(CHECKS_ZH[id] ?? id)}：${verdict === 'yes' ? '是' : verdict === 'no' ? '否' : '说不准'}（${result.checks[id]}）</span>`);
    }
    html.push('</div>');
  }

  // 分组：谁停下了 / 谁乐见 / 谁反感
  const groups = [['stopped', '谁停下了'], ['glad', '谁乐见'], ['sorry', '谁反感']];
  for (const [key, title] of groups) {
    const list = result.segments?.[key] ?? [];
    if (!list.length) continue;
    html.push(`<h3>${title}（显著高于全城）</h3>`);
    for (const seg of list) {
      const share = seg.size ? seg[key] / seg.size : 0;
      html.push(
        `<div class="seg"><span class="label">${esc(SEGMENT_ZH[seg.attribute] ?? seg.attribute)}：${esc(segmentValueZh(seg.attribute, seg.value))}</span>` +
          `<span class="bar2"><i style="width:${Math.round(share * 100)}%;background:${key === 'sorry' ? 'var(--sorry)' : key === 'glad' ? 'var(--glad)' : 'var(--accent)'}"></i></span>` +
          `<span class="num">${seg[key]} / ${seg.size}（${Math.round(share * 100)}%）</span></div>`,
      );
    }
  }

  // 小镇在说
  const said = result.said;
  if (said?.lists && Object.keys(said.lists).length) {
    html.push('<h3>小镇在说（收尾提问）</h3>');
    for (const list of ['scrolled', 'sorry', 'hook', 'comment']) {
      const view = said.lists[list];
      if (!view) continue;
      const labels = list === 'hook' ? HOOKS_ZH[presetId] ?? {} : list === 'comment' ? COMMENTS_ZH : REASONS_ZH;
      const rows = Object.entries(view.totals)
        .filter(([id]) => id !== 'cant_tell')
        .sort((a, b) => b[1] - a[1]);
      const total = rows.reduce((sum, [, value]) => sum + value, 0) || 1;
      html.push(`<div class="said-row"><span class="what">${esc(LIST_ZH[list])} · 问了约 ${view.asked} 人：</span> `);
      html.push(rows.slice(0, 3).map(([id, value]) => `<span class="lead">${esc(labels[id] ?? id)} ${Math.round((value / total) * 100)}%</span>`).join('、'));
      html.push('</div>');
    }
  }

  // 人格声音
  if (result.voices?.length) {
    html.push('<h3>人格声音</h3><div class="voices">');
    for (const voice of result.voices) {
      html.push(
        `<div class="voice"><div class="who">${esc(voice.who.name)}，${voice.who.age}岁 · ${esc(voice.who.job ?? '')} · ${esc(voice.who.city)}</div>` +
          `<div class="what">${esc(REACTIONS_ZH[voice.reaction] ?? voice.reaction)}${voice.who.temper ? ` · ${esc(voice.who.temper)}` : ''}</div></div>`,
      );
    }
    html.push('</div>');
  }

  el.innerHTML = html.join('');

  // 地图与悬停
  const bytes = decodeLooks(result.looks);
  drawGrid($('grid'), bytes, presetId);
  attachTooltip($('grid'), bytes, presetId);
  renderLegend(presetId);
}

const PRESET_NOUN = (presetId) => ({ post: '帖子', listing: '闲置转让', product: '商品文案', headline: '标题' }[presetId] ?? presetId);

const stat = (value, label) => `<div class="stat"><b>${typeof value === 'number' ? value.toLocaleString() : value}</b><span>${label}</span></div>`;

function decodeLooks(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function renderLegend(presetId) {
  const keys = Object.keys(PRESETS[presetId].reactions);
  const seen = new Set();
  const rows = [];
  for (const reaction of keys) {
    const look = lookOf(presetId, reaction);
    if (seen.has(look)) continue;
    seen.add(look);
    rows.push(`<span class="dot" style="background:${LOOKS[look]}"></span>${esc(REACTIONS_ZH[reaction] ?? reaction)}`);
  }
  $('legend').innerHTML = rows.join('');
}

// -- 最近检查列表 ----------------------------------------------------------------

async function loadFeed() {
  try {
    const data = await getJSON('/api/feed');
    $('feed').innerHTML = data.posts.length
      ? data.posts
          .map(
            (post) =>
              `<li><a href="javascript:openPost('${post.id}')">${esc(post.excerpt)}</a>` +
              `<span class="meta">${esc(PRESET_NOUN(post.preset))} · ${post.state === 'done' ? '已完成' : post.state === 'running' ? '进行中' : '已拒绝'}</span></li>`,
          )
          .join('')
      : '<li class="meta" style="color:var(--muted)">还没有检查——发一段文字试试。</li>';
  } catch {
    $('feed').innerHTML = '<li class="error">读取失败：worker 没在跑？先 npm run dev。</li>';
  }
}

async function openPost(id) {
  $('result').hidden = false;
  try {
    const result = await getJSON(`/api/post/${id}`);
    render(result);
    $('result').scrollIntoView({ behavior: 'smooth' });
  } catch (error) {
    $('statusLine').innerHTML = `<span class="error">${esc(error.message)}</span>`;
  }
}
window.openPost = openPost;

loadFeed();
