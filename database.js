const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
});

async function findUserByEmail(email) {
  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
  return result.rows[0];
}

async function findUserById(id) {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0];
}

async function createUser({ nome, email, telefone, data_nascimento, senha_hash, perfil_data }) {
  const query = `
    INSERT INTO users (nome, email, telefone, data_nascimento, senha_hash, perfil_data)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *;
  `;
  const values = [
    nome.trim(),
    email.toLowerCase().trim(),
    telefone.trim(),
    data_nascimento,
    senha_hash,
    perfil_data || {}
  ];
  const result = await pool.query(query, values);
  return result.rows[0];
}

async function getPerfil(userId) {
  const result = await pool.query('SELECT perfil_data FROM users WHERE id = $1', [userId]);
  if (result.rows.length === 0) return null;
  return result.rows[0].perfil_data || {};
}

async function updatePerfil(userId, perfilData) {
  await pool.query(
    `UPDATE users SET perfil_data = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [perfilData, userId]
  );
}

async function updateUserMemory(userId, memoryData) {
  await pool.query(
    `UPDATE users SET memory_data = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [memoryData, userId]
  );
}

async function updateUserProfile(userId, { nome, telefone, data_nascimento }) {
  await pool.query(
    `UPDATE users SET nome = $1, telefone = $2, data_nascimento = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
    [nome.trim(), telefone.trim(), data_nascimento, userId]
  );
  return findUserById(userId);
}

function toPublicUser(user) {
  if (!user) return null;
  const memory = typeof user.memory_data === 'string' ? JSON.parse(user.memory_data) : (user.memory_data || {});
  const perfil = typeof user.perfil_data === 'string' ? JSON.parse(user.perfil_data) : (user.perfil_data || {});
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
