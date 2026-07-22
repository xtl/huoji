-- 0003: 货源核心（说明书 6.4/10.10-10.14/15.1/27 章）
-- 约束：市场货源(goods_offers)与企业实际库存(inventory_lots)分开；价格/数量/状态必须留历史
BEGIN;

-- ============ 10.10 goods_offers 市场货源 ============
CREATE TABLE goods_offers (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id           UUID NOT NULL REFERENCES workspaces(id),
    offer_no               VARCHAR(30) NOT NULL,
    title                  VARCHAR(300),
    record_type            VARCHAR(20) NOT NULL DEFAULT 'MARKET_LEAD', -- MARKET_LEAD/CONTROLLED_STOCK
    direction              VARCHAR(10) NOT NULL DEFAULT 'SELL',        -- SELL/SUPPLY
    product_category       VARCHAR(20) NOT NULL,   -- SERVER/GPU/BASEBOARD/PART
    gpu_model              VARCHAR(50),            -- 标准化后：H100/H200/B200/B300...
    gpu_form_factor        VARCHAR(20),            -- SXM/PCIE/NVL/HGX
    gpu_count              INTEGER,
    server_brand           VARCHAR(50),
    server_model           VARCHAR(100),
    cpu_spec               JSONB,
    memory_spec            JSONB,
    storage_spec           JSONB,
    network_spec           JSONB,
    cooling_type           VARCHAR(10),            -- AIR/LIQUID
    quantity_total         NUMERIC(12,2),
    quantity_available     NUMERIC(12,2),
    quantity_unit          VARCHAR(10),            -- 台/套/块
    minimum_order_quantity NUMERIC(12,2),
    condition              VARCHAR(20),            -- NEW/USED/REFURBISHED
    package_status         VARCHAR(20),            -- SEALED/OPENED/UNKNOWN
    availability_type      VARCHAR(20),            -- SPOT/NEAR_SPOT/FUTURES
    location_country       VARCHAR(10),
    location_province      VARCHAR(50),
    location_city          VARCHAR(50),
    delivery_days_min      INTEGER,
    delivery_days_max      INTEGER,
    owner_party_id         UUID REFERENCES parties(id),  -- 实际货主（敏感字段）
    source_party_id        UUID REFERENCES parties(id),  -- 当前信息来源（敏感字段）
    status                 VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    -- DRAFT/PARSING/NEED_CONFIRMATION/UNVERIFIED/VERIFIED/SELLABLE/RESERVED/
    -- PARTIALLY_SOLD/SOLD_OUT/EXPIRED/INVALID/CANCELLED  （15.1 状态机由应用层校验流转）
    verification_level     VARCHAR(5) NOT NULL DEFAULT 'L0',  -- L0-L4
    trust_score            NUMERIC(5,2),
    completeness_score     NUMERIC(5,2),
    freshness_at           TIMESTAMPTZ,
    expires_at             TIMESTAMPTZ,
    raw_summary            TEXT,
    normalized_spec        JSONB,
    ai_confidence          NUMERIC(4,3),
    capture_item_id        UUID REFERENCES capture_items(id),  -- AI 追溯链路
    data_classification    VARCHAR(20) NOT NULL DEFAULT 'INTERNAL',
    visibility_scope       VARCHAR(20) NOT NULL DEFAULT 'PRIVATE',
    department_id          UUID REFERENCES departments(id),
    project_group_id       UUID,
    takedown_at            TIMESTAMPTZ,
    takedown_reason        TEXT,
    owner_user_id          UUID,
    created_by             UUID NOT NULL,
    updated_by             UUID,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at             TIMESTAMPTZ,
    version                INTEGER NOT NULL DEFAULT 1,
    UNIQUE (workspace_id, offer_no)
);

