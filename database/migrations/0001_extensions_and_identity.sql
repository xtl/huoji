-- 0001: 扩展 + 身份与工作空间（说明书 6.1/6.2/10.1-10.4 章）
BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- 模糊搜索
-- pgvector 由 AI 相关迁移按需启用：CREATE EXTENSION vector;

-- ============ users ============
CREATE TABLE users (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name         VARCHAR(100) NOT NULL,
    avatar_url           TEXT,
    mobile               VARCHAR(32),                -- 应用层加密存储
    status               VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE/DISABLED
    default_workspace_id UUID,
    last_login_at        TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 登录身份（微信 openid/unionid、手机号等，一个用户多身份）
CREATE TABLE user_identities (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id),
    identity_type VARCHAR(30) NOT NULL,   -- WECHAT_MINIAPP/WECHAT_UNION/MOBILE
    identifier    VARCHAR(191) NOT NULL,  -- openid/unionid/手机号哈希
    credentials   JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (identity_type, identifier)
);

CREATE TABLE user_sessions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES users(id),
    refresh_token_hash VARCHAR(128) NOT NULL,
    device_id          VARCHAR(100),
    device_info        JSONB,
    ip_address         INET,
    expires_at         TIMESTAMPTZ NOT NULL,
    revoked_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user ON user_sessions(user_id) WHERE revoked_at IS NULL;

-- ============ organizations / workspaces ============
CREATE TABLE organizations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         VARCHAR(200) NOT NULL,
    license_no   VARCHAR(100),
    verified_at  TIMESTAMPTZ,             -- 企业认证时间（平台侧审核）
    status       VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_by   UUID NOT NULL REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type            VARCHAR(20) NOT NULL,  -- PERSONAL/ENTERPRISE
    name            VARCHAR(200) NOT NULL,
    owner_user_id   UUID REFERENCES users(id),        -- 个人空间所有者
    organization_id UUID REFERENCES organizations(id),-- 企业空间
    status          VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE/SUSPENDED
    plan_code       VARCHAR(50) NOT NULL DEFAULT 'FREE',
    settings        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_ws_type CHECK (type IN ('PERSONAL','ENTERPRISE')),
    CONSTRAINT chk_ws_owner CHECK (
        (type = 'PERSONAL'   AND owner_user_id IS NOT NULL) OR
        (type = 'ENTERPRISE' AND organization_id IS NOT NULL)
    )
);
-- 一个用户只能有一个个人空间
CREATE UNIQUE INDEX uq_personal_workspace ON workspaces(owner_user_id) WHERE type = 'PERSONAL';

ALTER TABLE users ADD CONSTRAINT fk_users_default_ws
    FOREIGN KEY (default_workspace_id) REFERENCES workspaces(id);

CREATE TABLE departments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    name         VARCHAR(100) NOT NULL,
    parent_id    UUID REFERENCES departments(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10.3 memberships：离职只改 LEFT，禁止删除
CREATE TABLE memberships (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  UUID NOT NULL REFERENCES workspaces(id),
    user_id       UUID NOT NULL REFERENCES users(id),
    department_id UUID REFERENCES departments(id),
    status        VARCHAR(20) NOT NULL DEFAULT 'INVITED',  -- INVITED/ACTIVE/LEFT
    data_scope    VARCHAR(20) NOT NULL DEFAULT 'SELF',     -- SELF/DEPARTMENT/ALL
    joined_at     TIMESTAMPTZ,
    left_at       TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
);
CREATE INDEX idx_membership_user ON memberships(user_id) WHERE status = 'ACTIVE';

-- ============ RBAC（一期建表，二期开放完整配置） ============
CREATE TABLE roles (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    code         VARCHAR(50) NOT NULL,
    name         VARCHAR(100) NOT NULL,
    is_system    BOOLEAN NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, code)
);

CREATE TABLE role_permissions (
    role_id         UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_code VARCHAR(100) NOT NULL,   -- goods.read_cost / quote.approve 等
    PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE membership_roles (
    membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
    role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (membership_id, role_id)
);

COMMIT;
