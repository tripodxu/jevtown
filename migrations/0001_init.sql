-- Jevtown CN 的 D1 结构。一次检查 = 一条 post（一个版本）。
-- state: 'running' 波次进行中 / 'done' 检查完成 / 'blocked' 审核拒绝。
CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  preset TEXT NOT NULL,
  pool TEXT NOT NULL DEFAULT 'zh',
  text TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  day TEXT NOT NULL,
  ip TEXT
);

-- 每个版本自己的数据：传播算法的分数、审核与解读结果、当前波次的推进计划、收尾提问的回答。
CREATE TABLE versions (
  post TEXT NOT NULL,
  number INTEGER NOT NULL,
  text TEXT NOT NULL,
  scores TEXT,
  checks TEXT,
  unlisted TEXT,
  blocked TEXT,
  plan TEXT,
  said TEXT,
  usd REAL NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post, number)
);

-- 每个人格对每个版本的反应：wave 是它所在的波次，reaction 是预设里的反应 id。
CREATE TABLE reactions (
  post TEXT NOT NULL,
  number INTEGER NOT NULL,
  id INTEGER NOT NULL,
  wave INTEGER NOT NULL,
  reaction TEXT NOT NULL,
  PRIMARY KEY (post, number, id)
);

-- 每个请求的花费流水：opening / wave<n> / ask。<usd> 按 day 汇总即全站当日花费。
CREATE TABLE batches (
  post TEXT NOT NULL,
  number INTEGER NOT NULL,
  stage TEXT NOT NULL,
  n INTEGER NOT NULL,
  usd REAL NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  day TEXT NOT NULL,
  PRIMARY KEY (post, number, stage, n)
);

CREATE INDEX idx_posts_day_ip ON posts (day, ip);
CREATE INDEX idx_batches_day ON batches (day);
CREATE INDEX idx_reactions_wave ON reactions (post, number, wave);
