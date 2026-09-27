// 中文小镇的固定词表。人格由这些词表算出；Jev 读英文字段（en/line/group），界面显示中文字段（zh）。
// 结构与上游 gaborishka/jevtown 的 vocab.js 完全一致（MIT）；id 一旦发布就不要再改名，存储的反应和链接依赖它们。

/**
 * 兴趣，按人格网格的布局排列：5 行 × 8 列，最年轻的一行在前。人格的主兴趣是离它最近的格子，
 * 所以同兴趣同年龄的人挨在一起。`field` 是这类人常做的职业领域，`shopping` 是他们常想买的东西。
 */
export const INTEREST_COLUMNS = 8;
export const INTERESTS = [
  // 18–27
  { id: 'games', en: 'video games', zh: '游戏', shopping: 'console' },
  { id: 'anime', en: 'anime', zh: '动漫', shopping: 'books' },
  { id: 'memes', en: 'memes and internet culture', zh: '网络热梗' },
  { id: 'pop_music', en: 'pop music', zh: '流行音乐', shopping: 'gift' },
  { id: 'fashion', en: 'fashion', zh: '穿搭时尚', field: 'retail', shopping: 'clothes' },
  { id: 'beauty', en: 'beauty and skincare', zh: '美妆护肤', field: 'retail', shopping: 'beauty' },
  { id: 'campus', en: 'student life', zh: '校园生活', field: 'student', shopping: 'laptop' },
  { id: 'crypto', en: 'crypto', zh: '加密货币', field: 'finance' },
  // 24–36
  { id: 'programming', en: 'programming', zh: '编程', field: 'it', shopping: 'laptop' },
  { id: 'ai_tools', en: 'AI tools', zh: 'AI 工具', field: 'it', shopping: 'courses' },
  { id: 'startups', en: 'startups', zh: '创业', field: 'business' },
  { id: 'design', en: 'design', zh: '设计', field: 'creative', shopping: 'laptop' },
  { id: 'photography', en: 'photography', zh: '摄影', field: 'creative', shopping: 'phone' },
  { id: 'travel', en: 'travel', zh: '旅行', shopping: 'trip' },
  { id: 'fitness', en: 'gym and fitness', zh: '健身', shopping: 'sports_gear' },
  { id: 'running', en: 'running and cycling', zh: '跑步骑行', shopping: 'sports_gear' },
  // 33–46
  { id: 'parenting', en: 'parenting', zh: '育儿', field: 'home', shopping: 'kids' },
  { id: 'renovation', en: 'home renovation', zh: '家装', field: 'trades', shopping: 'tools' },
  { id: 'cooking', en: 'cooking', zh: '烹饪', shopping: 'appliances' },
  { id: 'cars', en: 'cars', zh: '汽车', field: 'transport', shopping: 'car' },
  { id: 'investing', en: 'investing', zh: '投资理财', field: 'finance' },
  { id: 'saving', en: 'personal finance', zh: '省钱攒钱', field: 'finance' },
  { id: 'career', en: 'career growth', zh: '职场成长', field: 'office', shopping: 'courses' },
  { id: 'psychology', en: 'psychology', zh: '心理学', field: 'medicine', shopping: 'books' },
  // 43–58
  { id: 'news', en: 'news and politics', zh: '时事新闻', field: 'public' },
  { id: 'small_business', en: 'small business', zh: '小生意', field: 'business' },
  { id: 'real_estate', en: 'real estate', zh: '买房租房', field: 'business', shopping: 'rent' },
  { id: 'football', en: 'football', zh: '足球', shopping: 'sports_gear' },
  { id: 'fishing', en: 'fishing', zh: '钓鱼', field: 'trades', shopping: 'sports_gear' },
  { id: 'history', en: 'history', zh: '历史', field: 'education', shopping: 'books' },
  { id: 'books', en: 'books', zh: '读书', field: 'education', shopping: 'books' },
  { id: 'tv_series', en: 'movies and TV series', zh: '影视剧' },
  // 52–80
  { id: 'gardening', en: 'gardening', zh: '种花种菜', field: 'agriculture', shopping: 'garden' },
  { id: 'health', en: 'health and wellness', zh: '健康养生', field: 'medicine' },
  { id: 'tai_chi', en: 'tai chi', zh: '太极晨练', field: 'medicine' },
  { id: 'tea', en: 'tea', zh: '茶', shopping: 'gift' },
  { id: 'crafts', en: 'knitting and crafts', zh: '编织手工', shopping: 'gift' },
  { id: 'pets', en: 'pets', zh: '宠物', shopping: 'pets' },
  { id: 'volunteering', en: 'volunteering', zh: '公益志愿', field: 'public' },
  { id: 'folk_music', en: 'opera and folk music', zh: '戏曲民乐', field: 'creative' },
];

