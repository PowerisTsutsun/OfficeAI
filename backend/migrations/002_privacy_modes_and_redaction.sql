-- Privacy modes + redaction support

ALTER TABLE chat_sessions
    ADD COLUMN IF NOT EXISTS privacy_mode VARCHAR(30) NOT NULL DEFAULT 'masked_private',
    ADD CONSTRAINT chk_chat_sessions_privacy_mode
        CHECK (privacy_mode IN ('true_private', 'local', 'masked_private'));

ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS privacy_mode VARCHAR(30) NOT NULL DEFAULT 'masked_private',
    ADD COLUMN IF NOT EXISTS redaction_status VARCHAR(30),
    ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64),
    ADD CONSTRAINT chk_chat_messages_privacy_mode
        CHECK (privacy_mode IN ('true_private', 'local', 'masked_private'));

CREATE TABLE IF NOT EXISTS redaction_map (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id          UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    placeholder         VARCHAR(80) NOT NULL,
    encrypted_value     TEXT NOT NULL,
    encrypted_value_iv  TEXT NOT NULL,
    value_type          VARCHAR(40) NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_redaction_map_message_id ON redaction_map (message_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_privacy_mode ON chat_sessions (privacy_mode);
CREATE INDEX IF NOT EXISTS idx_chat_messages_privacy_mode ON chat_messages (privacy_mode);

INSERT INTO ai_providers (name, display_name, is_enabled, secret_key_name)
VALUES ('local', 'Local AI', TRUE, 'LOCAL_AI_API_KEY')
ON CONFLICT (name) DO NOTHING;

INSERT INTO ai_models (
    provider_id,
    model_id,
    display_name,
    context_window,
    max_output_tokens,
    supports_vision,
    supports_tools,
    supports_streaming,
    is_enabled,
    sort_order
)
VALUES (
    (SELECT id FROM ai_providers WHERE name = 'local'),
    'local-default',
    'Local Default',
    32768,
    4096,
    FALSE,
    FALSE,
    TRUE,
    TRUE,
    0
)
ON CONFLICT (provider_id, model_id) DO NOTHING;
