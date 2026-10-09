const path = require('path');

const fs = require('fs');

const USE_POSTGRES = Boolean(process.env.DATABASE_URL);

let pool = null;
let sqliteDb = null;

function getSslConfig() {
  if (process.env.DATABASE_SSL === 'false') return false;
  if (process.env.DATABASE_SSL === 'true') return { rejectUnauthorized: false };
  if (process.env.NODE_ENV === 'production') return { rejectUnauthorized: false };

  const connectionString = process.env.DATABASE_URL || '';
  if (connectionString && !connectionString.includes('localhost') && !connectionString.includes('127.0.0.1')) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

if (USE_POSTGRES) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: getSslConfig(),
  });

  pool.on('error', (err) => {
    console.error('❌ Erro inesperado no cliente do pool PostgreSQL:', err.message);
  });
} else {
  // Fallback local com SQLite nativo do Node.js
  const { DatabaseSync } = require('node:sqlite');
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const dbPath = path.join(dataDir, 'cinequest.db');
  sqliteDb = new DatabaseSync(dbPath);
  sqliteDb.exec('PRAGMA journal_mode = WAL;');
  console.log(`ℹ️ DATABASE_URL não definida: usando SQLite local em ${dbPath}`);
}

async function initDB() {
  if (USE_POSTGRES) {
    try {
      await pool.query(`
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
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      `);
      console.log('✔ Banco PostgreSQL conectado (tabela users verificada).');
    } catch (err) {
      console.error('⚠️ Não foi possível inicializar a tabela users no PostgreSQL:', err.message);
    }
  } else {
    try {
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          nome            TEXT    NOT NULL,
          email           TEXT    NOT NULL UNIQUE,
          telefone        TEXT    NOT NULL,
          data_nascimento TEXT    NOT NULL,
          senha_hash      TEXT    NOT NULL,
          memory_data     TEXT    DEFAULT '{}',
          perfil_data     TEXT    DEFAULT '{}',
          created_at      TEXT    DEFAULT (datetime('now')),
          updated_at      TEXT    DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      `);
      console.log('✔ Banco SQLite local pronto.');
    } catch (err) {
      console.error('⚠️ Erro ao inicializar SQLite local:', err.message);
    }
  }
}

async function findUserByEmail(email) {
  const cleanEmail = email.toLowerCase().trim();
  if (USE_POSTGRES) {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [cleanEmail]);
    return result.rows[0];
  }
  return sqliteDb.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
}

async function findUserById(id) {
  if (USE_POSTGRES) {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0];
  }
  return sqliteDb.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

async function createUser({ nome, email, telefone, data_nascimento, senha_hash, perfil_data }) {
  const cleanNome = nome.trim();
  const cleanEmail = email.toLowerCase().trim();
  const cleanTelefone = telefone.trim();

  if (USE_POSTGRES) {
    const query = `
      INSERT INTO users (nome, email, telefone, data_nascimento, senha_hash, perfil_data, memory_data)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;
    const values = [
      cleanNome,
      cleanEmail,
      cleanTelefone,
      data_nascimento,
      senha_hash,
      perfil_data || {},
      {},
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  const stmt = sqliteDb.prepare(`
    INSERT INTO users (nome, email, telefone, data_nascimento, senha_hash, perfil_data, memory_data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    cleanNome,
    cleanEmail,
    cleanTelefone,
    data_nascimento,
    senha_hash,
    JSON.stringify(perfil_data || {}),
    '{}'
  );
  return findUserById(result.lastInsertRowid);
}

async function getPerfil(userId) {
  if (USE_POSTGRES) {
    const result = await pool.query('SELECT perfil_data FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) return null;
    return safeJson(result.rows[0].perfil_data);
  }
  const user = sqliteDb.prepare('SELECT perfil_data FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  return safeJson(user.perfil_data);
}

async function updatePerfil(userId, perfilData) {
  if (USE_POSTGRES) {
    await pool.query(
      `UPDATE users SET perfil_data = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [perfilData, userId]
    );
  } else {
    sqliteDb.prepare(`
      UPDATE users SET perfil_data = ?, updated_at = datetime('now') WHERE id = ?
    `).run(JSON.stringify(perfilData), userId);
  }
}

async function updateUserMemory(userId, memoryData) {
  if (USE_POSTGRES) {
    await pool.query(
      `UPDATE users SET memory_data = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [memoryData, userId]
    );
  } else {
    sqliteDb.prepare(`
      UPDATE users SET memory_data = ?, updated_at = datetime('now') WHERE id = ?
    `).run(JSON.stringify(memoryData), userId);
  }
}

async function updateUserProfile(userId, { nome, telefone, data_nascimento }) {
  const cleanNome = nome.trim();
  const cleanTelefone = telefone.trim();

  if (USE_POSTGRES) {
    await pool.query(
      `UPDATE users SET nome = $1, telefone = $2, data_nascimento = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
      [cleanNome, cleanTelefone, data_nascimento, userId]
    );
  } else {
    sqliteDb.prepare(`
      UPDATE users SET nome = ?, telefone = ?, data_nascimento = ?, updated_at = datetime('now') WHERE id = ?
    `).run(cleanNome, cleanTelefone, data_nascimento, userId);
  }
  return findUserById(userId);
}

function safeJson(val) {
  if (!val) return {};
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return {};
  }
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
    memory: safeJson(user.memory_data),
    perfil: safeJson(user.perfil_data),
  };
}

module.exports = {
  pool,
  initDB,
  findUserByEmail,
  findUserById,
  createUser,
  updateUserMemory,
  updateUserProfile,
  getPerfil,
  updatePerfil,
  toPublicUser,
  safeJson,
};
