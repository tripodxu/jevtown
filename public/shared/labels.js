// 界面中文标签：把 presets.js 里的英文 id 翻译成人话。Jev 读不到这个文件，它只面向界面。
import { INTEREST, FIELDS, AGE_GROUP, TEMPER, BUDGET, SHOP, JOB } from './vocab.js';

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

/** 地图方位：把格坐标切成 3×3 说出人话（左上 → 右下）。 */
const DIRECTION_ZH = ['左上', '正上', '右上', '左', '中央', '右', '左下', '正下', '右下'];
export const directionZh = (at, grid = 100) => {
  if (!at) return '';
  const col = Math.min(2, Math.max(0, Math.floor((at.x / grid) * 3)));
  const row = Math.min(2, Math.max(0, Math.floor((at.y / grid) * 3)));
  return DIRECTION_ZH[row * 3 + col];
};
