const express = require('express');
const {
  findUserById,
  updateUserMemory,
  updateUserProfile,
  getPerfil,
  updatePerfil,
  upsertUserMovie,
  listUserMovies,
  getUserMovieStats,
  toPublicUser,
  parseJsonb,
} = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { checkAndUnlockConquistas, computeConhecimento } = require('../utils/perfil');
const { sanitizeClientMemory, mergeMemory } = require('../utils/memory');

const router = express.Router();

router.use(authMiddleware);

function isValidPhone(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 13;
}

function publicMovie(row) {
  return {
    movieId: row.movie_id,
    title: row.title,
    posterPath: row.poster_path,
    genreIds: row.genre_ids || [],
    reaction: row.reaction,
    watched: row.watched,
    watchedAt: row.watched_at,
  };
}

// Recalcula conquistas e nota a partir do estado real do servidor
async function refreshPerfilAndScore(userId, memory) {
  const stats = await getUserMovieStats(userId);
  const fullStats = { ...stats, sessions: memory.sessions || 0 };

  let perfil = (await getPerfil(userId)) || {};
  if (perfil.conquistas) {
    perfil = checkAndUnlockConquistas(perfil, fullStats);
    await updatePerfil(userId, perfil);
  }

  return { stats: fullStats, perfil, conhecimento: computeConhecimento(fullStats) };
}

/* ── Memória ────────────────────────────────────────────────── */

// GET /memory
router.get('/memory', async (req, res) => {
  try {
    const user = await findUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    res.json({ memory: parseJsonb(user.memory_data) });
  } catch (err) {
    console.error('GET /memory error:', err);
    res.status(500).json({ error: 'Erro ao carregar memória.' });
  }
});

// PUT /memory — sanitiza e mergeia no servidor (o cliente não dita o estado)
router.put('/memory', async (req, res) => {
  try {
    const { memory } = req.body || {};
    if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
      return res.status(400).json({ error: 'Memória inválida.' });
    }

    const user = await findUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const client = sanitizeClientMemory(memory);
    const merged = mergeMemory(parseJsonb(user.memory_data), client);
    await updateUserMemory(req.userId, merged);

    const { perfil } = await refreshPerfilAndScore(req.userId, merged);
    res.json({ ok: true, memory: merged, perfil });
  } catch (err) {
    console.error('PUT /memory error:', err);
    res.status(500).json({ error: 'Erro ao salvar memória.' });
  }
});

/* ── Filmes ─────────────────────────────────────────────────── */

const MOVIE_ACTIONS = ['liked', 'disliked', 'clear_reaction', 'watched', 'unwatched'];

// POST /movies — registra visto/curtido/não curtido para um filme
router.post('/movies', async (req, res) => {
  try {
    const { movieId, title, posterPath, genreIds, action } = req.body || {};
    const id = Number(movieId);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'movieId inválido.' });
    }
    if (!MOVIE_ACTIONS.includes(action)) {
      return res.status(400).json({ error: `action deve ser um de: ${MOVIE_ACTIONS.join(', ')}.` });
    }

    const fields = { movieId: id };
    if (typeof title === 'string' && title.trim()) fields.title = title.trim().slice(0, 500);
    if (typeof posterPath === 'string') fields.posterPath = posterPath.slice(0, 500);
    if (Array.isArray(genreIds)) fields.genreIds = genreIds.filter(g => Number.isInteger(g)).slice(0, 10);

    if (action === 'liked' || action === 'disliked') {
      fields.reaction = action;
      fields.reactionProvided = true;
    } else if (action === 'clear_reaction') {
      fields.reaction = null;
      fields.reactionProvided = true;
    } else if (action === 'watched') {
      fields.watched = true;
    } else if (action === 'unwatched') {
      fields.watched = false;
    }

    const row = await upsertUserMovie(req.userId, fields);

    const user = await findUserById(req.userId);
    const memory = parseJsonb(user?.memory_data);
    const { stats, perfil, conhecimento } = await refreshPerfilAndScore(req.userId, memory);

    res.json({ ok: true, movie: publicMovie(row), stats, conhecimento, perfil });
  } catch (err) {
    console.error('POST /movies error:', err);
    res.status(500).json({ error: 'Erro ao registrar filme.' });
  }
});

