-- 作者自述的受众与挑中的组（R35）：「这段话是给谁的」对账表的原料。
-- 一列 TEXT 存 JSON { said, picked }，形状与 away / said 一致。NULL = 这次发帖
-- 作者没填（表单那一行可以不填），NULL 时报告整节不渲染，旧存档一字不变。
-- 放 versions 不放 posts：改一版时「给谁看」跟文本一起改，跟文本同生共死。
ALTER TABLE versions ADD COLUMN audience TEXT;