/** 职业领域。`group` 是传播算法对这类人的英文称呼；`income` 平移预算档位。 */
export const FIELDS = {
  it: { group: 'people who work in IT', zh: 'IT 从业者', income: 1.2 },
  creative: { group: 'designers, photographers, writers and musicians', zh: '设计文案传媒', income: 0.2 },
  education: { group: 'teachers and lecturers', zh: '教师', income: -0.3 },
  medicine: { group: 'doctors, nurses and pharmacists', zh: '医护', income: 0 },
  trades: { group: 'builders, electricians, mechanics and other tradespeople', zh: '装修维修', income: 0 },
  retail: { group: 'people who work in shops, cafes and salons', zh: '门店餐饮', income: -0.5 },
  office: { group: 'office workers: accountants, lawyers, HR, bank clerks', zh: '办公室职员', income: 0.2 },
  finance: { group: 'people who work in finance', zh: '金融从业者', income: 0.8 },
  business: { group: 'business owners, sales and marketing people', zh: '做生意', income: 0.8 },
  public: { group: 'civil servants, police, soldiers and social workers', zh: '体制内', income: -0.2 },
  agriculture: { group: 'farmers', zh: '农业', income: -0.2 },
  transport: { group: 'drivers and couriers', zh: '司机快递', income: -0.3 },
  home: { group: 'stay-at-home parents', zh: '全职家长', income: -0.4 },
  student: { group: 'students', zh: '学生', income: -1 },
  retired: { group: 'pensioners', zh: '退休', income: -1 },
};

export const JOBS = [
  { id: 'developer', field: 'it', en: 'software developer', zh: '程序员' },
  { id: 'qa', field: 'it', en: 'QA engineer', zh: '测试工程师' },
  { id: 'product_manager', field: 'it', en: 'product manager', zh: '产品经理' },
  { id: 'data_analyst', field: 'it', en: 'data analyst', zh: '数据分析师' },
  { id: 'designer', field: 'creative', en: 'designer', zh: '设计师' },
  { id: 'photographer', field: 'creative', en: 'photographer', zh: '摄影师' },
  { id: 'copywriter', field: 'creative', en: 'copywriter', zh: '文案' },
  { id: 'creator', field: 'creative', en: 'content creator', zh: '自媒体人' },
  { id: 'teacher', field: 'education', en: 'school teacher', zh: '教师' },
  { id: 'lecturer', field: 'education', en: 'university lecturer', zh: '大学讲师' },
  { id: 'tutor', field: 'education', en: 'tutor', zh: '家教' },
  { id: 'doctor', field: 'medicine', en: 'doctor', zh: '医生' },
  { id: 'nurse', field: 'medicine', en: 'nurse', zh: '护士' },
  { id: 'pharmacist', field: 'medicine', en: 'pharmacist', zh: '药剂师' },
  { id: 'electrician', field: 'trades', en: 'electrician', zh: '电工' },
  { id: 'builder', field: 'trades', en: 'builder', zh: '装修师傅' },
  { id: 'mechanic', field: 'trades', en: 'car mechanic', zh: '汽修工' },
  { id: 'plumber', field: 'trades', en: 'plumber', zh: '水管工' },
  { id: 'shop_assistant', field: 'retail', en: 'shop assistant', zh: '店员' },
  { id: 'barista', field: 'retail', en: 'barista', zh: '咖啡师' },
  { id: 'hairdresser', field: 'retail', en: 'hairdresser', zh: '美发师' },
  { id: 'accountant', field: 'office', en: 'accountant', zh: '会计' },
  { id: 'lawyer', field: 'office', en: 'lawyer', zh: '律师' },
  { id: 'hr', field: 'office', en: 'HR manager', zh: '人事' },
  { id: 'bank_clerk', field: 'finance', en: 'bank clerk', zh: '银行职员' },
  { id: 'financial_analyst', field: 'finance', en: 'financial analyst', zh: '金融分析师' },
  { id: 'business_owner', field: 'business', en: 'small business owner', zh: '小老板' },
  { id: 'sales_manager', field: 'business', en: 'sales manager', zh: '销售经理' },
  { id: 'marketer', field: 'business', en: 'marketer', zh: '市场营销' },
  { id: 'realtor', field: 'business', en: 'real estate agent', zh: '房产中介' },
  { id: 'civil_servant', field: 'public', en: 'civil servant', zh: '公务员' },
  { id: 'police', field: 'public', en: 'police officer', zh: '警察' },
  { id: 'social_worker', field: 'public', en: 'social worker', zh: '社工' },
  { id: 'farmer', field: 'agriculture', en: 'farmer', zh: '农民' },
  { id: 'truck_driver', field: 'transport', en: 'truck driver', zh: '货车司机' },
  { id: 'taxi_driver', field: 'transport', en: 'ride-hailing driver', zh: '网约车司机' },
  { id: 'courier', field: 'transport', en: 'courier', zh: '快递员' },
  { id: 'home_parent', field: 'home', en: 'stay-at-home parent', zh: '全职家长' },
  { id: 'student', field: 'student', en: 'student', zh: '学生' },
  { id: 'retired', field: 'retired', en: 'pensioner', zh: '退休人员' },
];

