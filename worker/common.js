// 路由共用的小件：响应/JSON 助手、D1 读写、通道选择、人群与派生缓存、双闸（写入日闸与 running 读闸）。
// 从 index.js 拆出（B8）：一个文件一个职责之后，开局/批次/收波/报告各自演化，不再共用一段会漂移的拷贝。
import { crowd } from '../public/shared/personas.js';
import { WAVES } from '../public/shared/feed.js';
import { pickableGroups } from '../public/shared/summary.js';
import { crowdTerrain } from '../public/shared/spatial.js';
import { pickProvider, PROVIDERS, ask as askJev } from '../public/shared/jev.js';
import { createMockAsk } from '../public/shared/mock.js';

const PER_REQUEST = 100;
// 波次上限的唯一来源是 feed.js 的 WAVES（今天的值是 4）；这里只留 env 覆盖的口子，
// 不再自造第二份 4——两处常量各写各的，改一处忘一处就是限额事故。
const WAVES_MAX = WAVES.length;

/**
 * 作者自述的一句「这段话是给谁的」（R35）。上限比 MAX_TEXT_CHARS 小：这句话是清单的标题，
 * 不是正文，写到 200 字还没挑出组的人，多写的 500 字只是在给存档增重。
 */
const MAX_AUDIENCE_SAID = 200;

/**
 * 清洗 body.audience。挑的必须是 `summary.js` 的 pickableGroups 里真有的段 id——作者端已经
 * 只让他从清单里挑，这里再挡一道：存档是外部输入，一个陌生的 id 进到对账表里只会变成一行
 * 「查不到这个组」，比直接丢更让人以为自己填错了。said 为空又没挑组就当没填（null）。
 */
function cleanAudience(input) {
  if (!input || typeof input !== 'object') return null;
  const picked = Array.isArray(input.picked)
    ? [...new Set(input.picked.filter((id) => typeof id === 'string' && pickableIds().has(id)))].slice(0, AUDIENCE_PICK_MAX)
    : [];
  const said = typeof input.said === 'string' ? input.said.trim().slice(0, MAX_AUDIENCE_SAID) : '';
  if (!said && !picked.length) return null;
  return { said, picked };
}

const PICKABLE = new Set();
let pickableBuilt = false;
function pickableIds() {
  if (!pickableBuilt) {
    pickableBuilt = true;
    for (const one of pickableGroups(crowdOf('zh'))) PICKABLE.add(one.id);
  }
  return PICKABLE;
}
/** 挑的组没有上限的意义（清单只有 115 项），但也不许一个请求塞十万个 id 进来。 */
const AUDIENCE_PICK_MAX = 115;

/**
 * 全城人群的模块级缓存：crowd() 算 1 万人格约 155ms，而 runCheck/closeWave/showPost 每个请求都要用。
 * Worker 的模块作用域在同一 isolate 内跨请求存活，热身后每请求 0ms；换池（未来加 en）也只算一次。
 */
const crowdCache = new Map();
function crowdOf(pool) {
  let people = crowdCache.get(pool);
  if (!people) crowdCache.set(pool, (people = crowd(pool)));
  return people;
}

/**
 * 地形结果按 post.v 缓存（isolate 内存）：crowdTerrain 是 showPost 纯计算的大头——置换检验
 * 全城 1 万格判定约 8ms（2026-10-25 邻接折 CSR 后；此前 ~9-10ms，scripts/probe-terrain.js），
 * 其中 ~3.5ms 是 Fisher-Yates 洗牌，随机序列被确定性锁死、省不得。反应只在 running 期间
 * 增长，closing/done 后冻结——只对非 running 的版本写缓存，同一份报告重复查看
 * （刷新/多人看/对比区回拉 v1）不再重算置换检验。
 * 版本号只增不复用 ⇒ 无失效路径，仅限容量防长驻 isolate 泄漏。
 */
const terrainCache = new Map();
const TERRAIN_CACHE_MAX = 200;

function terrainFor(presetId, keys, bytes, versionId, frozen) {
  if (!frozen) return crowdTerrain(presetId, keys, bytes, { versionId });
  let terrain = terrainCache.get(versionId);
  if (!terrain) {
    terrain = crowdTerrain(presetId, keys, bytes, { versionId });
    if (terrainCache.size >= TERRAIN_CACHE_MAX) terrainCache.delete(terrainCache.keys().next().value);
    terrainCache.set(versionId, terrain);
  }
  return terrain;
}

/**
 * 冻结版本的派生读数缓存（isolate 内存，terrainFor 的同款模式）：十档（exposureBands）
 * 与人格声音（voicesOf）只依赖 scores / bytes / 人群，终笔收波后不再变化——同一份报告
 * 重复查看（刷新、多人看、对比区回拉所选版本）不再现算。voices 全城一次要对每个反应者
 * 做 FNV 哈希（约 1–2ms），十档一趟约 2.5ms，是重复访问剩余的大头；首访照算不省。
 * 缓存对象直接进响应（只读，JSON.stringify 只读不写），版本号只增不复用 ⇒ 无失效路径。
 */
