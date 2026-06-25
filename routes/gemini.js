const express = require('express');
const {
  findUserById,
  updateUserMemory,
  getPerfil,
  updatePerfil,
} = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { updateTracosFromSession, checkAndUnlockConquistas } = require('../utils/perfil');
const { discoverMovies } = require('../utils/tmdb');

const router = express.Router();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function geminiUrl() {
  return `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
}

/* ── Ferramenta exposta ao modelo ───────────────────────────── */
const TOOLS = [{
  functionDeclarations: [{
    name: 'recomendar_filmes',
    description: 'Busca e recomenda filmes reais do catálogo quando o usuário já deu pistas suficientes sobre o que quer assistir (humor, gênero, época, com quem vai assistir). Use somente quando estiver pronto para recomendar.',
    parameters: {
      type: 'object',
      properties: {
        generos: {
          type: 'array',
          items: { type: 'string' },
          description: 'Gêneros em português: ação, aventura, comédia, drama, terror, romance, thriller, ficção científica, fantasia, animação, crime, mistério, documentário, guerra, western.',
        },
        humor: {
          type: 'string',
          description: 'Estado emocional/clima desejado: feliz, tenso, nostálgico, romântico, reflexivo, maravilhado, empolgado ou assustado.',
        },
        era: {
          type: 'string',
          description: 'Época preferida: clássico, 80s-90s, 2000s ou recente.',
        },
        companhia: {
          type: 'string',
          description: 'Com quem vai assistir: sozinho, casal, família ou amigos.',
        },
        abertura: {
          type: 'string',
          description: 'Tipo de descoberta: popular (sucessos conhecidos) ou cult (obras menos óbvias/aclamadas).',
        },
      },
    },
  }],
}];

const SYSTEM_BASE =
  'Você é o curador de cinema da CineQuest — caloroso, curioso e cinéfilo. ' +
  'Converse em português do Brasil, de forma natural e leve, fazendo UMA pergunta por vez para conhecer o gosto da pessoa ' +
  '(humor de hoje, gêneros, época, com quem vai assistir, se prefere sucessos ou achados cult). ' +
  'Não despeje muitas perguntas de uma vez. Quando reunir pistas suficientes, chame a função recomendar_filmes. ' +
  'Depois que receber os filmes, comente cada um em 1 frase pessoal conectando ao gosto e ao perfil da pessoa. ' +
  'Seja conciso; evite respostas longas demais.';

/* ── Memória completa do usuário ────────────────────────────── */
function defaultMemory() {
  return {
    userName: '',
    sessions: 0,
    preferences: { moods: {}, genres: {}, durations: {}, eras: {}, companies: {}, openness: {} },
    likedMovies: [],
    dislikedMovies: [],
    lastQuiz: null,
    geminiData: { interactions: [], ideas: [], lastResponse: '', usage: { queries: 0 } },
  };
}

function loadFullMemory(user) {
  let mem = {};
  try { mem = JSON.parse(user.memory_data || '{}'); } catch {}
  const base = defaultMemory();
  return {
    ...base,
    ...mem,
    preferences: { ...base.preferences, ...(mem.preferences || {}) },
    geminiData: { ...base.geminiData, ...(mem.geminiData || {}) },
  };
}

/* ── Contexto do perfil para o systemInstruction ────────────── */
function perfilContext(user, perfil) {
  const lines = [`Nome da pessoa: ${user.nome}.`];
  if (perfil?.arquetipo?.nome) {
    lines.push(`Arquétipo cinematográfico: ${perfil.arquetipo.nome} — ${perfil.arquetipo.descricao || ''}`);
  }
  if (perfil?.semente?.palavras?.length) {
    lines.push(`Assinatura (DNA): ${perfil.semente.palavras.join(' · ')}.`);
  }
  if (perfil?.tracos) {
    const t = Object.entries(perfil.tracos).map(([k, v]) => `${k} ${v}`).join(', ');
    lines.push(`Traços atuais (0-100): ${t}.`);
  }
  return lines.join('\n');
}

/* ── Histórico → contents do Gemini ─────────────────────────── */
function buildContents(geminiData, newPrompt) {
  const history = (geminiData.interactions || []).slice(-16).map(turn => ({
    role: turn.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: turn.text }],
  }));
  if (newPrompt) history.push({ role: 'user', parts: [{ text: newPrompt }] });
  return history;
}

/* ── Chamada à API Gemini ───────────────────────────────────── */
async function callGemini(contents, systemText) {
  const body = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents,
    tools: TOOLS,
    generationConfig: { temperature: 0.85, maxOutputTokens: 900 },
  };

  const res = await fetch(geminiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data?.candidates?.[0]?.content || { role: 'model', parts: [] };
}

function extractParts(content) {
  const parts = content?.parts || [];
  const text = parts.filter(p => typeof p.text === 'string').map(p => p.text).join('\n').trim();
  const fnCall = parts.find(p => p.functionCall)?.functionCall || null;
  return { text, fnCall };
}

/* ── Mapeamentos PT → chaves esperadas pelo util de perfil ──── */
const ERA_NORM = { 'clássico': 'classic', 'classico': 'classic', '80s-90s': '80s90s', 'recente': 'recent' };
const COMPANY_NORM = { 'sozinho': 'solo', 'família': 'family', 'familia': 'family', 'amigos': 'friends' };

function applyRecommendationToProfile(userId, memory, perfil, args) {
  try {
    const sessionState = {
      mood: (args.humor || '').toLowerCase(),
      genres: args.generos || [],
      era: ERA_NORM[(args.era || '').toLowerCase()] || '',
      company: COMPANY_NORM[(args.companhia || '').toLowerCase()] || '',
      openness: (args.abertura || '').toLowerCase(),
    };

    // Preferências (contadores)
    const p = memory.preferences;
    const bump = (bucket, key) => { if (key) bucket[key] = (bucket[key] || 0) + 1; };
    bump(p.moods, sessionState.mood);
    (args.generos || []).forEach(g => bump(p.genres, (g || '').toLowerCase()));
    bump(p.eras, (args.era || '').toLowerCase());
    bump(p.companies, (args.companhia || '').toLowerCase());
    bump(p.openness, sessionState.openness);

    memory.sessions = (memory.sessions || 0) + 1;
    memory.lastQuiz = Date.now();

    if (perfil && perfil.tracos) {
      perfil = updateTracosFromSession(perfil, sessionState);
    }
    if (perfil && perfil.conquistas) {
      perfil = checkAndUnlockConquistas(perfil, memory);
    }
    if (perfil && Object.keys(perfil).length) {
      updatePerfil(userId, perfil);
    }
  } catch (e) {
    console.warn('Falha ao acoplar perfil:', e.message);
  }
  return perfil;
}

/* ============================================================
   POST /api/gemini/chat
   ============================================================ */
router.post('/chat', authMiddleware, async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Configuração Gemini ausente. Defina GEMINI_API_KEY no .env.' });
  }

  const { prompt, bootstrap } = req.body;
  if (!bootstrap && (!prompt || typeof prompt !== 'string')) {
    return res.status(400).json({ error: 'Prompt obrigatório.' });
  }

  const user = findUserById(req.userId);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

  const memory = loadFullMemory(user);
  let perfil = getPerfil(req.userId) || {};

  const systemText = `${SYSTEM_BASE}\n\n--- PERFIL DA PESSOA ---\n${perfilContext(user, perfil)}`;
  const userPrompt = bootstrap
    ? 'Cumprimente a pessoa pelo nome de forma calorosa e cinematográfica e faça UMA primeira pergunta para começar a conhecer o gosto dela. Não recomende filmes ainda.'
    : prompt;

  try {
    let contents = buildContents(memory.geminiData, userPrompt);
    let content = await callGemini(contents, systemText);
    let { text, fnCall } = extractParts(content);
    let movies = [];

    // Loop de function calling (1 rodada de recomendação)
    if (fnCall && fnCall.name === 'recomendar_filmes') {
      const args = fnCall.args || {};
      movies = await discoverMovies(args);

      // Acopla perfil/memória a partir das pistas reunidas
      perfil = applyRecommendationToProfile(req.userId, memory, perfil, args);

      // Segundo turno: devolve os filmes ao modelo p/ comentar
      contents = [
        ...contents,
        { role: 'model', parts: [{ functionCall: fnCall }] },
        {
          role: 'user',
          parts: [{
            functionResponse: {
              name: 'recomendar_filmes',
              response: {
                filmes: movies.map(m => ({
                  title: m.title, year: m.year, rating: m.rating, overview: m.overview,
                })),
              },
            },
          }],
        },
      ];
      content = await callGemini(contents, systemText);
      const second = extractParts(content);
      text = second.text || text;
    }

    if (!text) text = 'Hmm, me conta um pouco mais sobre o que você está a fim de assistir?';

    // Persiste conversa (a mensagem do bootstrap não vira turno visível do usuário)
    const interactions = (memory.geminiData.interactions || []).slice(-16);
    if (!bootstrap) interactions.push({ role: 'user', text: prompt, ts: Date.now() });
    interactions.push({ role: 'assistant', text, ts: Date.now() });

    memory.geminiData.interactions = interactions.slice(-20);
    memory.geminiData.lastResponse = text;
    memory.geminiData.usage = { queries: (memory.geminiData.usage?.queries || 0) + 1 };

    updateUserMemory(req.userId, memory);

    return res.json({
      response: text,
      movies,
      memory: memory.geminiData,
      perfil,
    });
  } catch (err) {
    console.error('Gemini request failed:', err.message);
    return res.status(502).json({ error: 'Não consegui falar com a IA agora. Tente novamente em instantes.', detail: err.message });
  }
});

router.get('/status', authMiddleware, (_req, res) => {
  res.json({ enabled: !!GEMINI_API_KEY, model: GEMINI_MODEL });
});

module.exports = router;
