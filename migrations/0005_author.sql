-- 写操作（batch/wave/version）的作者令牌：/api/check 开局时生成，随 x-jev-author 请求头带回。
-- 升级前的旧本地帖 author 为 NULL，其写操作将一律 403——本地开发重开一个检查即可。
ALTER TABLE posts ADD COLUMN author TEXT;
