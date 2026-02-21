-- ============================================================
-- Company AI Desktop — Initial Database Migration
-- PostgreSQL 16+
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid(), crypt()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- fuzzy search on email/name

-- ─────────────────────────────────────────────────────────────
-- DOMAIN ALLOWLIST
-- ─────────────────────────────────────────────────────────────
CREATE TABLE allowed_email_domains (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain      VARCHAR(255) NOT NULL UNIQUE,   -- e.g. "company.com"
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by  UUID
);

-- ─────────────────────────────────────────────────────────────
-- USERS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE users (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                VARCHAR(255) NOT NULL UNIQUE,
    email_domain         VARCHAR(100) NOT NULL,
    display_name         VARCHAR(255),
    avatar_url           TEXT,
    role                 VARCHAR(50) NOT NULL DEFAULT 'user'
                           CHECK (role IN ('user', 'admin', 'super_admin')),
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    is_locked            BOOLEAN NOT NULL DEFAULT FALSE,
    locked_reason        TEXT,
    locked_at            TIMESTAMPTZ,
    locked_by            UUID REFERENCES users(id),
    mfa_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret_encrypted TEXT,               -- AES-256-GCM encrypted TOTP secret
    last_login_at        TIMESTAMPTZ,
    login_count          BIGINT NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email        ON users (email);
CREATE INDEX idx_users_email_domain ON users (email_domain);
CREATE INDEX idx_users_role         ON users (role);
CREATE INDEX idx_users_email_trgm   ON users USING gin (email gin_trgm_ops);

-- ─────────────────────────────────────────────────────────────
-- USER QUOTAS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE user_quotas (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    daily_token_limit     INTEGER NOT NULL DEFAULT 100000,
    monthly_token_limit   INTEGER NOT NULL DEFAULT 2000000,
    context_window_limit  INTEGER NOT NULL DEFAULT 128000,   -- max per conversation
    max_concurrent_chats  INTEGER NOT NULL DEFAULT 20,
    daily_tokens_used     INTEGER NOT NULL DEFAULT 0,
    monthly_tokens_used   INTEGER NOT NULL DEFAULT 0,
    daily_reset_at        TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 day'),
    monthly_reset_at      TIMESTAMPTZ NOT NULL
                           DEFAULT (date_trunc('month', NOW()) + INTERVAL '1 month'),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- USER PREFERENCES
-- ─────────────────────────────────────────────────────────────
CREATE TABLE user_preferences (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    preferred_provider  VARCHAR(50),
    preferred_model     VARCHAR(100),
    theme               VARCHAR(50)  NOT NULL DEFAULT 'system'
                          CHECK (theme IN ('light', 'dark', 'system')),
    accent_color        VARCHAR(50)  NOT NULL DEFAULT 'blue',
    font_size           SMALLINT     NOT NULL DEFAULT 15,
    reduced_motion      BOOLEAN      NOT NULL DEFAULT FALSE,
    compact_mode        BOOLEAN      NOT NULL DEFAULT FALSE,
    sidebar_width       SMALLINT     NOT NULL DEFAULT 240,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- SESSIONS (refresh token store)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE user_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash  VARCHAR(255) NOT NULL,   -- bcrypt hash
    device_id           VARCHAR(255),
    device_name         VARCHAR(500),
    platform            VARCHAR(100),
    ip_address          INET,
    user_agent          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL,
    is_revoked          BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at          TIMESTAMPTZ,
    revoked_reason      VARCHAR(255),
    -- family token chain (detect refresh token reuse)
    family_id           UUID NOT NULL DEFAULT gen_random_uuid()
);

CREATE INDEX idx_user_sessions_user_id    ON user_sessions (user_id);
CREATE INDEX idx_user_sessions_family_id  ON user_sessions (family_id);
CREATE INDEX idx_user_sessions_device_id  ON user_sessions (device_id);

-- ─────────────────────────────────────────────────────────────
-- MAGIC LINKS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE magic_links (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(64) NOT NULL UNIQUE,  -- SHA-256 hex of raw token
    email       VARCHAR(255) NOT NULL,
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
    used_at     TIMESTAMPTZ,
    attempt_count SMALLINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_magic_links_token_hash ON magic_links (token_hash);
CREATE INDEX idx_magic_links_user_id    ON magic_links (user_id);

-- ─────────────────────────────────────────────────────────────
-- AI PROVIDERS + MODELS (DB-driven config)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE ai_providers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(50)  NOT NULL UNIQUE,  -- openai | anthropic | gemini
    display_name    VARCHAR(100) NOT NULL,
    is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    secret_key_name VARCHAR(200) NOT NULL,          -- key in secret manager
    base_url        TEXT,                           -- optional override
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ai_models (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id            UUID NOT NULL REFERENCES ai_providers(id),
    model_id               VARCHAR(200) NOT NULL,  -- e.g. gpt-4o-2024-11-20
    display_name           VARCHAR(200) NOT NULL,
    context_window         INTEGER NOT NULL,
    max_output_tokens      INTEGER,
    supports_vision        BOOLEAN NOT NULL DEFAULT FALSE,
    supports_tools         BOOLEAN NOT NULL DEFAULT FALSE,
    supports_streaming     BOOLEAN NOT NULL DEFAULT TRUE,
    is_enabled             BOOLEAN NOT NULL DEFAULT TRUE,
    is_beta                BOOLEAN NOT NULL DEFAULT FALSE,
    cost_per_input_token   NUMERIC(16, 10),  -- USD per token
    cost_per_output_token  NUMERIC(16, 10),
    feature_flags          JSONB NOT NULL DEFAULT '{}',
    sort_order             SMALLINT NOT NULL DEFAULT 0,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider_id, model_id)
);

CREATE INDEX idx_ai_models_provider_id ON ai_models (provider_id);
CREATE INDEX idx_ai_models_enabled     ON ai_models (is_enabled);

-- Seed default providers
INSERT INTO ai_providers (name, display_name, is_enabled, secret_key_name) VALUES
  ('openai',    'OpenAI',         TRUE, 'OPENAI_API_KEY'),
  ('anthropic', 'Anthropic',      TRUE, 'ANTHROPIC_API_KEY'),
  ('gemini',    'Google Gemini',  TRUE, 'GEMINI_API_KEY');

-- Seed default models
INSERT INTO ai_models (provider_id, model_id, display_name, context_window, max_output_tokens, supports_vision, supports_tools, is_enabled, sort_order) VALUES
  -- OpenAI
  ((SELECT id FROM ai_providers WHERE name = 'openai'), 'gpt-5-mini-2025-08-07',  'GPT Fast',       128000, 16384, TRUE,  TRUE,  TRUE, 0),
  ((SELECT id FROM ai_providers WHERE name = 'openai'), 'gpt-5.2-2025-12-11',     'GPT Advanced',   128000, 16384, TRUE,  TRUE,  TRUE, 1),
  -- Anthropic
  ((SELECT id FROM ai_providers WHERE name = 'anthropic'), 'claude-haiku-4-5-20251001', 'Claude Fast',    200000, 8192, TRUE, TRUE, TRUE, 0),
  ((SELECT id FROM ai_providers WHERE name = 'anthropic'), 'claude-sonnet-4-6',         'Claude Advanced', 200000, 8192, TRUE, TRUE, TRUE, 1),
  -- Gemini
  ((SELECT id FROM ai_providers WHERE name = 'gemini'), 'gemini-3-flash-preview', 'Gemini Fast',     1048576, 8192, TRUE, TRUE, TRUE, 0),
  ((SELECT id FROM ai_providers WHERE name = 'gemini'), 'gemini-3-pro-preview',   'Gemini Advanced', 1048576, 8192, TRUE, TRUE, TRUE, 1);

-- ─────────────────────────────────────────────────────────────
-- CHAT FOLDERS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE chat_folders (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    color       VARCHAR(50),
    icon        VARCHAR(50),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_folders_user_id ON chat_folders (user_id);

-- ─────────────────────────────────────────────────────────────
-- CHAT SESSIONS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE chat_sessions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id         UUID REFERENCES chat_folders(id) ON DELETE SET NULL,
    title             VARCHAR(500),
    is_pinned         BOOLEAN NOT NULL DEFAULT FALSE,
    is_ephemeral      BOOLEAN NOT NULL DEFAULT FALSE,
    provider          VARCHAR(50) NOT NULL,
    model             VARCHAR(100) NOT NULL,
    system_prompt_enc TEXT,    -- AES-256-GCM encrypted system prompt
    system_prompt_iv  TEXT,
    tags              TEXT[] NOT NULL DEFAULT '{}',
    total_tokens_in   INTEGER NOT NULL DEFAULT 0,
    total_tokens_out  INTEGER NOT NULL DEFAULT 0,
    message_count     INTEGER NOT NULL DEFAULT 0,
    last_message_at   TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at        TIMESTAMPTZ  -- soft delete
);

CREATE INDEX idx_chat_sessions_user_id         ON chat_sessions (user_id);
CREATE INDEX idx_chat_sessions_user_active     ON chat_sessions (user_id, deleted_at)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_chat_sessions_last_message_at ON chat_sessions (last_message_at DESC);
CREATE INDEX idx_chat_sessions_tags            ON chat_sessions USING gin (tags);

-- ─────────────────────────────────────────────────────────────
-- CHAT MESSAGES  (encrypted at rest)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE chat_messages (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id       UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role             VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content_enc      TEXT NOT NULL,  -- AES-256-GCM base64 ciphertext
    content_iv       TEXT NOT NULL,  -- base64 96-bit IV
    tokens_in        INTEGER NOT NULL DEFAULT 0,
    tokens_out       INTEGER NOT NULL DEFAULT 0,
    provider         VARCHAR(50),
    model            VARCHAR(100),
    finish_reason    VARCHAR(50),
    is_ephemeral     BOOLEAN NOT NULL DEFAULT FALSE,
    parent_msg_id    UUID REFERENCES chat_messages(id),  -- for branches/regen
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_session_id ON chat_messages (session_id, created_at);

-- ─────────────────────────────────────────────────────────────
-- PROMPT TEMPLATES
-- ─────────────────────────────────────────────────────────────
CREATE TABLE prompt_templates (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              UUID REFERENCES users(id) ON DELETE CASCADE, -- NULL = company
    title                VARCHAR(500) NOT NULL,
    description          TEXT,
    content              TEXT NOT NULL,
    tags                 TEXT[] NOT NULL DEFAULT '{}',
    is_company_template  BOOLEAN NOT NULL DEFAULT FALSE,
    is_public            BOOLEAN NOT NULL DEFAULT FALSE,
    created_by           UUID REFERENCES users(id),
    use_count            INTEGER NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prompt_templates_user_id ON prompt_templates (user_id);
CREATE INDEX idx_prompt_templates_company ON prompt_templates (is_company_template)
    WHERE is_company_template = TRUE;

-- ─────────────────────────────────────────────────────────────
-- AUDIT LOGS  (append-only, tamper-evident hash chain)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE audit_logs (
    id              UUID NOT NULL DEFAULT gen_random_uuid(),
    seq             BIGSERIAL NOT NULL,   -- monotonic sequence, never reused
    event_type      VARCHAR(100) NOT NULL,
    actor_id        UUID,                 -- NULL for system events
    actor_email     VARCHAR(255),         -- denormalized for immutability
    actor_role      VARCHAR(50),
    target_id       TEXT,                 -- flexible: user/session/config id
    target_type     VARCHAR(100),
    ip_address      INET,
    device_id       VARCHAR(255),
    success         BOOLEAN NOT NULL,
    reason_code     VARCHAR(100),
    -- metadata: timestamps, model name, session_id, error codes — NO prompt content
    metadata        JSONB NOT NULL DEFAULT '{}',
    prev_hash       VARCHAR(64),          -- SHA-256 of previous entry (hex)
    entry_hash      VARCHAR(64) NOT NULL, -- SHA-256 of this entry (hex)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id)
);

-- Prevent any modifications (trigger replaces WITH EXCEPTION)
CREATE OR REPLACE FUNCTION audit_log_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only: % on % is forbidden',
        TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_audit_log_no_update
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

CREATE TRIGGER trg_audit_log_no_delete
    BEFORE DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

CREATE INDEX idx_audit_logs_seq          ON audit_logs (seq);
CREATE INDEX idx_audit_logs_event_type   ON audit_logs (event_type);
CREATE INDEX idx_audit_logs_actor_id     ON audit_logs (actor_id);
CREATE INDEX idx_audit_logs_created_at   ON audit_logs (created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- updated_at auto-update trigger
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DO $$ DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'users', 'user_quotas', 'user_preferences', 'ai_providers',
        'ai_models', 'chat_folders', 'chat_sessions', 'prompt_templates'
    ]
    LOOP
        EXECUTE format('
            CREATE TRIGGER trg_%I_updated_at
            BEFORE UPDATE ON %I
            FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
    END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────
-- DB USER PRIVILEGES (run as superuser during setup)
-- app_user  → standard application user
-- audit_writer → INSERT-only on audit_logs (separate conn string)
-- ─────────────────────────────────────────────────────────────
-- CREATE USER app_user WITH PASSWORD '...';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
-- REVOKE UPDATE, DELETE ON audit_logs FROM app_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- CREATE USER audit_writer WITH PASSWORD '...';
-- GRANT INSERT ON audit_logs TO audit_writer;
-- GRANT USAGE, SELECT ON SEQUENCE audit_logs_seq_seq TO audit_writer;