export const AGE_GROUPS = [
  { id: 'a18', from: 18, group: 'people aged 18 to 24', en: '18–24', zh: '18–24 岁' },
  { id: 'a25', from: 25, group: 'people aged 25 to 34', en: '25–34', zh: '25–34 岁' },
  { id: 'a35', from: 35, group: 'people aged 35 to 44', en: '35–44', zh: '35–44 岁' },
  { id: 'a45', from: 45, group: 'people aged 45 to 59', en: '45–59', zh: '45–59 岁' },
  { id: 'a60', from: 60, group: 'people aged 60 and older', en: '60+', zh: '60 岁以上' },
];

/** 人格在信息流里的行为方式。`line` 是 Jev 读到的英文，`zh` 是界面标签。 */
export const TEMPERS = [
  { id: 'lurker', weight: 30, line: 'quiet lurker, rarely reacts', en: 'lurker', zh: '潜水党' },
  { id: 'skeptic', weight: 18, line: 'skeptical, distrusts ads and big claims', en: 'skeptic', zh: '怀疑论者' },
  { id: 'supporter', weight: 12, line: 'supportive, encourages people', en: 'supporter', zh: '热心人' },
  { id: 'enthusiast', weight: 12, line: 'enthusiastic, likes and shares easily', en: 'enthusiast', zh: '热情党' },
  { id: 'bargain_hunter', weight: 10, line: 'bargain hunter, always compares prices', en: 'bargain hunter', zh: '捡漏达人' },
  { id: 'trend_chaser', weight: 8, line: 'chases trends, follows whatever is new', en: 'trend chaser', zh: '追新族' },
  { id: 'nitpicker', weight: 6, line: 'nitpicker, spots every mistake', en: 'nitpicker', zh: '挑剔精' },
  { id: 'troll', weight: 4, line: 'troll, enjoys picking fights', en: 'troll', zh: '杠精' },
];

export const BUDGETS = [
  { id: 'tight', level: -1, line: 'tight budget', group: 'people on a tight budget', en: 'tight budget', zh: '手头紧' },
  { id: 'average', level: 0, line: 'average income', group: 'people with an average income', en: 'average income', zh: '一般收入' },
  { id: 'comfortable', level: 1, line: 'comfortable income', group: 'people with a comfortable income', en: 'comfortable income', zh: '收入宽裕' },
  { id: 'wealthy', level: 2, line: 'wealthy', group: 'wealthy people', en: 'wealthy', zh: '富裕' },
];

/** 消费习惯。中间一档 line 为空：多数人不好不坏，人格行保持简短。 */
export const SPENDING = [
  { id: 'careful', weight: 40, line: 'careful with money', en: 'careful with money', zh: '精打细算' },
  { id: 'neutral', weight: 40, line: '', en: '', zh: '随大流' },
  { id: 'impulsive', weight: 20, line: 'buys on impulse', en: 'buys on impulse', zh: '冲动消费' },
];

