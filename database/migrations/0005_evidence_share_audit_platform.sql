-- 0005: 证据 + 共享镜像 + 审计 + 事件Outbox + 平台管理（说明书 10.22/10.23/10.25/21 章 + docs/31）
BEGIN;

-- ============ 10.22 evidence_files 证据资料 ============
CREATE TABLE evidence_files (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id        UUID NOT NULL REFERENCES workspaces(id),
    object_type         VARCHAR(20) NOT NULL,  -- GOODS/DEAL/INSPECTION/CONTRACT
    object_id           UUID NOT NULL,
    evidence_type       VARCHAR(20) NOT NULL,  -- CHAT/PHOTO/SN/BMC/TEST/CONTRACT/INVOICE/LOGISTICS
    file_id             UUID NOT NULL REFERENCES file_objects(id),
    source_party_id     UUID REFERENCES parties(id),
    captured_at         TIMESTAMPTZ,
    verified_by         UUID,
    verification_status VARCHAR(20) NOT NULL DEFAULT 'UNVERIFIED', -- UNVERIFIED/VERIFIED/CONFLICT
    sensitive_level     VARCHAR(20) NOT NULL DEFAULT 'INTERNAL',
    metadata            JSONB NOT NULL DEFAULT '{}',
    created_by          UUID NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ
);
CREATE INDEX idx_evidence_object ON evidence_files(workspace_id, object_type, object_id)
    WHERE deleted_at IS NULL;

-- ============ 10.23 share_projections 共享镜像 ============
-- 个人版与企业版之间最重要的表；一期建表建模型，二期开放功能
-- 企业只能读镜像，禁止跨空间直查个人数据
CREATE TABLE share_projections (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_workspace_id  UUID NOT NULL REFERENCES workspaces(id),
    source_object_type   VARCHAR(20) NOT NULL,  -- GOODS/DEMAND/CONTACT
    source_object_id     UUID NOT NULL,
    target_workspace_id  UUID NOT NULL REFERENCES workspaces(id),
    projection_object_id UUID,                  -- 企业空间内的镜像对象
    field_policy         JSONB NOT NULL,        -- 共享字段白名单规则
    sync_policy          VARCHAR(20) NOT NULL DEFAULT 'MANUAL', -- MANUAL/AUTO/NOTIFY_ONLY
    status               VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE/REVOKED
    revoked_at           TIMESTAMPTZ,
    last_synced_at       TIMESTAMPTZ,
    created_by           UUID NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_object_type, source_object_id, target_workspace_id)
);
CREATE INDEX idx_share_target ON share_projections(target_workspace_id, status);

-- ============ 10.25 audit_logs 业务审计 ============
-- 底价查看/SN下载/批量导出必须单独记录；普通用户不可删除
CREATE TABLE audit_logs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    user_id      UUID NOT NULL,
    action       VARCHAR(50) NOT NULL,
    object_type  VARCHAR(30),
    object_id    UUID,
    before_data  JSONB,
    after_data   JSONB,
    ip_address   INET,
    device_id    VARCHAR(100),
    risk_level   VARCHAR(10) NOT NULL DEFAULT 'LOW',  -- LOW/MEDIUM/HIGH
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_workspace_time ON audit_logs(workspace_id, created_at DESC);
CREATE INDEX idx_audit_risk ON audit_logs(workspace_id, risk_level, created_at DESC)
    WHERE risk_level <> 'LOW';

-- ============ 21 章 事件 Outbox ============
CREATE TABLE event_outbox (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type    VARCHAR(60) NOT NULL,   -- goods.created / quote.sent / share.revoked ...
    workspace_id  UUID,
    payload       JSONB NOT NULL,
    published_at  TIMESTAMPTZ,
    retry_count   INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_outbox_unpublished ON event_outbox(created_at) WHERE published_at IS NULL;

-- ============ 平台运营（docs/31，一期最小集） ============
CREATE TABLE platform_admins (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(128) NOT NULL,
    totp_secret   VARCHAR(64),
    role          VARCHAR(20) NOT NULL DEFAULT 'OPS',  -- SUPER_ADMIN/OPS/SUPPORT/COMPLIANCE
    status        VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE platform_audit_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id    UUID NOT NULL REFERENCES platform_admins(id),
    action      VARCHAR(50) NOT NULL,   -- USER_DISABLE/WORKSPACE_SUSPEND/CONTENT_TAKEDOWN...
    target_type VARCHAR(30) NOT NULL,
    target_id   UUID,
    reason      TEXT NOT NULL,          -- 平台操作必须填写原因
    before_data JSONB,
    after_data  JSONB,
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_platform_audit_time ON platform_audit_logs(created_at DESC);

COMMIT;
