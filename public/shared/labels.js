// 界面中文标签：把 presets.js 里的英文 id 翻译成人话。Jev 读不到这个文件，它只面向界面。
import { INTEREST, FIELDS, AGE_GROUP, TEMPER, BUDGET, SHOP, JOB } from './vocab.js';

/**
 * 有符号数字的唯一写法（R33）。
 *
 * 原来每个要显示正负的地方自己拼 `${v >= 0 ? '+' : ''}${v.toFixed(2)}`，于是
 * ASCII 连字符 '-' 和真减号 '−' 混在同一页里（逐句承重那三处是真减号，
 * 基线与 z 那些是连字符）。两个字形宽度与高度都不同——连字符坐在 x 高上、
 * 真减号居中且更宽——同一栏数字排一起时会看出一列在跳。
 *
 * 所以定一个规矩：**正数显式写 '+'，负数一律用真减号 U+2212（宽度同数字，
 * 是排版上正确的负号字形），0 写成 '0' 不带符号。**
 */
export const signed = (value, digits = 4) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}`;

/** 人计数专用：带千分位（差分看板上的「+1,204 人」不能写成 +1204）。 */
export const signedCount = (value) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toLocaleString()}`;

export const PRESET_ZH = {
  post: { noun: '帖子', who: '读者' },
  listing: { noun: '闲置转让', who: '买家' },
  product: { noun: '商品', who: '顾客' },
  headline: { noun: '标题', who: '读者' },
};

export const REACTIONS_ZH = {
  scrolled_past: '划走了',
  read: '停下来看了',
  liked: '点了赞',
  disliked: '有点反感',
  reposted: '转发了',
  followed: '关注了',
  blocked: '拉黑了',
  opened: '点开看了看',
  saved: '先收藏了',
  wrote: '联系卖家',
  scam: '怀疑是骗局',
  looked: '打开看了看',
  cart: '加购/想要',
  bought: '下单买了',
  glanced: '扫了一眼',
  clicked: '点进去了',
  annoyed: '觉得被钓了',
  cant_tell: '看不出会怎样',
};

export const REASONS_ZH = {
  not_for_them: '和他们生活工作不相关',
  weak_opening: '开头没给他们停下来的理由',
  unclear: '一眼看不出在说什么',
  too_long: '太长、不好消化',
  nothing_new: '没新意，见过太多次',
  distrust: '不信：像广告、 Spam、夸大或骗局',
  tone: '语气让人不舒服',
  disagree: '不同意它的说法',
  price: '价格太贵，或觉得不值',
  missing: '缺了他们要的信息：价格、成色、细节',
};

export const HOOKS_ZH = {
  post: {
    example: '具体的数字、事实或例子',
    story: '个人经历或故事',
    useful: '用得上的技巧',
    humour: '有趣、好笑',
    opinion: '说出了他们的想法',
    opening: '第一句让人想读下去',
    topic: '就是话题本身对他们胃口',
  },
  listing: {
    price: '价格看着公道',
    details: '细节说清了他们的疑问：成色、配置、附带什么',
    trust: '卖家看着实在：描述具体、坦诚',
    terms: '交易方式：发货、验货、自提',
    need: '正好需要这样东西',
  },
  product: {
    price: '价格看着公道',
    benefit: '解决了他们的问题',
    claims: '说法具体、可查证',
    guarantee: '有保障或好退换',
    details: '细节说清了他们的疑问',
    need: '正好需要这类东西',
  },
  headline: {
    curiosity: '好奇：想知道后面是什么',
    promise: '点开能得到什么',
    detail: '里面有具体的数字或细节',
    news: '听起来是新鲜事或大事',
    topic: '就是话题本身对他们胃口',
  },
};

export const COMMENTS_ZH = {
  adds_own: '附和并补一段自己的经历',
  question: '问作者一个问题',
  argues: '抬杠或指出错误',
  thanks: '感谢或夸几句',
  joke: '开个玩笑',
  tags: '@ 一个该看的朋友',
  none: '不会评论',
};

export const SEGMENT_ZH = {
  interest: '兴趣',
  field: '职业',
  age: '年龄段',
  temper: '性格',
  budget: '预算',
  shopping: '想买',
  city: '城市',
};

export const CHECKS_ZH = {
  point_first: '第一句就说清了在卖什么',
  ask: '说清了读者该做什么',
  concrete: '有具体的数字、名字或例子',
};

export const LIST_ZH = {
  scrolled: '为什么划走',
  sorry: '为什么反感',
  hook: '什么让他们停下',
  comment: '会怎么评论',
};

