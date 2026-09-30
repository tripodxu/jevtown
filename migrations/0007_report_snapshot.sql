-- 报告快照列（R25）：报告冻结后 looks/reach 两份字节永不变化，收波时快照进 versions，
-- showPost 从"每次读 1 万行 reactions"降到"读 1 行"（D1 按 rows_read 计费）。
-- running 中的版本两列为 NULL，走既有逐行路径（实时语义不变）。
ALTER TABLE versions ADD COLUMN looks TEXT;
ALTER TABLE versions ADD COLUMN reach TEXT;
