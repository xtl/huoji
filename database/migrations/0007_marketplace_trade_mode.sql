-- 0007: 广场交易类型维度（现货 / 期货 / 租赁）
-- 广场分类使用两层维度：trade_mode × post_type
-- trade_mode: SPOT/FUTURES/RENTAL；post_type: GOODS/DEMAND
BEGIN;

ALTER TABLE marketplace_posts
    ADD COLUMN trade_mode VARCHAR(20) NOT NULL DEFAULT 'SPOT',
    ADD CONSTRAINT chk_marketplace_trade_mode CHECK (trade_mode IN ('SPOT','FUTURES','RENTAL'));

CREATE INDEX idx_marketplace_mode_type
    ON marketplace_posts(trade_mode, post_type, published_at DESC)
    WHERE deleted_at IS NULL AND status = 'PUBLISHED';

COMMIT;
