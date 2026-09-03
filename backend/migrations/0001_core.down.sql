DROP FUNCTION IF EXISTS next_doc_seq(uuid, text, text);
DROP TABLE IF EXISTS doc_sequences, audit_logs, refresh_tokens, users, store_settings, stores;
DROP TYPE IF EXISTS locale_code, user_role;
DROP FUNCTION IF EXISTS set_updated_at();
DROP FUNCTION IF EXISTS app_bypass_rls();
DROP FUNCTION IF EXISTS app_current_store_id();
