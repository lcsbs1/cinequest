const { Pool } = require('pg');

// Prefere DATABASE_URL (definida no .env); cai nas credenciais do docker-compose.yml em dev
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : new Pool({
      user: process.env.DB_USER || 'cinequest',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'cinequest_db',
      password: process.env.DB_PASSWORD || 'p#ssword3',
      port: process.env.DB_PORT || 5432,
    });

/* ── Migrações ──────────────────────────────────────────────── */
async function runMigration(name, fn) {
  const done = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
  if (done.rows.length) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await fn(client);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    await client.query('COMMIT');
    console.log(`✔ Migração aplicada: ${name}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Move likedMovies/dislikedMovies do JSONB memory_data para a tabela user_movies
async function migrateMoviesFromJsonb(client) {
  for (const [key, reaction] of [['likedMovies', 'liked'], ['dislikedMovies', 'disliked']]) {
    await client.query(`
      INSERT INTO user_movies (user_id, movie_id, title, reaction, created_at, updated_at)
      SELECT u.id,
             (m->>'id')::int,
             LEFT(COALESCE(m->>'title', ''), 500),
             '${reaction}',
             CASE WHEN m->>'ts' ~ '^[0-9]+$'
                  THEN to_timestamp((m->>'ts')::bigint / 1000.0)
                  ELSE now() END,
             now()
      FROM users u,
           jsonb_array_elements(COALESCE(u.memory_data->'${key}', '[]'::jsonb)) m
      WHERE (m->>'id') ~ '^[0-9]+$'
      ON CONFLICT (user_id, movie_id) DO NOTHING
    `);
  }
  await client.query(`
    UPDATE users
    SET memory_data = memory_data - 'likedMovies' - 'dislikedMovies'
    WHERE memory_data ?| array['likedMovies', 'dislikedMovies']
  `);
}

/* ── Inicialização das tabelas ──────────────────────────────── */
const initDB = async () => {
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
        created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // Bancos criados por versões antigas do schema não têm memory_data
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS memory_data JSONB DEFAULT '{}'::jsonb`);

    // O tipo do id de users varia entre instalações antigas (uuid) e novas (serial);
    // user_movies.user_id precisa acompanhar para a FK funcionar
    const idType = await pool.query(`
      SELECT udt_name FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'id'
    `);
    const userIdType = idType.rows[0]?.udt_name === 'uuid' ? 'UUID' : 'INTEGER';

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_movies (
        id          SERIAL PRIMARY KEY,
        user_id     ${userIdType} NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        movie_id    INTEGER NOT NULL,
        title       TEXT NOT NULL DEFAULT '',
        poster_path TEXT,
        genre_ids   INTEGER[] NOT NULL DEFAULT '{}',
        reaction    TEXT CHECK (reaction IN ('liked', 'disliked')),
        watched     BOOLEAN NOT NULL DEFAULT FALSE,
        watched_at  TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_id, movie_id)
      );
      CREATE INDEX IF NOT EXISTS idx_user_movies_user ON user_movies(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_movies_watched ON user_movies(user_id) WHERE watched;
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await runMigration('001_user_movies_from_jsonb', migrateMoviesFromJsonb);
  } catch (err) {
    console.error('Erro ao inicializar tabelas:', err);
  }
};
initDB();

/* ── Usuários ───────────────────────────────────────────────── */
async function findUserByEmail(email) {
  const res = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
  return res.rows[0];
}

async function findUserById(id) {
  const res = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return res.rows[0];
}

async function createUser({ nome, email, telefone, data_nascimento, senha_hash, perfil_data }) {
  const res = await pool.query(`
    INSERT INTO users (nome, email, telefone, data_nascimento, senha_hash, perfil_data)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
  `, [
    nome.trim(),
    email.toLowerCase().trim(),
    telefone.trim(),
    data_nascimento,
    senha_hash,
    perfil_data || {},
  ]);
  return res.rows[0];
}

async function getPerfil(userId) {
  const res = await pool.query('SELECT perfil_data FROM users WHERE id = $1', [userId]);
  if (res.rows.length === 0) return null;
  return res.rows[0].perfil_data || {};
}

async function updatePerfil(userId, perfilData) {
  await pool.query(`
    UPDATE users SET perfil_data = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2
  `, [perfilData, userId]);
}

