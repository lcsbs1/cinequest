-- ============================================================
-- CineQuest - Schema PostgreSQL (Supabase / Local)
-- ============================================================

-- Tabela de Usuários
CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  nome            VARCHAR(255) NOT NULL,
  email           VARCHAR(255) NOT NULL UNIQUE,
  telefone        VARCHAR(50)  NOT NULL,
  data_nascimento DATE         NOT NULL,
  senha_hash      VARCHAR(255) NOT NULL,
  memory_data     JSONB        DEFAULT '{}'::jsonb,
  perfil_data     JSONB        DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP
);

-- Índice para buscas rápidas por e-mail na autenticação
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
