const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'cinequest.db'));
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nome            TEXT    NOT NULL,
    email           TEXT    NOT NULL UNIQUE,
    telefone        TEXT    NOT NULL,
    data_nascimento TEXT    NOT NULL,
    senha_hash      TEXT    NOT NULL,
    memory_data     TEXT    DEFAULT '{}',
    created_at      TEXT    DEFAULT (datetime('now')),
    updated_at      TEXT    DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
`);

try { db.exec(`ALTER TABLE users ADD COLUMN perfil_data TEXT DEFAULT '{}'`); } catch {}

function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
}

function findUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function createUser({ nome, email, telefone, data_nascimento, senha_hash, perfil_data }) {
  const stmt = db.prepare(`
    INSERT INTO users (nome, email, telefone, data_nascimento, senha_hash, perfil_data)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    nome.trim(),
    email.toLowerCase().trim(),
    telefone.trim(),
    data_nascimento,
    senha_hash,
    JSON.stringify(perfil_data || {})
  );
  return findUserById(result.lastInsertRowid);
}

function getPerfil(userId) {
  const user = db.prepare('SELECT perfil_data FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  try { return JSON.parse(user.perfil_data || '{}'); } catch { return {}; }
}

function updatePerfil(userId, perfilData) {
  db.prepare(`
    UPDATE users SET perfil_data = ?, updated_at = datetime('now') WHERE id = ?
  `).run(JSON.stringify(perfilData), userId);
}

function updateUserMemory(userId, memoryData) {
  db.prepare(`
    UPDATE users
    SET memory_data = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(memoryData), userId);
}

function updateUserProfile(userId, { nome, telefone, data_nascimento }) {
  db.prepare(`
    UPDATE users
    SET nome = ?, telefone = ?, data_nascimento = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(nome.trim(), telefone.trim(), data_nascimento, userId);
  return findUserById(userId);
}

function toPublicUser(user) {
  if (!user) return null;
  let memory = {};
  try { memory = JSON.parse(user.memory_data || '{}'); } catch {}
  let perfil = {};
  try { perfil = JSON.parse(user.perfil_data || '{}'); } catch {}
  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    telefone: user.telefone,
    data_nascimento: user.data_nascimento,
    created_at: user.created_at,
    memory,
    perfil,
  };
}

module.exports = {
  db,
  findUserByEmail,
  findUserById,
  createUser,
  updateUserMemory,
  updateUserProfile,
  getPerfil,
  updatePerfil,
  toPublicUser,
};
