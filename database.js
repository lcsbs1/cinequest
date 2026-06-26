const { Pool } = require('pg');
require('dotenv').config();

// Configuração da pool de ligações ao PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Inicialização da estrutura da base de dados
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Ativar a extensão de vetores (Essencial para a memória da IA)
    await client.query('CREATE EXTENSION IF NOT EXISTS vector;');

    // 2. Tabela de Utilizadores
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nome VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        telefone VARCHAR(50) NOT NULL,
        data_nascimento DATE NOT NULL,
        senha_hash VARCHAR(255) NOT NULL,
        perfil_data JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Tabela de Memória Semântica (O RAG)
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_memories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        memory_text TEXT NOT NULL,
        embedding vector(1536),
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query('COMMIT');
    console.log('📦 Base de dados PostgreSQL inicializada com suporte a vetores.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Erro ao inicializar a base de dados:', e);
  } finally {
    client.release();
  }
}

// Executar na inicialização do módulo
initDB();

/* ============================================================
   FUNÇÕES DE ACESSO A DADOS (Mapeadas para SQL Assíncrono)
   ============================================================ */

async function findUserByEmail(email) {
  const res = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
  return res.rows[0];
}

async function findUserById(id) {
  const res = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return res.rows[0];
}

async function createUser({ nome, email, telefone, data_nascimento, senha_hash, perfil_data }) {
  const res = await pool.query(
    `INSERT INTO users (nome, email, telefone, data_nascimento, senha_hash, perfil_data)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [nome.trim(), email.toLowerCase().trim(), telefone.trim(), data_nascimento, senha_hash, perfil_data || {}]
  );
  return res.rows[0];
}

async function getPerfil(userId) {
  const res = await pool.query('SELECT perfil_data FROM users WHERE id = $1', [userId]);
  return res.rows[0]?.perfil_data || null;
}

async function updatePerfil(userId, perfilData) {
  await pool.query(
    `UPDATE users SET perfil_data = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [perfilData, userId]
  );
}

// Obsoleto na fase final, mas mantido temporariamente para não quebrar a UI
async function updateUserMemory(userId, memoryData) {
  console.warn('updateUserMemory: A UI ainda usa o dump completo. Migração pendente.');
}

async function updateUserProfile(userId, { nome, telefone, data_nascimento }) {
  const res = await pool.query(
    `UPDATE users
     SET nome = $1, telefone = $2, data_nascimento = $3, updated_at = CURRENT_TIMESTAMP
     WHERE id = $4 RETURNING *`,
    [nome.trim(), telefone.trim(), data_nascimento, userId]
  );
  return res.rows[0];
}

function toPublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    telefone: user.telefone,
    data_nascimento: user.data_nascimento,
    created_at: user.created_at,
    perfil: user.perfil_data,
  };
}

module.exports = {
  pool,
  findUserByEmail,
  findUserById,
  createUser,
  updateUserMemory,
  updateUserProfile,
  getPerfil,
  updatePerfil,
  toPublicUser,
};
