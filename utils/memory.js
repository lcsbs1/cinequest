'use strict';

/* ============================================================
   Memória do usuário — estrutura canônica, sanitização do que
   vem do cliente e merge no servidor.
   Filmes vistos/curtidos NÃO vivem mais aqui: estão na tabela
   user_movies (ver database.js).
   ============================================================ */

const PREF_KEYS = ['moods', 'genres', 'durations', 'eras', 'companies', 'openness'];

function defaultMemory() {
  return {
    userName: '',
    sessions: 0,
    preferences: { moods: {}, genres: {}, durations: {}, eras: {}, companies: {}, openness: {} },
    lastQuiz: null,
    geminiData: { interactions: [], ideas: [], lastResponse: '', usage: { queries: 0 } },
  };
}

function sanitizeCounterBucket(bucket, maxKeys = 50) {
  const out = {};
  if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return out;
  for (const [k, v] of Object.entries(bucket).slice(0, maxKeys)) {
    const n = Number(v);
    if (k.length <= 60 && Number.isFinite(n) && n >= 0) out[k] = Math.min(Math.floor(n), 10000);
  }
  return out;
}

/**
 * Reduz o payload do cliente à estrutura canônica, com limites de
 * tamanho. Chaves desconhecidas (inclusive likedMovies/dislikedMovies
 * legadas e qualquer coisa de perfil/conquistas) são descartadas.
 */
function sanitizeClientMemory(raw) {
  const mem = defaultMemory();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return mem;

  if (typeof raw.userName === 'string') mem.userName = raw.userName.slice(0, 120);

  const sessions = Number(raw.sessions);
  if (Number.isFinite(sessions) && sessions >= 0) mem.sessions = Math.min(Math.floor(sessions), 100000);

  for (const key of PREF_KEYS) {
    mem.preferences[key] = sanitizeCounterBucket(raw.preferences?.[key]);
  }

  const lastQuiz = Number(raw.lastQuiz);
  mem.lastQuiz = Number.isFinite(lastQuiz) && lastQuiz > 0 ? lastQuiz : null;

  const gd = (raw.geminiData && typeof raw.geminiData === 'object') ? raw.geminiData : {};
  mem.geminiData.interactions = Array.isArray(gd.interactions)
    ? gd.interactions
        .slice(-20)
        .filter(t => t && typeof t.text === 'string' && (t.role === 'user' || t.role === 'assistant'))
        .map(t => ({ role: t.role, text: t.text.slice(0, 4000), ts: Number(t.ts) || Date.now() }))
    : [];
  mem.geminiData.lastResponse = typeof gd.lastResponse === 'string' ? gd.lastResponse.slice(0, 4000) : '';
  const queries = Number(gd.usage?.queries);
  mem.geminiData.usage.queries = Number.isFinite(queries) && queries >= 0 ? Math.floor(queries) : 0;

  return mem;
}

/**
 * Combina a memória persistida com a sanitizada vinda do cliente.
 * Contadores nunca regridem (max); o histórico de conversa é do
 * cliente (é ele quem inicia "nova conversa").
 */
function mergeMemory(server, client) {
  const base = defaultMemory();
  const s = (server && typeof server === 'object') ? server : {};
  const merged = { ...base };

  merged.userName = client.userName || s.userName || '';
  merged.sessions = Math.max(s.sessions || 0, client.sessions || 0);

  for (const key of PREF_KEYS) {
    const bucket = { ...(s.preferences?.[key] || {}) };
    for (const [k, v] of Object.entries(client.preferences[key])) {
      bucket[k] = Math.max(bucket[k] || 0, v);
    }
    merged.preferences[key] = bucket;
  }

  merged.lastQuiz = Math.max(s.lastQuiz || 0, client.lastQuiz || 0) || null;

  const sGd = s.geminiData || {};
  merged.geminiData = {
    interactions: client.geminiData.interactions,
    ideas: Array.isArray(sGd.ideas) ? sGd.ideas.slice(-20) : [],
    lastResponse: client.geminiData.lastResponse || sGd.lastResponse || '',
    usage: { queries: Math.max(sGd.usage?.queries || 0, client.geminiData.usage.queries) },
  };

  return merged;
}

module.exports = { defaultMemory, sanitizeClientMemory, mergeMemory, PREF_KEYS };