/** 分段展示时，把段值翻译成中文（兴趣/职业/领域/性格/预算/想买）。城市本身已是中文。 */
export function segmentValueZh(attribute, value) {
  if (attribute === 'interest') return INTEREST[value]?.zh ?? value;
  if (attribute === 'field') return FIELDS[value]?.zh ?? value;
  if (attribute === 'age') return AGE_GROUP[value]?.zh ?? value;
  if (attribute === 'temper') return TEMPER[value]?.zh ?? value;
  if (attribute === 'budget') return BUDGET[value]?.zh ?? value;
  if (attribute === 'shopping') return SHOP[value]?.zh ?? value;
  return value;
}

/** 闲置转让的追问：买家会先问卖家什么（keys 与 presets.js listing.followUp.answers 一致）。 */
export const FOLLOWUP_LISTING_ZH = {
  available: '还在吗',
  negotiable: '能便宜点吗',
  quick_discount: '今天要能给优惠吗',
  condition: '成色怎么样，有划痕吗',
  defects: '功能都正常吗，修过吗',
  how_old: '用了多久',
  why_selling: '为什么卖',
  original: '是原装的吗',
  documents: '有发票、包装或保修吗',
  included: '都附带什么',
  details: '关键参数（电池、里程、尺寸）',
  photos: '能多发几张图或视频吗',
  delivery: '发物流吗，谁出运费',
  pickup: '哪里自提',
  try_first: '可以先验货吗',
  safe_deal: '支持担保交易或货到付款吗',
  exchange: '可以换物吗',
  hold: '能帮我留几天吗',
  bulk: '多件有优惠吗',
  nothing: '不用问，直接要了',
};

/** 人格 → 界面卡片用的干净视图（Worker 的 voices 与回放共用）。 */
export function personView(who) {
  return {
    id: who.id,
    name: who.name.zh,
    age: who.age,
    job: JOB[who.job]?.zh,
    city: who.city.zh,
    temper: TEMPER[who.temper]?.zh,
  };
}

/** 审核原因 id → 中文（app.js 状态行与 render.js 详情卡共用）。 */
export const BLOCKED_ZH = {
  hate: '仇恨攻击', sexual: '露骨色情', violence: '暴力威胁',
  private_data: '他人隐私', illegal: '违法交易', insult: '辱骂人身攻击', gibberish: '无意义乱码',
};

/** 预设 id → 界面名词（检查结果标题、feed 列表共用）。 */
export const presetNoun = (presetId) =>
  ({ post: '帖子', listing: '闲置转让', product: '商品文案', headline: '标题' }[presetId] ?? presetId);

/** 调用报告的分阶段名称（batches.stage → 中文）。 */
export function reportStageZh(stage) {
  if (stage === 'opening') return '开局打分';
  if (stage === 'followup') return '追问阶段';
  if (stage === 'ask') return '收尾提问';
  // 逐句消融（R32）的四路在 batches 里各占一行同一 stage，靠 n 区分：
  // -1 原文、-2 原文+同样措辞（对照）、-3 复读（噪声底）、>=0 是删掉第 n+1 句。
  if (stage === 'ablate') return '逐句承重';
  const wave = /^wave(\d+)$/.exec(stage);
  if (wave) return `第 ${Number(wave[1]) + 1} 波`;
  return stage;
}

/** 人群地形（shared/spatial.js 的判定）的中文，渲染层只从这里取。 */
export const TERRAIN_VERDICT_ZH = {
  clustered: '成片',
  scattered: '零散',
  unclear: '看不出',
};

/** 判定的一句话人话：成片 / 零散 / 与随机无异。
 *  说的是**整张地图**的读数，所以不提"没有哪一片"——零散的整体里照样可能有局部小簇，
 *  那是 `where` 那句补的事。 */
export const TERRAIN_SAY_ZH = {
  clustered: '像一片地形，不是撒开的散点——有一整片人群朝着同一个方向表态。',
  scattered: '像撒开的豆子——整张地图上看不出哪一片人整齐地表态。',
  unclear: '和把地图随机打乱没有区别，看不出成片还是零散。',
};

/** 两版之差（shared/spatial.js 的 crowdDelta）的中文，渲染层只从这里取。 */
export const DELTA_SAY_ZH = {
  clustered: '翻盘是成片的——你改的这几个词，把一整片人从划走推到了点赞那边。',
  scattered: '翻盘是零散的——没有哪一片人整齐地改了主意，你多哄到的是零散几个。',
  unclear: '看不出成片：改动落在地图上是随机的，没有哪一片人整齐地转过来。',
};

