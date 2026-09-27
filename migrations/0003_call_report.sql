-- Jev 调用报告所需字段：
-- batches.ms      该请求的模型耗时（毫秒），报告的分阶段耗时条用它。
-- versions.provider 开局时用的通道（mock/typesafe/openrouter），报告头部展示。
ALTER TABLE batches ADD COLUMN ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE versions ADD COLUMN provider TEXT;
