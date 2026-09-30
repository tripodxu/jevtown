-- feed 列表按 created_at 倒序取 20 条：此前是全表扫描 + 临时 B 树排序（EXPLAIN QUERY PLAN 实证），
-- 线上 posts 增长后每次打开首页都付出代价。SQLite 可以反向扫描索引，单个升序索引即可。
CREATE INDEX idx_posts_created ON posts (created_at);