/** 地图方位：把格坐标切成 3×3 说出人话（左上 → 右下）。 */
const DIRECTION_ZH = ['左上', '正上', '右上', '左', '中央', '右', '左下', '正下', '右下'];
export const directionZh = (at, grid = 100) => {
  if (!at) return '';
  const col = Math.min(2, Math.max(0, Math.floor((at.x / grid) * 3)));
  const row = Math.min(2, Math.max(0, Math.floor((at.y / grid) * 3)));
  return DIRECTION_ZH[row * 3 + col];
};

/**
 * 这一波离「纯随机」有多远（shared/feed.js 的 moodZ）。z=0 就是一个骰子能掷出来的读数。
 * 说的是与随机之差，不是否定——「比随机差」也是 Jev 给出的真答案，只是它说的是「没人要」。
 */
export const Z_SAY_ZH = {
  far: '这一波明显不是碰运气——同一段文字换个人群，结果不会只是掷骰子。',
  near: '这一波和纯随机分不出高下：读到的情绪，一个不看内容只乱选的镇子也能读出来。',
  below: '这一波比纯随机还冷——没人要它。这是个真答案，不是没读出来。',
};
export const zSayZh = (z) => (z >= 2 ? Z_SAY_ZH.far : z <= -2 ? Z_SAY_ZH.below : Z_SAY_ZH.near);

/**
 * 「哪一句在撑」（shared/away.js 的逐句消融）的中文，渲染层只从这里取。
 * 绿=吃它的组（删掉这句他们更不在乎），红=掉头的组（删掉这句他们反而更在乎）。
 */
export const AWAY_ZH = {
  title: '哪一句在撑',
  button: '看看哪一句在撑',
  buttonHint: '会调用 Jev，约 $0.003。按句逐句删一遍重读，谁在乎哪句就显出来。',
  running: '正在逐句重读…',
  green: '吃它的组',
  red: '掉头的组',
  holding: '这句在撑',
  blocking: '这句在挡路',
  quiet: '这一句，%1 组人读不出差别',
  quietHint: '读不出来不等于没用——只是这段话里它不是决定性的那一半。',
  meanHint: '每句末尾那个均值常常抵平成 0，因为一组人买、一组人掉头——差距在组与组之间，不在平均上。',
  settled: '只读成了前面几句，后面几句这次没读完。',
  none: '只有一句话，删掉它就是删掉整段——这样的消融说明不了什么。',
  failed: '这次没能算出逐句承重：%1',
  noCall: '作者可以算这一节',
};

/** 一句消融结果的人话判断：均值与组间两端各说各的，取说得上话的那个。 */
export function awaySayZh(sentence) {
  if (!sentence.readable) return AWAY_ZH.quiet.replace('%1', String(sentence.deltas.length));
  if (sentence.mean >= 0) return AWAY_ZH.holding;
  return AWAY_ZH.blocking;
}

/**
 * 「这段话是给谁的」（summary.js 的 reconcileAudience）的中文，渲染层只从这里取。
 * 三个结论：hit（挑的组里有显著的）、miss（挑的零显著）、none（一个都没挑）。
 * 表头一句话说清结论，规则写死在 reconcileAudience 里，这里只负责说成人话。
 */
export const AUDIENCE_ZH = {
  title: '这段话是给谁的',
  saidLabel: '你说的是',
  pickLabel: '你挑的',
  filterLabel: '加一组人群',
  hint: '从小镇的人群里挑几组。挑不挑都行——挑了才有一张对账表。',
  coldNote: '以下组既没被你挑，也没人特别停下来',
  hit: '你说的 %1 组里有 %2 组真停下来了',
  miss: '你挑的 %1 组一个都没显著停下来，实际停下来的是你没挑的',
  none: '你没挑组：这一节在说你写的话引来了谁',
  nothing: '这次一个组都没读出来，还对不了账',
  notFound: '没找到这一组——换个人群的叫法试试（词表里是「设计文案传媒」不是「做创意的」）。',
  more: '还有 %1 项没显示，输入得更具体一点。',
  unsaidMore: '还有 %1 组也显著停下来，这次没列。',
  pickedCount: '已选 %1 组',
};

export const AUDIENCE_STATE_ZH = {
  hit: '对上了',
  miss: '没等到',
  unsaid: '没说的',
  cold: '两边都冷',
};

/** 一句表头结论：summary.js 给的口径（几个里几个）由标签表说成话。
 * `readable` = segments() 读出了人群分布。读不出分布时说什么都对不上账，先说清这一点。 */
export function audienceSayZh(summary) {
  if (!summary.readable) return AUDIENCE_ZH.nothing;
  if (!summary.pickedCount) return AUDIENCE_ZH.none;
  if (!summary.hitCount) return AUDIENCE_ZH.miss.replace('%1', String(summary.pickedCount));
  return AUDIENCE_ZH.hit.replace('%1', String(summary.pickedCount)).replace('%2', String(summary.hitCount));
}
