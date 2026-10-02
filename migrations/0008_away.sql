-- 逐句消融结果（R32）：「哪一句在撑」——删掉第 i 句后各组读数的差（public/shared/away.js）。
-- 一列 TEXT 存 JSON，形状与 said / follow_up / prices 一致。NULL = 还没算过
-- （按钮触发，不阻塞主流程）；算过一次就固定下来，回访不重复花钱。
ALTER TABLE versions ADD COLUMN away TEXT;