// GET /movies?filter=all|watched|liked|disliked
router.get('/movies', async (req, res) => {
  try {
    const filter = ['all', 'watched', 'liked', 'disliked'].includes(req.query.filter)
      ? req.query.filter : 'all';
    const rows = await listUserMovies(req.userId, { filter });
    const stats = await getUserMovieStats(req.userId);
    res.json({ movies: rows.map(publicMovie), stats });
  } catch (err) {
    console.error('GET /movies error:', err);
    res.status(500).json({ error: 'Erro ao listar filmes.' });
  }
});

/* ── Perfil ─────────────────────────────────────────────────── */

// PUT /profile
router.put('/profile', async (req, res) => {
  try {
    const { nome, telefone, data_nascimento } = req.body || {};

    if (!nome || nome.trim().length < 2) {
      return res.status(400).json({ error: 'Nome deve ter pelo menos 2 caracteres.' });
    }
    if (!telefone || !isValidPhone(telefone)) {
      return res.status(400).json({ error: 'Telefone inválido (mínimo 10 dígitos).' });
    }

    const current = await findUserById(req.userId);
    if (!current) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const nascimento = data_nascimento || current.data_nascimento;
    const user = await updateUserProfile(req.userId, { nome, telefone, data_nascimento: nascimento });

    res.json({ user: toPublicUser(user) });
  } catch (err) {
    console.error('PUT /profile error:', err);
    res.status(500).json({ error: 'Erro ao atualizar perfil.' });
  }
});

// GET /perfil — inclui stats e nota de conhecimento calculadas no servidor
router.get('/perfil', async (req, res) => {
  try {
    const user = await findUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const memory = parseJsonb(user.memory_data);
    const { stats, perfil, conhecimento } = await refreshPerfilAndScore(req.userId, memory);
    res.json({ perfil, stats, conhecimento });
  } catch (err) {
    console.error('GET /perfil error:', err);
    res.status(500).json({ error: 'Erro ao carregar perfil.' });
  }
});

// PUT /perfil — aceita apenas chaves conhecidas; conquistas nunca vêm do cliente
const PERFIL_CLIENT_KEYS = ['arquetipo', 'semente', 'tracos'];

router.put('/perfil', async (req, res) => {
  try {
    const { perfil } = req.body || {};
    if (!perfil || typeof perfil !== 'object' || Array.isArray(perfil)) {
      return res.status(400).json({ error: 'Perfil inválido.' });
    }

    const current = (await getPerfil(req.userId)) || {};
    const merged = { ...current };
    for (const key of PERFIL_CLIENT_KEYS) {
      if (perfil[key] && typeof perfil[key] === 'object') {
        merged[key] = { ...(current[key] || {}), ...perfil[key] };
      }
    }

    await updatePerfil(req.userId, merged);
    res.json({ perfil: merged });
  } catch (err) {
    console.error('PUT /perfil error:', err);
    res.status(500).json({ error: 'Erro ao atualizar perfil.' });
  }
});

// POST /perfil/reveal — marca arquétipo/semente como revelados
router.post('/perfil/reveal', async (req, res) => {
  try {
    const perfil = (await getPerfil(req.userId)) || {};
    if (perfil.arquetipo) perfil.arquetipo.revelado = true;
    if (perfil.semente) perfil.semente.revelada = true;
    await updatePerfil(req.userId, perfil);
    res.json({ ok: true, perfil });
  } catch (err) {
    console.error('POST /perfil/reveal error:', err);
    res.status(500).json({ error: 'Erro ao revelar perfil.' });
  }
});

module.exports = router;