const derivedCache = new Map();
const DERIVED_CACHE_MAX = 200;

function derivedFor(versionId, frozen, make) {
  if (!frozen) return make();
  let value = derivedCache.get(versionId);
  if (!value) {
    value = make();
    if (derivedCache.size >= DERIVED_CACHE_MAX) derivedCache.delete(derivedCache.keys().next().value);
    derivedCache.set(versionId, value);
  }
  return value;
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const fail = (message, status = 400) => json({ error: message }, status);

/**
 * 读 versions 里的 JSON 文本列。空串和 NULL 一样当「没有」：?? 只挡得住 null/undefined，
 * 挡不住 ''，而 JSON.parse('') 抛 SyntaxError —— 报告一读这栏就整个 500（2026-10-03 提交审计
 * 实测；今天这些列都只由 JSON.stringify 写，还没有一版写过 ''，所以这是颗哑弹不是现行 bug）。
 * 空值该走哪条分支由调用方给 fallback（照原样传 'null' / '[]' / '{}'）。
 * 真的写坏了的 JSON 照旧往上抛——那是数据损坏，不该被这里悄悄吞成空对象。
 */
const readJson = (text, fallback = 'null') => JSON.parse(typeof text === 'string' && text.trim() ? text : fallback);

const today = () => new Date().toISOString().slice(0, 10);
const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);
const round2 = (value) => Math.round(value * 100) / 100;
// 钱的账面精度是 4 位小数：真实单价 ~$0.0015/批，round2 会把每一批抹成 0
// （2026-09-30 实测：站点 $0.010 vs CLI $0.033，日预算闸随之失明）。
// 显示口径不变（toFixed(3/4)），只有存储与累加变准。
const round4 = (value) => Math.round(value * 10000) / 10000;
/** body.prices → 干净的价格数组；非法或缺席 null。开局缺了直接 400，改版缺了则沿用上一版的阶梯。 */
const cleanPrices = (input) => (Array.isArray(input) && input.length >= 2 && input.every((n) => Number.isFinite(n) && n > 0) ? input.map(Number) : null);

/**
 * 这台 Worker 用哪条路到 Jev，优先级：请求头 BYOK（x-jev-provider + x-jev-key，访客在页面设置里填的）
 * → env 配置（JEV_PROVIDER + secret）→ mock（本地开发零门槛）。
 * BYOK 的 key 只在本请求内存里用一次，不落库不打日志。
 *
 * retries 是「一次 Worker 调用」的共享重试预算，40 不是 MAX_ATTEMPTS：单个请求失败重试 5 次是
 * 单批自己的事，而一次收波要在同一次调用里连发几十个批次，每个批次都带 5 次重试会先撞 Cloudflare
 * 的 50 外呼上限。所以这里发一份总配额给本次调用的所有批次——重试优先给前面的批次用完，
 * 后面的批次失败就直接失败（批次认领制会把它们留在 answered 之外，下一批次还会问它们）。
 */
const RETRIES_PER_INVOCATION = 40;

function providerOf(env, request = null) {
  if (request) {
    const headerName = String(request.headers.get('x-jev-provider') ?? '').trim().toLowerCase();
    // 访客在设置里显式选了 mock（只发通道名不带 key）：回到离线假答案——默认通道是真模型的
    // 2026-10-07 起，mock 必须能被显式选回去，不能靠"不发 BYOK 头"来表达。
    if (headerName === 'mock') return { name: 'mock', ask: createMockAsk() };
    const headerKey = String(request.headers.get('x-jev-key') ?? '').trim();
    if (headerKey && PROVIDERS[headerName]) {
      const picked = { ...PROVIDERS[headerName], apiKey: headerKey };
      const retries = { left: RETRIES_PER_INVOCATION };
      return { name: headerName, ask: (req) => askJev(picked, req, retries) };
    }
  }
  const wanted = String(env.JEV_PROVIDER ?? '').trim().toLowerCase();
  if (wanted !== 'mock') {
    const picked = pickProvider(env);
    if (picked) {
      const retries = { left: RETRIES_PER_INVOCATION };
      return { name: picked.name, ask: (req) => askJev(picked, req, retries) };
    }
    // 纯免费兜底（2026-10-07）：Zen 的 systemone 匿名开放，无 key 也有真实 Jev——
    // 这就是访客「什么都不填」时的默认通道。匿名限流随时可能收紧，届时运营方
    // `npx wrangler secret put OPENCODE_API_KEY` 即回到认证流量，代码与访客都无感。
    // R28 拆站方 key 闸拆的是钱包风险：这条通道免费，没有钱包可烧，每 IP 日闸管滥用。
    if (PROVIDERS.opencode.openAccess) {
      const retries = { left: RETRIES_PER_INVOCATION };
      return { name: 'opencode', ask: (req) => askJev(PROVIDERS.opencode, req, retries) };
    }
  }
  return { name: 'mock', ask: createMockAsk() };
}

