-- 0002: 联系人主体 + 文件 + 原始采集与 AI 任务（说明书 6.7/6.12/10.5-10.9/20 章）
BEGIN;

-- ============ 10.5 party 业务主体 ============
CREATE TABLE parties (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id      UUID NOT NULL REFERENCES workspaces(id),
    party_type        VARCHAR(20) NOT NULL,   -- PERSON/COMPANY
    display_name      VARCHAR(200) NOT NULL,
    mobile            VARCHAR(64),            -- 应用层加密
    email             VARCHAR(191),
    country_code      VARCHAR(10),
    province          VARCHAR(50),
    city              VARCHAR(50),
    company_parent_id UUID REFERENCES parties(id),   -- 个人所属公司
    source            VARCHAR(20) NOT NULL DEFAULT 'MANUAL',  -- MANUAL/AI/IMPORT
    owner_user_id     UUID REFERENCES users(id),
    trust_level       VARCHAR(20),
    notes             TEXT,
    extra             JSONB NOT NULL DEFAULT '{}',
    created_by        UUID NOT NULL,
    updated_by        UUID,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ,
    version           INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_party_workspace ON parties(workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_party_name_trgm ON parties USING gin (display_name gin_trgm_ops);

-- 10.6 主体角色：一个主体多角色
CREATE TABLE party_roles (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    party_id   UUID NOT NULL REFERENCES parties(id),
    role       VARCHAR(30) NOT NULL,
    -- OWNER/SUPPLIER/CHANNEL/BROKER/BUYER/PROCUREMENT/INSPECTOR/LOGISTICS/SERVICE_PROVIDER
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (party_id, role)
);

-- 10.7 关系图谱：货源链路以关系节点保存
CREATE TABLE party_relations (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  UUID NOT NULL REFERENCES workspaces(id),
    from_party_id UUID NOT NULL REFERENCES parties(id),
    to_party_id   UUID NOT NULL REFERENCES parties(id),
    relation_type VARCHAR(30) NOT NULL,  -- INTRODUCED_BY/CONTROLS/WORKS_FOR/COOPERATES_WITH
    strength      SMALLINT,
    started_at    TIMESTAMPTZ,
    ended_at      TIMESTAMPTZ,
    notes         TEXT,
    created_by    UUID NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_party_rel_from ON party_relations(workspace_id, from_party_id);

-- ============ 20.2 file_objects ============
CREATE TABLE file_objects (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id     UUID NOT NULL REFERENCES workspaces(id),
    object_key       VARCHAR(500) NOT NULL,       -- 对象存储 key，禁止存二进制
    original_name    VARCHAR(255),
    mime_type        VARCHAR(100),
    size             BIGINT,
    sha256           VARCHAR(64),
    perceptual_hash  VARCHAR(64),                 -- 重复识别用
    storage_provider VARCHAR(30) NOT NULL DEFAULT 'oss',
    upload_status    VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING/DONE/FAILED
    scan_status      VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    ocr_status       VARCHAR(20) NOT NULL DEFAULT 'NONE',
    ocr_text         TEXT,
    takedown_at      TIMESTAMPTZ,                 -- 平台下架（docs/31）
    takedown_reason  TEXT,
    created_by       UUID NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ
);
CREATE INDEX idx_file_workspace ON file_objects(workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_file_sha ON file_objects(sha256);

-- ============ 10.8 capture_items 原始采集 ============
-- 任何 AI 结构化数据必须可追溯到 CaptureItem
CREATE TABLE capture_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id      UUID NOT NULL REFERENCES workspaces(id),
    capture_type      VARCHAR(20) NOT NULL,   -- TEXT/IMAGE/AUDIO/DOCUMENT
    raw_text          TEXT,
    file_id           UUID REFERENCES file_objects(id),
    source_channel    VARCHAR(20) NOT NULL DEFAULT 'MANUAL', -- WECHAT/MANUAL/IMPORT/CAMERA
    processing_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',-- PENDING/PROCESSING/DONE/FAILED
    target_type       VARCHAR(20),            -- GOODS/DEMAND/CONTACT/UNKNOWN
    confirmed         BOOLEAN NOT NULL DEFAULT false,
    confirmed_by      UUID,
    confirmed_at      TIMESTAMPTZ,
    takedown_at       TIMESTAMPTZ,
    takedown_reason   TEXT,
    created_by        UUID NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);
CREATE INDEX idx_capture_workspace ON capture_items(workspace_id, processing_status)
    WHERE deleted_at IS NULL;

-- ============ 10.9 ai_extraction_jobs ============
CREATE TABLE ai_extraction_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    capture_item_id UUID NOT NULL REFERENCES capture_items(id),
    model_provider  VARCHAR(50) NOT NULL,
    model_name      VARCHAR(100) NOT NULL,
    schema_version  VARCHAR(20) NOT NULL,
    request_payload JSONB,          -- 脱敏后的请求
    result_payload  JSONB,          -- 原始结构化结果（含 field_confidence/missing_fields/conflicts）
    token_usage     JSONB,
    cost_amount     NUMERIC(12,6),
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    error_message   TEXT,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_job_capture ON ai_extraction_jobs(capture_item_id);
CREATE INDEX idx_ai_job_cost ON ai_extraction_jobs(created_at, model_provider);

COMMIT;
