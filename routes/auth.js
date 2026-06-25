const express = require('express');
const bcrypt = require('bcryptjs');
const {
  findUserByEmail,
  findUserById,
  createUser,
  updatePerfil,
  toPublicUser,
} = require('../database');
const { signToken, authMiddleware } = require('../middleware/auth');
const { buildDefaultPerfil } = require('../utils/perfil');

const router = express.Router();

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 13;
}

function isValidBirthDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  if (isNaN(date.getTime())) return false;
  const today = new Date();
  const age = today.getFullYear() - date.getFullYear();
  const monthDiff = today.getMonth() - date.getMonth();
  const dayDiff = today.getDate() - date.getDate();
  const realAge = monthDiff < 0 || (monthDiff === 0 && dayDiff < 0) ? age - 1 : age;
  return realAge >= 13 && realAge <= 120;
}

function validateRegister(body) {
  const { nome, email, telefone, data_nascimento, senha, confirmar_senha } = body;
  const errors = [];

  if (!nome || nome.trim().length < 2) errors.push('Nome deve ter pelo menos 2 caracteres.');
  if (!email || !isValidEmail(email)) errors.push('E-mail inválido.');
  if (!telefone || !isValidPhone(telefone)) errors.push('Telefone inválido (mínimo 10 dígitos).');
  if (!data_nascimento || !isValidBirthDate(data_nascimento)) {
    errors.push('Data de nascimento inválida (idade mínima: 13 anos).');
  }
  if (!senha || senha.length < 6) errors.push('Senha deve ter pelo menos 6 caracteres.');
  if (senha !== confirmar_senha) errors.push('As senhas não coincidem.');

  return errors;
}

router.post('/register', async (req, res) => {
  try {
    const errors = validateRegister(req.body);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });

    const { nome, email, telefone, data_nascimento, senha } = req.body;

    if (findUserByEmail(email)) {
      return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    }

    const senha_hash = await bcrypt.hash(senha, 10);
    const now = Date.now();
    const perfilData = buildDefaultPerfil(email.toLowerCase().trim(), now);
    const user = createUser({ nome, email, telefone, data_nascimento, senha_hash, perfil_data: perfilData });
    const token = signToken(user.id);

    res.status(201).json({
      message: 'Conta criada com sucesso!',
      token,
      user: toPublicUser(user),
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Erro interno ao criar conta.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
    }

    const user = findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    const valid = await bcrypt.compare(senha, user.senha_hash);
    if (!valid) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    const token = signToken(user.id);

    res.json({
      message: 'Login realizado com sucesso!',
      token,
      user: toPublicUser(user),
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Erro interno ao fazer login.' });
  }
});

router.get('/me', authMiddleware, (req, res) => {
  const user = findUserById(req.userId);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  res.json({ user: toPublicUser(user) });
});

module.exports = router;
