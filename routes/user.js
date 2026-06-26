const express = require('express');
const {
  findUserById,
  updateUserMemory,
  updateUserProfile,
  getPerfil,
  updatePerfil,
  toPublicUser,
} = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { updateTracosFromSession, checkAndUnlockConquistas } = require('../utils/perfil');

const router = express.Router();

router.use(authMiddleware);

router.get('/memory', async (req, res) => {
  const user = await findUserById(req.userId);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

  let memory = {};
  try { memory = JSON.parse(user.memory_data || '{}'); } catch {}

  res.json({ memory });
});

router.put('/memory', async (req, res) => {
  const { memory } = req.body;
  if (!memory || typeof memory !== 'object') {
    return res.status(400).json({ error: 'Dados de memória inválidos.' });
  }

  await updateUserMemory(req.userId, memory);

  // Side-effect: update traits and achievements based on new memory state
  try {
    let perfil = await getPerfil(req.userId) || {};
    if (perfil.tracos && memory.lastSession) {
      perfil = updateTracosFromSession(perfil, memory.lastSession);
    }
    if (perfil.conquistas) {
      perfil = checkAndUnlockConquistas(perfil, memory);
    }
    if (Object.keys(perfil).length > 0) {
      await updatePerfil(req.userId, perfil);
    }
  } catch (e) {
    // Non-fatal — memory is already saved
  }

  res.json({ message: 'Preferências salvas.', memory });
});

router.put('/profile', async (req, res) => {
  const { nome, telefone, data_nascimento } = req.body;
  const errors = [];

  if (!nome || nome.trim().length < 2) errors.push('Nome inválido.');
  if (!telefone || telefone.replace(/\D/g, '').length < 10) errors.push('Telefone inválido.');
  if (!data_nascimento) errors.push('Data de nascimento obrigatória.');

  if (errors.length) return res.status(400).json({ error: errors[0] });

  const user = await updateUserProfile(req.userId, { nome, telefone, data_nascimento });
  res.json({ message: 'Perfil atualizado.', user: toPublicUser(user) });
});

router.get('/perfil', async (req, res) => {
  const perfil = await getPerfil(req.userId);
  if (perfil === null) return res.status(404).json({ error: 'Usuário não encontrado.' });
  res.json({ perfil });
});

router.put('/perfil', async (req, res) => {
  const { perfil: incoming } = req.body;
  if (!incoming || typeof incoming !== 'object') {
    return res.status(400).json({ error: 'Dados de perfil inválidos.' });
  }

  const current = await getPerfil(req.userId) || {};

  // Protect immutable fields
  const merged = {
    ...current,
    ...incoming,
    arquetipo: {
      ...current.arquetipo,
      ...(incoming.arquetipo || {}),
      id: current.arquetipo?.id,
      simbolo: current.arquetipo?.simbolo,
    },
    semente: {
      ...current.semente,
      ...(incoming.semente || {}),
      palavras: current.semente?.palavras,
      gerada_em: current.semente?.gerada_em,
    },
  };

  await updatePerfil(req.userId, merged);
  res.json({ message: 'Perfil salvo.', perfil: merged });
});

router.post('/perfil/reveal', async (req, res) => {
  const perfil = await getPerfil(req.userId) || {};
  if (perfil.arquetipo) perfil.arquetipo.revelado = true;
  if (perfil.semente) perfil.semente.revelada = true;
  await updatePerfil(req.userId, perfil);
  res.json({ message: 'Revelado.' });
});

module.exports = router;
