-- 0004: 求购 + 匹配候选 + 报价 + 任务/通知（说明书 10.15-10.21/10.24 章）
BEGIN;

-- ============ 10.15 demands ============
CREATE TABLE demands (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id           UUID NOT NULL REFERENCES workspaces(id),
    demand_no              VARCHAR(30) NOT NULL,
    buyer_party_id         UUID REFERENCES parties(id),
    product_category       VARCHAR(20),
    gpu_model              VARCHAR(50),
    gpu_count              INTEGER,
    brand_requirements     JSONB,
    required_spec          JSONB,
    quantity_required      NUMERIC(12,2),
    budget_min             NUMERIC(16,2),
    budget_max             NUMERIC(16,2),
    currency               VARCHAR(10) NOT NULL DEFAULT 'CNY',
    tax_required           BOOLEAN,
    location_requirement   VARCHAR(200),
    condition_requirement  VARCHAR(50),
    warranty_requirement   VARCHAR(200),
    inspection_requirement VARCHAR(200),
    delivery_deadline      DATE,
    priority               VARCHAR(10) NOT NULL DEFAULT 'MEDIUM',  -- LOW/MEDIUM/HIGH/URGENT
    status                 VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    -- DRAFT/ACTIVE/MATCHING/CANDIDATES_FOUND/QUOTED/NEGOTIATING/FULFILLED/EXPIRED/CLOSED/CANCELLED
    capture_item_id        UUID REFERENCES capture_items(id),
    owner_user_id          UUID,
    created_by             UUID NOT NULL,
    updated_by             UUID,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at             TIMESTAMPTZ,
    version                INTEGER NOT NULL DEFAULT 1,
    UNIQUE (workspace_id, demand_no)
);
CREATE INDEX idx_demand_workspace_status ON demands(workspace_id, status) WHERE deleted_at IS NULL;

-- ============ 10.16 match_candidates ============
-- 匹配=推荐+用户确认；禁止自动成交/自动建项目
CREATE TABLE match_candidates (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id       UUID NOT NULL REFERENCES workspaces(id),
    demand_id          UUID NOT NULL REFERENCES demands(id),
    goods_offer_id     UUID NOT NULL REFERENCES goods_offers(id),
    match_score        NUMERIC(5,2),
    spec_score         NUMERIC(5,2),
    price_score        NUMERIC(5,2),
    location_score     NUMERIC(5,2),
    delivery_score     NUMERIC(5,2),
    verification_score NUMERIC(5,2),
    match_reason       JSONB,
    status             VARCHAR(20) NOT NULL DEFAULT 'RECOMMENDED', -- RECOMMENDED/SELECTED/REJECTED
    rejected_reason    TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (demand_id, goods_offer_id)
);

-- ============ 10.19 quotes ============
CREATE TABLE quotes (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id       UUID NOT NULL REFERENCES workspaces(id),
    quote_no           VARCHAR(30) NOT NULL,
    deal_id            UUID,                    -- 交易项目二/三期启用，先留列
    buyer_party_id     UUID REFERENCES parties(id),
    status             VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    -- DRAFT/PENDING_APPROVAL/APPROVED/REJECTED/SENT/VIEWED/ACCEPTED/DECLINED/EXPIRED/REVOKED
    current_version_no INTEGER NOT NULL DEFAULT 1,
    valid_until        TIMESTAMPTZ,
    total_amount       NUMERIC(16,2),
    currency           VARCHAR(10) NOT NULL DEFAULT 'CNY',
    tax_included       BOOLEAN,
    margin_amount      NUMERIC(16,2),           -- 敏感字段
    margin_rate        NUMERIC(6,4),            -- 敏感字段
    approval_required  BOOLEAN NOT NULL DEFAULT false,
    sent_at            TIMESTAMPTZ,
    accepted_at        TIMESTAMPTZ,
    owner_user_id      UUID,
    created_by         UUID NOT NULL,
    updated_by         UUID,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at         TIMESTAMPTZ,
    version            INTEGER NOT NULL DEFAULT 1,
    UNIQUE (workspace_id, quote_no)
);
CREATE INDEX idx_quote_workspace ON quotes(workspace_id, status) WHERE deleted_at IS NULL;

-- 10.20 每轮报价新版本，已发送禁止修改
CREATE TABLE quote_versions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id       UUID NOT NULL REFERENCES quotes(id),
    version_no     INTEGER NOT NULL,
    quote_snapshot JSONB NOT NULL,   -- 报价快照
    cost_snapshot  JSONB,            -- 成本快照（敏感）
    terms_snapshot JSONB,
    pdf_file_id    UUID REFERENCES file_objects(id),
    change_reason  TEXT,
    created_by     UUID NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (quote_id, version_no)
);

-- 10.21 报价明细：使用快照，货源改价不影响已发报价
CREATE TABLE quote_items (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id       UUID NOT NULL REFERENCES quotes(id),
    goods_offer_id UUID REFERENCES goods_offers(id),
    item_name      VARCHAR(300) NOT NULL,
    spec_snapshot  JSONB,
    quantity       NUMERIC(12,2) NOT NULL,
    unit_price     NUMERIC(16,2) NOT NULL,
    total_price    NUMERIC(16,2) NOT NULL,
    cost_price     NUMERIC(16,2),   -- 敏感字段
    margin_amount  NUMERIC(16,2),   -- 敏感字段
    tax_rate       NUMERIC(5,4),
    delivery_terms VARCHAR(300),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ 10.24 tasks 待办 ============
CREATE TABLE tasks (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id     UUID NOT NULL REFERENCES workspaces(id),
    related_type     VARCHAR(20),   -- GOODS/DEMAND/DEAL/QUOTE
    related_id       UUID,
    title            VARCHAR(300) NOT NULL,
    description      TEXT,
    assignee_user_id UUID REFERENCES users(id),
    due_at           TIMESTAMPTZ,
    priority         VARCHAR(10) NOT NULL DEFAULT 'MEDIUM',
    status           VARCHAR(20) NOT NULL DEFAULT 'TODO',  -- TODO/DOING/DONE/CANCELLED
    source           VARCHAR(10) NOT NULL DEFAULT 'MANUAL', -- MANUAL/SYSTEM/AI
    completed_at     TIMESTAMPTZ,
    created_by       UUID NOT NULL,
    updated_by       UUID,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ,
    version          INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_task_assignee_due ON tasks(workspace_id, assignee_user_id, status, due_at)
    WHERE deleted_at IS NULL;

-- 通知
CREATE TABLE notifications (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    user_id      UUID NOT NULL REFERENCES users(id),
    channel      VARCHAR(20) NOT NULL DEFAULT 'IN_APP', -- IN_APP/MINIAPP_SUBSCRIBE/SMS
    type         VARCHAR(50) NOT NULL,
    title        VARCHAR(200) NOT NULL,
    content      TEXT,
    related_type VARCHAR(20),
    related_id   UUID,
    read_at      TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notification_user ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;

COMMIT;
