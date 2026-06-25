require('dotenv').config();

const express = require('express');
const path = require('path');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const geminiRoutes = require('./routes/gemini');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/gemini', geminiRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'CineQuest API' });
});

app.use(express.static(path.join(__dirname)));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🎬 CineQuest rodando em http://localhost:${PORT}`);
});