-- 第 27 章关键索引（软删除条件索引）
CREATE INDEX idx_goods_workspace_status  ON goods_offers(workspace_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_goods_workspace_gpu     ON goods_offers(workspace_id, gpu_model) WHERE deleted_at IS NULL;
CREATE INDEX idx_goods_workspace_location ON goods_offers(workspace_id, location_city) WHERE deleted_at IS NULL;
CREATE INDEX idx_goods_freshness         ON goods_offers(workspace_id, freshness_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_goods_owner_party       ON goods_offers(workspace_id, owner_party_id) WHERE deleted_at IS NULL;

-- ============ 10.11 goods_offer_versions 版本快照 ============
-- 禁止只覆盖原值不留历史
CREATE TABLE goods_offer_versions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goods_offer_id UUID NOT NULL REFERENCES goods_offers(id),
    version_no     INTEGER NOT NULL,
    spec_snapshot     JSONB NOT NULL,
    quantity_snapshot JSONB NOT NULL,
    price_snapshot    JSONB,
    status_snapshot   VARCHAR(30) NOT NULL,
    change_source  VARCHAR(20) NOT NULL,   -- USER/AI/IMPORT/SYSTEM
    change_reason  TEXT,
    created_by     UUID NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (goods_offer_id, version_no)
);

-- ============ 10.12 goods_price_history ============
-- 底价/成本价/对外价分行保存，禁止单一 price 字段
CREATE TABLE goods_price_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goods_offer_id  UUID NOT NULL REFERENCES goods_offers(id),
    price_type      VARCHAR(20) NOT NULL,  -- OWNER_PRICE/COST_PRICE/EXTERNAL_PRICE
    amount          NUMERIC(16,2) NOT NULL,
    currency        VARCHAR(10) NOT NULL DEFAULT 'CNY',
    unit            VARCHAR(10) NOT NULL DEFAULT 'PER_UNIT',  -- PER_UNIT/TOTAL
    tax_included    BOOLEAN,
    tax_rate        NUMERIC(5,4),
    valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_until     TIMESTAMPTZ,
    source_party_id UUID REFERENCES parties(id),
    created_by      UUID NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_price_hist_goods ON goods_price_history(goods_offer_id, price_type, valid_from DESC);

-- ============ 10.13 goods_quantity_history ============
CREATE TABLE goods_quantity_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goods_offer_id  UUID NOT NULL REFERENCES goods_offers(id),
    quantity_before NUMERIC(12,2),
    quantity_after  NUMERIC(12,2) NOT NULL,
    quantity_delta  NUMERIC(12,2),
    reason          VARCHAR(30) NOT NULL,
    -- INITIAL/UPDATED_BY_SOURCE/RESERVED/RELEASED/SOLD/EXPIRED/MANUAL_CORRECTION
    notes           TEXT,
    created_by      UUID NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_qty_hist_goods ON goods_quantity_history(goods_offer_id, created_at DESC);

-- ============ 10.14 inventory_lots 企业实际库存 ============
-- 只有完成真实控制/采购/代销确认后才能创建
CREATE TABLE inventory_lots (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id           UUID NOT NULL REFERENCES workspaces(id),
    source_goods_offer_id  UUID REFERENCES goods_offers(id),
    inventory_type         VARCHAR(20) NOT NULL,  -- OWNED/CONSIGNED/RESERVED
    warehouse_location     VARCHAR(200),
    quantity_on_hand       NUMERIC(12,2) NOT NULL DEFAULT 0,
    quantity_reserved      NUMERIC(12,2) NOT NULL DEFAULT 0,
    quantity_available     NUMERIC(12,2) NOT NULL DEFAULT 0,
    acquisition_cost       NUMERIC(16,2),
    ownership_document_id  UUID REFERENCES file_objects(id),
    inventory_status       VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    data_classification    VARCHAR(20) NOT NULL DEFAULT 'CONFIDENTIAL',
    visibility_scope       VARCHAR(20) NOT NULL DEFAULT 'DEPARTMENT',
    department_id          UUID REFERENCES departments(id),
    project_group_id       UUID,
    owner_user_id          UUID,
    created_by             UUID NOT NULL,
    updated_by             UUID,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at             TIMESTAMPTZ,
    version                INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_inventory_workspace ON inventory_lots(workspace_id) WHERE deleted_at IS NULL;

-- 货源关联联系人（货主/渠道/居间链路）
CREATE TABLE goods_parties (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goods_offer_id UUID NOT NULL REFERENCES goods_offers(id),
    party_id       UUID NOT NULL REFERENCES parties(id),
    role           VARCHAR(30) NOT NULL,   -- OWNER/CHANNEL/BROKER/SOURCE
    chain_position SMALLINT,               -- 链路位置：货主=0，向下递增
    commission_note TEXT,                  -- 敏感字段
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (goods_offer_id, party_id, role)
);

COMMIT;