// -- D1 小助手 ----------------------------------------------------------------

const loadPost = async (db, id) => (await db.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first()) ?? null;
const loadVersion = async (db, id, number = 1) =>
  (await db.prepare('SELECT * FROM versions WHERE post = ? AND number = ?').bind(id, number).first()) ?? null;

/** 写操作的作者校验：x-jev-author 头必须与 posts.author 一致（旧帖 author 为 NULL 时一律拒绝）。 */
const authorOk = (request, post) => {
  const sent = String(request?.headers.get('x-jev-author') ?? '');
  return !!post.author && sent === post.author;
};

/** 记一笔调用流水（请求数以行计，同键冲突时累加金额与耗时）。返回 D1 语句（可直接进 db.batch，单独执行时加 .run()）。 */
const addSpend = (db, { post, number = 1, stage, n = 0, usd = 0, tokens = 0, ms = 0, day }) =>
  db.prepare(
    'INSERT INTO batches (post, number, stage, n, usd, tokens, ms, day) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT (post, number, stage, n) DO UPDATE SET usd = usd + excluded.usd, tokens = tokens + excluded.tokens, ms = ms + excluded.ms',
  )
    .bind(post, number, stage, n, round4(usd), Math.round(tokens), Math.round(ms), day);

// R28：站点不提供站方 key——每 IP 每日限额与全站日预算两个闸整体退役
//（它们保护的站方钱包不存在了；真实检查一律走访客自填的 BYOK key，无 key 即 mock）。

/**
 * 每 IP 每日写入闸：R28 拆掉的旧闸保护的是两样东西——站方钱包（BYOK-only 后确实不存在了）
 * 和 D1 每日写入配额（免费档 10 万行/天，一次全城检查 ≈1 万行 reactions，无 key 的 mock
 * 检查同样落库）。钱包死了，配额还在：无闸时一个脚本访客当天就能耗光全站写入额度，连真实
 * 用户一起失败。这道轻闸只护配额，对 /api/check 与 /api/version 双路生效——version 自己
 * 只写一行，但它给持令牌者开了继续烧 reactions 的口子，不能只堵 check。
 * 键是 CF-Connecting-IP（生产由边缘注入，客户端伪造不了）。环回豁免：本地 workerd 给
 * 无头请求注入 127.0.0.1（2026-10-06 实测；测试里的显式假头会原样透传），而生产边缘的
 * 这个头来自真实 TCP 对端、不可能是环回——本地 mock 零门槛与测试不受限由此而来，也绕开
 * 「测试用满本地日限额」的坑（MEMORY.md 2026-09-29）。0 = 不限。
 */
const CHECK_DAILY_LIMIT_DEFAULT = 20;

async function overDailyLimit(env, ip) {
  if (ip === 'local' || ip === '127.0.0.1' || ip === '::1') return false;
  const limit = Number(env.CHECK_DAILY_LIMIT ?? CHECK_DAILY_LIMIT_DEFAULT);
  if (!(limit > 0)) return false;
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM posts WHERE ip = ? AND day = ?').bind(ip, today()).first();
  return row.n >= limit;
}

/**
 * running 报告的消费闸：冻结报告有快照路径与 isolate 缓存挡着，贵的是 running 版——
 * 逐行读全部 reactions（最多 1 万行）再全量现算，且没有任何缓存可复用。公开读、无身份，
 * 一个循环刷新的爬虫就能把 D1 读放大（技术债 B7，2026-10-25 修）。
 * 轻闸只活在 isolate 内存里（每实例独立、随实例消失）：挡的是单客户端刷屏，不是分布式
 * 滥用（那个归 Cloudflare 自身的边缘限流管）。键与写闸同源（CF-Connecting-IP；环回豁免
 * 让本地开发与测试无感）。冻结版不受影响——正常读者刷新已完成的报告永远碰不到这道闸。
 */
const READ_WINDOW_MS = 60_000;
const READ_MAX_RUNNING = 30;
const readHits = new Map();

function readAllowed(ip) {
  if (ip === 'local' || ip === '127.0.0.1' || ip === '::1') return true;
  const now = Date.now();
  const hits = (readHits.get(ip) ?? []).filter((t) => now - t < READ_WINDOW_MS);
  if (hits.length >= READ_MAX_RUNNING) {
    readHits.set(ip, hits);
    return false;
  }
  hits.push(now);
  readHits.set(ip, hits);
  if (readHits.size > 1000) readHits.delete(readHits.keys().next().value); // 容量：防长驻实例内存无界
  return true;
}

export {
  PER_REQUEST, WAVES_MAX, cleanAudience, pickableIds, crowdOf, terrainFor, derivedFor,
  json, fail, readJson, today, newId, round2, round4, cleanPrices, providerOf,
  loadPost, loadVersion, authorOk, addSpend, overDailyLimit, readAllowed,
};
