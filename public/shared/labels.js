// 界面中文标签：把 presets.js 里的英文 id 翻译成人话。Jev 读不到这个文件，它只面向界面。
import { INTEREST, FIELDS, AGE_GROUP, TEMPER, BUDGET, SHOP } from './vocab.js';

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