/** 人格此刻想买什么；只有闲置转让（listing）和商品（product）预设会把它给 Jev 看。 */
export const SHOPPING = [
  { id: 'nothing', en: 'nothing in particular', zh: '没在想买什么' },
  { id: 'phone', en: 'a phone', zh: '手机' },
  { id: 'laptop', en: 'a laptop', zh: '笔记本电脑' },
  { id: 'car', en: 'a car', zh: '汽车' },
  { id: 'rent', en: 'an apartment to rent', zh: '租房' },
  { id: 'furniture', en: 'furniture', zh: '家具' },
  { id: 'kids', en: "kids' things", zh: '儿童用品' },
  { id: 'clothes', en: 'clothes and shoes', zh: '衣服鞋帽' },
  { id: 'bicycle', en: 'a bicycle', zh: '自行车' },
  { id: 'appliances', en: 'home appliances', zh: '家电' },
  { id: 'garden', en: 'plants and garden tools', zh: '花草园艺' },
  { id: 'sports_gear', en: 'sports gear', zh: '运动装备' },
  { id: 'gift', en: 'a gift', zh: '礼物' },
  { id: 'books', en: 'books', zh: '书' },
  { id: 'console', en: 'a game console', zh: '游戏机' },
  { id: 'beauty', en: 'beauty products', zh: '化妆品' },
  { id: 'pets', en: 'pet supplies', zh: '宠物用品' },
  { id: 'tools', en: 'tools', zh: '工具' },
  { id: 'courses', en: 'an online course', zh: '网课' },
  { id: 'trip', en: 'a vacation trip', zh: '度假' },
];

/** 名字从年轻人常用到老人常用排列，所以名字跟着年龄走（带些随机）。[拼音, 汉字] */
export const POOLS = {
  zh: {
    female: [
      ['Yiran', '依然'], ['Mengqi', '梦琪'], ['Zihan', '梓涵'], ['Xinyi', '欣怡'], ['Wanting', '婉婷'], ['Xiaoyu', '小雨'],
      ['Tingting', '婷婷'], ['Jiahui', '嘉惠'], ['Jingyi', '静怡'], ['Siyu', '思雨'], ['Liling', '丽玲'], ['Chunhua', '春花'],
      ['Xiulan', '秀兰'], ['Yumei', '玉梅'], ['Guiying', '桂英'], ['Xiuying', '秀英'], ['Shufen', '淑芬'], ['Guihua', '桂花'],
      ['Aizhen', '爱珍'], ['Yulan', '玉兰'], ['Ying', '英'], ['Zhen', '珍'], ['Lan', '兰'], ['Qin', '琴'],
    ],
    male: [
      ['Haoran', '浩然'], ['Zixuan', '子轩'], ['Yuchen', '宇辰'], ['Junhao', '俊豪'], ['Mingxuan', '明轩'], ['Ruixiang', '瑞祥'],
      ['Zhiqiang', '志强'], ['Wenjie', '文杰'], ['Honglei', '宏磊'], ['Guodong', '国栋'], ['Jianguo', '建国'], ['Weiguo', '卫国'],
      ['Yongqiang', '永强'], ['Dawei', '大伟'], ['Xiaoming', '小明'], ['Tiezhu', '铁柱'], ['Changgui', '长贵'], ['Youde', '有德'],
      ['Fuquan', '福全'], ['Shuqiang', '树强'], ['Guangkun', '广坤'], ['Laogen', '老根'], ['Shuanzhu', '栓柱'], ['Wangcai', '旺财'],
    ],
    cities: [
      ['Beijing', '北京', 18], ['Shanghai', '上海', 18], ['Shenzhen', '深圳', 13], ['Guangzhou', '广州', 12], ['Chengdu', '成都', 10],
      ['Chongqing', '重庆', 10], ['Hangzhou', '杭州', 9], ['Wuhan', '武汉', 8], ["Xi'an", '西安', 8], ['Nanjing', '南京', 8],
      ['Tianjin', '天津', 7], ['Changsha', '长沙', 6], ['Zhengzhou', '郑州', 6], ['Qingdao', '青岛', 6], ['Suzhou', '苏州', 6],
      ['Hefei', '合肥', 5], ['Shenyang', '沈阳', 4], ['Dalian', '大连', 4], ['Harbin', '哈尔滨', 4], ['Kunming', '昆明', 4],
      ['Dongguan', '东莞', 4], ['Foshan', '佛山', 3], ['a small county town', '一个小县城', 5], ['a village in the south', '南方的一个村子', 3],
    ],
  },
};

const byId = (list) => Object.fromEntries(list.map((item) => [item.id, item]));
export const INTEREST = byId(INTERESTS);
export const JOB = byId(JOBS);
export const AGE_GROUP = byId(AGE_GROUPS);
export const TEMPER = byId(TEMPERS);
export const BUDGET = byId(BUDGETS);
export const SPEND = byId(SPENDING);
export const SHOP = byId(SHOPPING);
