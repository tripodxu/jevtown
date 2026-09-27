// 前端编排：发文本 → 分步驱动检查（batch/wave）→ 交给 render.js 渲染。
// 支持"改一版再发"（POST /api/version，新版本重跑波次）与两版并排对比。
import { renderCheck, esc } from './render.js';

const BLOCKED_ZH = {
  hate: '仇恨攻击', sexual: '露骨色情', violence: '暴力威胁',
  private_data: '他人隐私', illegal: '违法交易', insult: '辱骂人身攻击', gibberish: '无意义乱码',
};

const $ = (id) => document.getElementById(id);
// 当前正在做的检查：哪个 post 的哪个版本。
const current = { post: null, version: 1 };

const getJSON = async (url) => {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
};

const postJSON = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
};

const status = (line, ratio) => {
  $('status').hidden = false;
  $('statusLine').textContent = line;
  $('statusBar').style.width = `${Math.round((ratio ?? 0) * 100)}%`;
};

// -- 提交与分步驱动 -------------------------------------------------------------

$('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = $('text').value.trim();
  const preset = $('preset').value;
  if (!text) return;
  $('go').disabled = true;
  try {
    status(current.post ? '再发一版：小镇重新掂量……' : '开局：小镇在掂量这段文字是写给谁的……', 0.02);
    const opening = current.post
      ? await postJSON('/api/version', { post: current.post, text })
      : await postJSON('/api/check', { preset, text, prices: preset === 'product' ? [9, 19, 39, 79] : undefined });

    if (opening.state === 'blocked') {
      status(`小镇拒绝发布：${opening.blocked.map((id) => BLOCKED_ZH[id] ?? id).join('、')}`, 1);
      return;
    }
    current.post = opening.post;
    current.version = opening.version;
    if (opening.unlisted?.length) {
      status(`注意：${opening.unlisted.map((id) => BLOCKED_ZH[id] ?? id).join('、')}——仍会照常检查，但不进公共流。`, 0.04);
    }

    // 波次循环：一批批问 Jev（每批 100 人），收波定去留，直到检查结束。
    let done = false;
    while (!done) {
      for (;;) {
        const batch = await getJSON(`/api/batch?post=${current.post}&v=${current.version}`);
        status(`第 ${batch.wave + 1} 波：${batch.answered} / ${batch.total} 人被问过`, batch.answered / Math.max(1, batch.total));
        if (batch.done) break;
      }
      const wave = await postJSON(`/api/wave?post=${current.post}&v=${current.version}`);
      if (wave.done) {
        done = true;
        status('收尾完成。', 0.98);
      } else {
        status(`第 ${wave.wave.index + 1} 波完成，情绪 ${wave.wave.mood >= 0 ? '+' : ''}${wave.wave.mood}——文字继续传给第 ${wave.next.index + 1} 波（${wave.next.total} 人）`, 0.5);
      }
    }

    const view = await getJSON(`/api/post/${current.post}?v=${current.version}`);
    showResult(view);
    status('完成。', 1);
    await loadFeed();
  } catch (error) {
    $('statusLine').innerHTML = `<span class="error">${esc(error.message)}</span>`;
    $('statusBar').style.width = '0%';
  } finally {
    $('go').disabled = false;
  }
});

function showResult(view) {
  renderCheck($('result'), view);
  $('resultActions').hidden = false;
  // 版本 ≥2 时并排对比：左边第 1 版、右边当前版；单版本时隐藏对比卡。
  const aside = $('compare');
  if (current.version > 1) {
    getJSON(`/api/post/${current.post}?v=1`).then((v1) => {
      renderCheck(aside, v1);
      aside.hidden = false;
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

const PRESET_NOUN_OF = (presetId) => ({ post: '帖子', listing: '闲置转让', product: '商品文案', headline: '标题' }[presetId] ?? presetId);

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
      : '<li style="color:var(--muted)">还没有检查——发一段文字试试。</li>';
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

loadFeed();
