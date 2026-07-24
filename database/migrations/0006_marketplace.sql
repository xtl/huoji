-- 0006: 广场公开发布层（核心功能锁定：录入 / 我的货源 / 广场）
-- 原则：广场不直接公开 goods_offers / demands 原表，只发布脱敏快照。
BEGIN;

CREATE TABLE marketplace_posts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id),
    post_type       VARCHAR(20) NOT NULL, -- GOODS/DEMAND
    source_type     VARCHAR(20) NOT NULL, -- GOODS/DEMAND/MANUAL
    source_id       UUID,
    title           VARCHAR(300) NOT NULL,
    summary         TEXT,
    product_category VARCHAR(20),
    gpu_model       VARCHAR(50),
    gpu_count       INTEGER,
    quantity        NUMERIC(12,2),
    quantity_unit   VARCHAR(10),
    location_city   VARCHAR(50),
    price_amount    NUMERIC(16,2),
    currency        VARCHAR(10) NOT NULL DEFAULT 'CNY',
    contact_method  VARCHAR(200),
    snapshot        JSONB NOT NULL DEFAULT '{}',
    status          VARCHAR(20) NOT NULL DEFAULT 'PUBLISHED', -- PUBLISHED/PAUSED/CLOSED/TAKEN_DOWN
    published_by    UUID NOT NULL REFERENCES users(id),
    published_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at       TIMESTAMPTZ,
    takedown_at     TIMESTAMPTZ,
    takedown_reason TEXT,
    deleted_at      TIMESTAMPTZ,
    version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT chk_marketplace_post_type CHECK (post_type IN ('GOODS','DEMAND')),
    CONSTRAINT chk_marketplace_source_type CHECK (source_type IN ('GOODS','DEMAND','MANUAL'))
);

CREATE INDEX idx_marketplace_status_time
    ON marketplace_posts(status, published_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_marketplace_workspace
    ON marketplace_posts(workspace_id, published_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_marketplace_gpu
    ON marketplace_posts(post_type, gpu_model, location_city)
    WHERE deleted_at IS NULL AND status = 'PUBLISHED';

COMMIT;