async function updateUserMemory(userId, memoryData) {
  await pool.query(`
    UPDATE users SET memory_data = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2
  `, [memoryData, userId]);
}

async function updateUserProfile(userId, { nome, telefone, data_nascimento }) {
  const res = await pool.query(`
    UPDATE users
    SET nome = $1, telefone = $2, data_nascimento = $3, updated_at = CURRENT_TIMESTAMP
    WHERE id = $4 RETURNING *
  `, [nome.trim(), telefone.trim(), data_nascimento, userId]);
  return res.rows[0];
}

/* ── Filmes por usuário ─────────────────────────────────────── */
/**
 * Cria/atualiza a relação usuário↔filme.
 * Campos undefined não alteram o valor existente; reactionProvided distingue
 * "limpar reação" (reaction=null) de "não mexer na reação".
 */
async function upsertUserMovie(userId, { movieId, title, posterPath, genreIds, reaction, watched, reactionProvided = false }) {
  const res = await pool.query(`
    INSERT INTO user_movies (user_id, movie_id, title, poster_path, genre_ids, reaction, watched, watched_at)
    VALUES ($1, $2, COALESCE($3::text, ''), $4::text, COALESCE($5::int[], '{}'::int[]), $6::text,
            COALESCE($7::boolean, FALSE),
            CASE WHEN $7::boolean IS TRUE THEN now() END)
    ON CONFLICT (user_id, movie_id) DO UPDATE SET
      title       = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE user_movies.title END,
      poster_path = COALESCE($4, user_movies.poster_path),
      genre_ids   = CASE WHEN $5::int[] IS NOT NULL THEN $5 ELSE user_movies.genre_ids END,
      reaction    = CASE WHEN $8 THEN $6 ELSE user_movies.reaction END,
      watched     = CASE WHEN $7::boolean IS NULL THEN user_movies.watched ELSE $7 END,
      watched_at  = CASE WHEN $7 IS TRUE AND user_movies.watched IS FALSE THEN now()
                         WHEN $7 IS FALSE THEN NULL
                         ELSE user_movies.watched_at END,
      updated_at  = now()
    RETURNING *
  `, [
    userId,
    movieId,
    title ?? null,
    posterPath ?? null,
    genreIds ?? null,
    reaction ?? null,
    watched ?? null,
    reactionProvided,
  ]);
  return res.rows[0];
}

async function listUserMovies(userId, { filter = 'all', limit = 200 } = {}) {
  const clauses = {
    all: '',
    watched: 'AND watched',
    liked: "AND reaction = 'liked'",
    disliked: "AND reaction = 'disliked'",
  };
  const res = await pool.query(`
    SELECT movie_id, title, poster_path, genre_ids, reaction, watched, watched_at, updated_at
    FROM user_movies
    WHERE user_id = $1 ${clauses[filter] || ''}
    ORDER BY updated_at DESC
    LIMIT $2
  `, [userId, limit]);
  return res.rows;
}

async function getUserMovieStats(userId) {
  const res = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE reaction = 'liked')::int    AS liked,
      COUNT(*) FILTER (WHERE reaction = 'disliked')::int AS disliked,
      COUNT(*) FILTER (WHERE watched)::int               AS watched,
      COUNT(*) FILTER (WHERE watched AND reaction IS NOT NULL)::int AS watched_rated,
      COALESCE((
        SELECT COUNT(DISTINCT g)::int
        FROM user_movies um2, unnest(um2.genre_ids) g
        WHERE um2.user_id = $1 AND um2.watched
      ), 0) AS distinct_genres
    FROM user_movies
    WHERE user_id = $1
  `, [userId]);
  const r = res.rows[0];
  return {
    liked: r.liked,
    disliked: r.disliked,
    watched: r.watched,
    watchedRated: r.watched_rated,
    distinctGenres: r.distinct_genres,
  };
}

/* ── Serialização ───────────────────────────────────────────── */
// O driver 'pg' devolve JSONB como objeto JS; strings só aparecem em dados legados
function parseJsonb(value) {
  if (value == null) return {};
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return value;
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
    memory: parseJsonb(user.memory_data),
    perfil: parseJsonb(user.perfil_data),
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
  upsertUserMovie,
  listUserMovies,
  getUserMovieStats,
  toPublicUser,
  parseJsonb,
};
