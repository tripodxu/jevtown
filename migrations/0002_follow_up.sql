-- 追问阶段的结果：{ answers, asked, totals }（answers 是题面，totals 是各答案概率和）。
ALTER TABLE versions ADD COLUMN follow_up TEXT;
-- 商品预设的价格阶梯（JSON 数组，如 [9,19,39,79]），需求曲线按它展开。
ALTER TABLE versions ADD COLUMN prices TEXT;
