/* ============================================================
   CINEQUEST — Curador de cinema com IA (Gemini)
   Conversa única acoplada à IA + memória + Perfil Cinematográfico
   ============================================================ */

const MEMORY_KEY     = 'cinequest_memory';
const AUTH_TOKEN_KEY = 'cinequest_token';
const API_BASE       = ''; // mesmo servidor (Express)

/* ── Metadados do Perfil Cinematográfico ───────────────────── */
const CONQUISTAS_META = {
  primeiro_quiz:    { nome: 'Primeira Sessão',     simbolo: '◈' },
  cinco_filmes:     { nome: 'Cinéfilo Iniciante',  simbolo: '▲' },
  semana_cineasta:  { nome: 'Semana do Cineasta',  simbolo: '⬡' },
  oraculo_badge:    { nome: 'Visão do Oráculo',    simbolo: '⬡' },
  coleccionador:    { nome: 'Colecionador',        simbolo: '◉' },
  critico_feroz:    { nome: 'Crítico Feroz',       simbolo: '◆' },
  primeiro_visto:   { nome: 'Luzes Apagadas',      simbolo: '✓' },
  maratonista:      { nome: 'Maratonista',         simbolo: '▶' },
  mestre_do_cinema: { nome: 'Mestre do Cinema',    simbolo: '✦' },
};

const TRACO_LABELS = {
  emotividade: 'Emotividade',
  aventura:    'Aventura',
  nostalgia:   'Nostalgia',
  intensidade: 'Intensidade',
  curiosidade: 'Curiosidade',
  solidao:     'Solidão',
};

/* ── Estado global ─────────────────────────────────────────── */
let memory          = loadMemory();
let currentUser     = null;
let currentPerfil   = null;
let memorySyncTimer = null;

// Estado dos filmes (visto/reação) — fonte de verdade é o servidor (tabela user_movies)
const movieState        = new Map();
let currentStats        = null;
let currentConhecimento = null;

/* ── Referências DOM ───────────────────────────────────────── */
const appWrapper    = document.querySelector('.app-wrapper');
const chatContainer = document.getElementById('chatContainer');
const inputArea     = document.getElementById('inputArea');
const chatInput     = document.getElementById('chatInput');
const sendBtn       = document.getElementById('sendBtn');
const restartBtn    = document.getElementById('restartBtn');
const userPill      = document.getElementById('userPill');
const userPillName  = document.getElementById('userPillName');
const authPanel     = document.getElementById('authPanel');
const authTabs      = document.getElementById('authTabs');
const authAlert     = document.getElementById('authAlert');
const loginForm     = document.getElementById('loginForm');
const registerForm  = document.getElementById('registerForm');
const profileView   = document.getElementById('profileView');
const logoutBtn     = document.getElementById('logoutBtn');
const goQuizBtn     = document.getElementById('goQuizBtn');

/* ============================================================
   UTILITÁRIOS
   ============================================================ */
const sleep        = ms => new Promise(r => setTimeout(r, ms));
const scrollBottom = () => chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });

function escapeHtml(s = '') {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function formatAIText(s = '') {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}
function formatDateBR(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}
function formatPhoneBR(phone = '') {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11) return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0,2)}) ${digits.slice(2,6)}-${digits.slice(6)}`;
  return phone;
}
function maskBRPhone(input) {
  const d = input.value.replace(/\D/g, '').slice(0, 11);
  let out = d.slice(0, 2);
  if (d.length > 2) out += ' ' + d.slice(2, 3);
  if (d.length > 3) out += ' ' + d.slice(3, 7);
  if (d.length > 7) out += d.slice(7, 11);
  input.value = out;
}

/* ============================================================
   MEMÓRIA — local + sincronização com servidor
   ============================================================ */
function defaultMemory() {
  return {
    userName: '',
    sessions: 0,
    preferences: { moods: {}, genres: {}, durations: {}, eras: {}, companies: {}, openness: {} },
    lastQuiz: null,
    geminiData: { interactions: [], ideas: [], lastResponse: '', usage: { queries: 0 } },
  };
}

function loadMemory() {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    const mem = raw ? { ...defaultMemory(), ...JSON.parse(raw) } : defaultMemory();
    // Filmes agora vivem no servidor (user_movies) — limpa resquícios locais
    delete mem.likedMovies;
    delete mem.dislikedMovies;
    return mem;
  } catch {
    return defaultMemory();
  }
}

function saveMemory() {
  try { localStorage.setItem(MEMORY_KEY, JSON.stringify(memory)); } catch {}
  scheduleMemorySync();
}

function mergeMemory(serverMemory) {
  if (!serverMemory || typeof serverMemory !== 'object') return;
  const local = loadMemory();
  const merged = { ...defaultMemory(), ...local };

  merged.sessions = Math.max(local.sessions || 0, serverMemory.sessions || 0);
  merged.userName = serverMemory.userName || local.userName || currentUser?.nome || '';

  ['moods', 'genres', 'durations', 'eras', 'companies', 'openness'].forEach(key => {
    const bucket = { ...(serverMemory.preferences?.[key] || {}), ...(local.preferences?.[key] || {}) };
    Object.entries(serverMemory.preferences?.[key] || {}).forEach(([k, v]) => {
      bucket[k] = Math.max(bucket[k] || 0, v);
    });
    merged.preferences[key] = bucket;
  });

  merged.lastQuiz = serverMemory.lastQuiz || local.lastQuiz;

  merged.geminiData = {
    interactions: (serverMemory.geminiData?.interactions || local.geminiData?.interactions || []).slice(-20),
    ideas: [...(serverMemory.geminiData?.ideas || []), ...(local.geminiData?.ideas || [])].slice(-20),
    lastResponse: serverMemory.geminiData?.lastResponse || local.geminiData?.lastResponse || '',
    usage: { queries: Math.max(serverMemory.geminiData?.usage?.queries || 0, local.geminiData?.usage?.queries || 0) },
  };

  memory = merged;
  try { localStorage.setItem(MEMORY_KEY, JSON.stringify(memory)); } catch {}
}

function scheduleMemorySync() {
  if (!getAuthToken()) return;
  clearTimeout(memorySyncTimer);
  memorySyncTimer = setTimeout(syncMemoryToServer, 800);
}

async function syncMemoryToServer() {
  if (!getAuthToken()) return;
  try {
    await apiFetch('/api/user/memory', { method: 'PUT', body: JSON.stringify({ memory }) });
  } catch (err) {
    console.warn('Falha ao sincronizar memória:', err.message);
  }
}

/* ── Feedback de filmes — persistido no servidor (user_movies) ── */
async function hydrateMovieState() {
  if (!getAuthToken()) return;
  try {
    const data = await apiFetch('/api/user/movies');
    movieState.clear();
    (data.movies || []).forEach(m => movieState.set(m.movieId, { reaction: m.reaction, watched: m.watched }));
    if (data.stats) currentStats = { ...(currentStats || {}), ...data.stats };
  } catch (err) {
    console.warn('Falha ao carregar filmes do servidor:', err.message);
  }
}

// UI otimista: aplica o estado local imediatamente e faz rollback se a API falhar
async function sendMovieAction(filme, action) {
  const prev = { ...(movieState.get(filme.id) || { reaction: null, watched: false }) };
  const next = { ...prev };
  if (action === 'liked' || action === 'disliked') next.reaction = action;
  if (action === 'clear_reaction') next.reaction = null;
  if (action === 'watched') next.watched = true;
  if (action === 'unwatched') next.watched = false;
  movieState.set(filme.id, next);

  try {
    const data = await apiFetch('/api/user/movies', {
      method: 'POST',
      body: JSON.stringify({
        movieId: filme.id,
        title: filme.title,
        posterPath: filme.poster || null,
        genreIds: filme.genreIds || [],
        action,
      }),
    });
    if (data.movie) movieState.set(filme.id, { reaction: data.movie.reaction, watched: data.movie.watched });
    if (data.perfil) currentPerfil = data.perfil;
    if (data.stats) currentStats = data.stats;
    if (data.conhecimento) currentConhecimento = data.conhecimento;
  } catch (err) {
    movieState.set(filme.id, prev);
    console.warn('Falha ao registrar feedback:', err.message);
  }
}

function getTopPreference(key, n = 3) {
  const bucket = memory.preferences[key] || {};
  return Object.entries(bucket).sort((a, b) => b[1] - a[1]).slice(0, n).map(([v]) => v);
}

/* ============================================================
   API helper
   ============================================================ */
function getAuthToken() { return localStorage.getItem(AUTH_TOKEN_KEY); }
function setAuthToken(token) {
  if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
  else localStorage.removeItem(AUTH_TOKEN_KEY);
}

async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro na requisição');
  return data;
}

/* ============================================================
   MENSAGENS
   ============================================================ */
function addBotMessage(html) {
  removeEmptyState();
  const wrap = document.createElement('div');
  wrap.className = 'message';
  wrap.innerHTML = `
    <div class="bot-bubble">
      <div class="bot-avatar">🎬</div>
      <div class="bot-text">${html}</div>
    </div>`;
  chatContainer.appendChild(wrap);
  scrollBottom();
}

function addUserMessage(text) {
  removeEmptyState();
  const wrap = document.createElement('div');
  wrap.className = 'message';
  wrap.innerHTML = `<div class="user-bubble"><div class="user-text">${escapeHtml(text)}</div></div>`;
  chatContainer.appendChild(wrap);
  scrollBottom();
}

function addTyping() {
  const wrap = document.createElement('div');
  wrap.className = 'typing-indicator';
  wrap.innerHTML = `
    <div class="bot-avatar">🎬</div>
    <div class="typing-dots"><span></span><span></span><span></span></div>`;
  chatContainer.appendChild(wrap);
  scrollBottom();
  return wrap;
}

function renderEmptyState() {
  if (chatContainer.querySelector('.chat-empty')) return;
  const node = document.createElement('div');
  node.className = 'chat-empty';
  node.innerHTML = `
    <div class="chat-empty-glyph">✦</div>
    <div class="chat-empty-title">O que você quer<br>descobrir hoje?</div>
    <div class="chat-empty-sub">Conte o que está sentindo, com quem vai assistir, ou deixe o curador te surpreender.</div>
    <div class="empty-chips">
      <button class="empty-chip" data-prompt="Quero algo que me surpreenda — algo que nunca teria escolhido sozinho">Algo inesperado</button>
      <button class="empty-chip" data-prompt="Quero relaxar assistindo algo leve e agradável">Para relaxar</button>
      <button class="empty-chip" data-prompt="Me recomende um clássico que não posso deixar de ver">Clássico imperdível</button>
    </div>`;
  node.querySelectorAll('.empty-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      chatInput.value = chip.dataset.prompt;
      handleSend();
    });
  });
  chatContainer.appendChild(node);
}
function removeEmptyState() {
  chatContainer.querySelector('.chat-empty')?.remove();
}

/* ── Cards de filme (recomendações reais do TMDb) ──────────── */
function renderMovieCards(movies) {
  removeEmptyState();
  const wrap = document.createElement('div');
  wrap.className = 'message';
  const cards = document.createElement('div');
  cards.className = 'rec-cards';

  movies.forEach(filme => {
    const nota = filme.rating != null ? filme.rating.toFixed(1) : '—';
    const poster = filme.poster
      ? `<img class="film-poster" src="${filme.poster}" alt="${escapeHtml(filme.title)}" loading="lazy" />`
      : `<div class="film-poster-fallback">🎬</div>`;
    const state    = movieState.get(filme.id) || {};
    const liked    = state.reaction === 'liked';
    const disliked = state.reaction === 'disliked';
    const watched  = !!state.watched;

    const card = document.createElement('div');
    card.className = 'film-card';
    card.innerHTML = `
      ${poster}
      <div class="film-info">
        <div class="film-title">${escapeHtml(filme.title)}</div>
        <div class="film-meta">${filme.year || '—'}<span class="film-rating">★ ${nota}</span></div>
        <div class="film-desc">${escapeHtml(filme.overview || 'Sinopse não disponível em português.')}</div>
        <div class="film-feedback">
          <button class="feedback-btn watched-btn ${watched ? 'active' : ''}" data-action="watched">✓ Já assisti</button>
          <button class="feedback-btn like-btn ${liked ? 'active' : ''}" data-action="like">👍 Gostei</button>
          <button class="feedback-btn dislike-btn ${disliked ? 'active' : ''}" data-action="dislike">👎 Não curti</button>
        </div>
      </div>`;

    const syncCard = () => {
      const st = movieState.get(filme.id) || {};
      card.querySelector('.watched-btn').classList.toggle('active', !!st.watched);
      card.querySelector('.like-btn').classList.toggle('active', st.reaction === 'liked');
      card.querySelector('.dislike-btn').classList.toggle('active', st.reaction === 'disliked');
    };

    card.querySelectorAll('.feedback-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const st = movieState.get(filme.id) || {};
        let action;
        if (btn.dataset.action === 'watched')   action = st.watched ? 'unwatched' : 'watched';
        else if (btn.dataset.action === 'like') action = st.reaction === 'liked' ? 'clear_reaction' : 'liked';
        else                                    action = st.reaction === 'disliked' ? 'clear_reaction' : 'disliked';

        const request = sendMovieAction(filme, action);
        syncCard();        // estado otimista já aplicado
        await request;
        syncCard();        // confirma (ou desfaz, em caso de erro)
      });
    });

    cards.appendChild(card);
  });

  wrap.appendChild(cards);
  chatContainer.appendChild(wrap);
  scrollBottom();
}

/* ============================================================
   CONVERSA COM A IA (núcleo)
   ============================================================ */
function startChat() {
  if (!currentUser) { showAccount(); return; }
  appWrapper.classList.remove('account-mode');
  authPanel.style.display = 'none';
  if (chatContainer.children.length) return; // já populado

  const history = memory.geminiData?.interactions || [];
  if (history.length) {
    history.forEach(t => {
      if (t.role === 'user') addUserMessage(t.text);
      else addBotMessage(formatAIText(t.text));
    });
  } else {
    // Sem chamada à IA no carregamento: o empty state já convida à conversa
    renderEmptyState();
  }
}

function newConversation() {
  memory.geminiData = { ...(memory.geminiData || {}), interactions: [] };
  saveMemory();
  chatContainer.innerHTML = '';
  startChat();
}

let chatBusy = false;
async function sendToGemini(text, { bootstrap = false } = {}) {
  if (chatBusy) return;
  if (!currentUser) { showAccount(); return; }
  chatBusy = true;
  sendBtn.disabled = true;

  if (!bootstrap) addUserMessage(text);
  const typing = addTyping();

  try {
    const payload = bootstrap ? { bootstrap: true } : { prompt: text };
    const data = await apiFetch('/api/gemini/chat', { method: 'POST', body: JSON.stringify(payload) });

    typing.remove();
    addBotMessage(formatAIText(data.response || '...'));

    if (Array.isArray(data.movies) && data.movies.length) {
      renderMovieCards(data.movies);
      memory.sessions = (memory.sessions || 0) + 1;
    }

    if (data.memory) memory.geminiData = data.memory;
    if (data.perfil) currentPerfil = data.perfil;
    try { localStorage.setItem(MEMORY_KEY, JSON.stringify(memory)); } catch {}
  } catch (err) {
    typing.remove();
    addBotMessage(`😕 ${escapeHtml(err.message || 'Não consegui responder agora. Tente novamente.')}`);
  } finally {
    chatBusy = false;
    sendBtn.disabled = false;
    chatInput.focus();
  }
}

function handleSend() {
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  sendToGemini(text);
}

/* ============================================================
   VISÕES — conversa x conta
   ============================================================ */
function showChat() {
  if (!currentUser) { showAccount(); return; }
  startChat();
}

async function showAccount() {
  appWrapper.classList.add('account-mode');
  authPanel.style.display = 'block';
  if (currentUser) {
    // Perfil, stats e nota de conhecimento sempre frescos do servidor
    try {
      const data = await apiFetch('/api/user/perfil');
      if (data.perfil) currentPerfil = data.perfil;
      if (data.stats) currentStats = data.stats;
      if (data.conhecimento) currentConhecimento = data.conhecimento;
    } catch (err) {
      console.warn('Falha ao atualizar perfil:', err.message);
    }
  }
  renderAuthPanel();
}

function updateAuthUI() {
  const loggedIn = !!currentUser;
  userPill.style.display = loggedIn ? 'inline-flex' : 'none';
  if (loggedIn) userPillName.textContent = currentUser.nome.split(' ')[0];
}

/* ============================================================
   AUTENTICAÇÃO / CONTA
   ============================================================ */
function showAuthAlert(message, type = 'error') {
  authAlert.textContent = message;
  authAlert.className = `auth-alert ${type}`;
  authAlert.style.display = 'block';
}
function hideAuthAlert() { authAlert.style.display = 'none'; }

function renderAuthPanel() {
  hideAuthAlert();
  if (currentUser) {
    authPanel.classList.add('is-logged-in');
    authTabs.style.display = 'none';
    loginForm.style.display = 'none';
    registerForm.style.display = 'none';
    profileView.style.display = 'block';
    renderProfileView(currentUser, currentPerfil, memory);
  } else {
    authPanel.classList.remove('is-logged-in');
    authTabs.style.display = 'flex';
    profileView.style.display = 'none';
    const activeTab = authTabs.querySelector('.auth-tab.active')?.dataset.tab || 'login';
    loginForm.style.display    = activeTab === 'login'    ? 'flex' : 'none';
    registerForm.style.display = activeTab === 'register' ? 'flex' : 'none';
  }
}

function renderProfileView(user, perfil, mem) {
  const glyph = document.getElementById('arquetipoGlyph');
  const arquetipoNome = document.getElementById('arquetipoNome');
  const arquetipoDesc = document.getElementById('arquetipoDesc');
  const isFirstReveal = perfil?.arquetipo && !perfil.arquetipo.revelado;

  if (perfil?.arquetipo) {
    glyph.textContent = perfil.arquetipo.simbolo || '◈';
    glyph.style.color = perfil.arquetipo.cor || 'var(--cyan)';
    glyph.style.textShadow = `0 0 16px ${perfil.arquetipo.cor || 'var(--cyan)'}`;
    glyph.style.boxShadow = `inset 0 0 24px ${perfil.arquetipo.cor}22, 0 0 28px ${perfil.arquetipo.cor}14`;
    arquetipoNome.textContent = perfil.arquetipo.nome || '—';
    if (perfil.arquetipo.descricao) {
      arquetipoDesc.textContent = perfil.arquetipo.descricao;
      arquetipoDesc.style.display = 'block';
    }
    if (isFirstReveal) {
      glyph.classList.add('arquetipo-intro');
      glyph.addEventListener('animationend', () => glyph.classList.remove('arquetipo-intro'), { once: true });
    }
  }

  document.getElementById('profileName').textContent = user.nome;
  document.getElementById('profileEmail').textContent = user.email;
  document.getElementById('profileDispNome').textContent = user.nome;
  document.getElementById('profilePhone').textContent = formatPhoneBR(user.telefone);
  document.getElementById('profileBirth').textContent = formatDateBR(user.data_nascimento);
  document.getElementById('profileSince').textContent = user.created_at
    ? new Date(user.created_at + 'Z').toLocaleDateString('pt-BR') : '—';

  // Semente (DNA)
  if (perfil?.semente?.palavras) {
    const palavras = perfil.semente.palavras;
    if (!perfil.semente.revelada || isFirstReveal) {
      revealSemente(palavras);
    } else {
      document.getElementById('sWord0').textContent = palavras[0] || '';
      document.getElementById('sWord1').textContent = palavras[1] || '';
      document.getElementById('sWord2').textContent = palavras[2] || '';
    }
  }

  // Traços
  const tracosGrid = document.getElementById('tracosGrid');
  tracosGrid.innerHTML = '';
  if (perfil?.tracos) {
    for (const [key, val] of Object.entries(perfil.tracos)) {
      const label = TRACO_LABELS[key] || key;
      const row = document.createElement('div');
      row.className = 'traco-row';
      row.innerHTML = `
        <span class="traco-label">${label}</span>
        <div class="traco-bar-track"><div class="traco-bar-fill" data-val="${val}" style="width:0"></div></div>
        <span class="traco-value">${val}</span>`;
      tracosGrid.appendChild(row);
    }
    setTimeout(() => {
      tracosGrid.querySelectorAll('.traco-bar-fill').forEach(bar => { bar.style.width = bar.dataset.val + '%'; });
    }, 120);
  }

  // Stats com count-up — vindas do servidor (tabela user_movies)
  const stats = currentStats || {};
  countUp(document.getElementById('statWatched'),  stats.watched ?? 0);
  countUp(document.getElementById('statLiked'),    stats.liked ?? 0);
  countUp(document.getElementById('statDisliked'), stats.disliked ?? 0);
  countUp(document.getElementById('statSessions'), stats.sessions ?? mem.sessions ?? 0);

  // Nota de conhecimento cinematográfico
  renderConhecimento(currentConhecimento);

  const topGenres = getTopPreference('genres', 3);
  document.getElementById('genreChipsProfile').innerHTML =
    topGenres.map(g => `<span class="genre-chip-profile">${escapeHtml(g)}</span>`).join('');

  // Conquistas
  const grid = document.getElementById('conquistasGrid');
  grid.innerHTML = '';
  const conquistas = perfil?.conquistas || Object.keys(CONQUISTAS_META).map(id => ({ id, desbloqueada: false }));
  for (const c of conquistas) {
    const meta = CONQUISTAS_META[c.id];
    if (!meta) continue;
    const card = document.createElement('div');
    card.className = `conquista-card ${c.desbloqueada ? 'desbloqueada' : 'bloqueada'}`;
    card.innerHTML = `<span class="conquista-glyph">${meta.simbolo}</span><div class="conquista-nome">${meta.nome}</div>`;
    if (c.desbloqueada && c.desbloqueada_em) card.title = new Date(c.desbloqueada_em).toLocaleDateString('pt-BR');
    grid.appendChild(card);
  }

  // Primeira revelação → marca no servidor
  if (isFirstReveal) {
    apiFetch('/api/user/perfil/reveal', { method: 'POST' }).catch(() => {});
    if (currentPerfil?.arquetipo) currentPerfil.arquetipo.revelado = true;
    if (currentPerfil?.semente) currentPerfil.semente.revelada = true;
  }

  setupInlineEdit();
  setTimeout(setupProfileScrollReveal, 100);
}

function renderConhecimento(c) {
  const nivelEl  = document.getElementById('conhecimentoNivel');
  const pontosEl = document.getElementById('conhecimentoPontos');
  const barEl    = document.getElementById('conhecimentoBar');
  const nextEl   = document.getElementById('conhecimentoNext');
  if (!nivelEl || !pontosEl || !barEl || !nextEl) return;

  const conhecimento = c || { pontos: 0, nivel: { nome: 'Iniciante' }, proximoNivel: null, progresso: 0 };
  nivelEl.textContent  = conhecimento.nivel?.nome || 'Iniciante';
  pontosEl.textContent = `${conhecimento.pontos || 0} pts`;
  nextEl.textContent   = conhecimento.proximoNivel
    ? `Próximo nível: ${conhecimento.proximoNivel.nome} (${conhecimento.proximoNivel.min} pts)`
    : 'Nível máximo alcançado ✦';

  barEl.style.width = '0';
  setTimeout(() => {
    barEl.style.width = `${Math.round((conhecimento.progresso || 0) * 100)}%`;
  }, 150);
}

function countUp(el, target) {
  if (!el || target === 0) { if (el) el.textContent = 0; return; }
  const duration = 800;
  const start = Date.now();
  const tick = () => {
    const elapsed = Date.now() - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(eased * target);
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function setupProfileScrollReveal() {
  const sections = document.querySelectorAll('.profile-section');
  if (!sections.length) return;
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        setTimeout(() => entry.target.classList.add('revealed'), i * 60);
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  sections.forEach(s => obs.observe(s));
}

function revealSemente(palavras) {
  const spans = ['sWord0', 'sWord1', 'sWord2'];
  spans.forEach(id => { document.getElementById(id).innerHTML = ''; });
  let wordIdx = 0, charIdx = 0;

  function tick() {
    if (wordIdx >= palavras.length) return;
    const el = document.getElementById(spans[wordIdx]);
    const word = palavras[wordIdx] || '';
    if (charIdx < word.length) {
      const span = document.createElement('span');
      span.className = 'semente-char';
      span.style.animationDelay = `${charIdx * 60}ms`;
      span.textContent = word[charIdx];
      el.appendChild(span);
      charIdx++;
      setTimeout(tick, 60);
    } else {
      wordIdx++; charIdx = 0;
      setTimeout(tick, 180);
    }
  }
  tick();
}

function setupInlineEdit() {
  const form = document.getElementById('inlineEditForm');
  const infoCard = document.querySelector('.profile-info-card');
  if (!form || !infoCard) return;

  const newForm = form.cloneNode(true);
  form.parentNode.replaceChild(newForm, form);

  document.querySelectorAll('.edit-field-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('editNome').value = currentUser?.nome || '';
      document.getElementById('editTelefone').value = currentUser?.telefone || '';
      infoCard.style.display = 'none';
      newForm.style.display = 'flex';
    });
  });

  document.getElementById('cancelEditBtn').addEventListener('click', () => {
    newForm.style.display = 'none';
    infoCard.style.display = 'block';
  });

  newForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('saveProfileBtn');
    btn.disabled = true; btn.textContent = 'Salvando...';
    try {
      const data = await apiFetch('/api/user/profile', {
        method: 'PUT',
        body: JSON.stringify({
          nome: document.getElementById('editNome').value,
          telefone: document.getElementById('editTelefone').value,
          data_nascimento: currentUser.data_nascimento,
        }),
      });
      currentUser = data.user;
      newForm.style.display = 'none';
      infoCard.style.display = 'block';
      renderProfileView(currentUser, currentPerfil, memory);
      updateAuthUI();
    } catch (err) {
      showAuthAlert(err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Salvar';
    }
  });
}

function switchAuthTab(tab) {
  authTabs.querySelectorAll('.auth-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  hideAuthAlert();
  loginForm.style.display    = tab === 'login'    ? 'flex' : 'none';
  registerForm.style.display = tab === 'register' ? 'flex' : 'none';
}

async function handleLogin(e) {
  e.preventDefault();
  hideAuthAlert();
  const btn = document.getElementById('loginSubmitBtn');
  btn.disabled = true; btn.textContent = 'Entrando...';
  try {
    const data = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('loginEmail').value,
        senha: document.getElementById('loginSenha').value,
      }),
    });
    setAuthToken(data.token);
    currentUser = data.user;
    currentPerfil = data.user.perfil || null;
    if (data.user.memory) mergeMemory(data.user.memory);
    memory.userName = currentUser.nome;
    saveMemory();
    await hydrateMovieState();
    updateAuthUI();
    loginForm.reset();
    chatContainer.innerHTML = '';
    showChat();
  } catch (err) {
    showAuthAlert(err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar na conta';
  }
}

async function handleRegister(e) {
  e.preventDefault();
  hideAuthAlert();
  const btn = document.getElementById('registerSubmitBtn');
  btn.disabled = true; btn.textContent = 'Criando conta...';
  try {
    const data = await apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        nome: document.getElementById('regNome').value,
        email: document.getElementById('regEmail').value,
        telefone: '+55 ' + document.getElementById('regTelefone').value,
        data_nascimento: document.getElementById('regNascimento').value,
        senha: document.getElementById('regSenha').value,
        confirmar_senha: document.getElementById('regConfirmar').value,
      }),
    });
    setAuthToken(data.token);
    currentUser = data.user;
    currentPerfil = data.user.perfil || null;
    mergeMemory(data.user.memory || {});
    memory.userName = currentUser.nome;
    saveMemory();
    movieState.clear();
    currentStats = null;
    currentConhecimento = null;
    updateAuthUI();
    registerForm.reset();
    chatContainer.innerHTML = '';
    showChat();
  } catch (err) {
    showAuthAlert(err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Criar minha conta';
  }
}

function handleLogout() {
  setAuthToken(null);
  currentUser = null;
  currentPerfil = null;
  currentStats = null;
  currentConhecimento = null;
  movieState.clear();
  chatContainer.innerHTML = '';
  updateAuthUI();
  showAccount();
  showAuthAlert('Você saiu da conta. Suas preferências locais foram mantidas.', 'success');
}

async function checkSession() {
  const token = getAuthToken();
  if (!token) return;
  try {
    const data = await apiFetch('/api/auth/me');
    currentUser = data.user;
    currentPerfil = data.user.perfil || null;
    currentStats = data.stats || null;
    currentConhecimento = data.conhecimento || null;
    if (data.user.memory) mergeMemory(data.user.memory);
    memory.userName = currentUser.nome;
    try { localStorage.setItem(MEMORY_KEY, JSON.stringify(memory)); } catch {}
    await hydrateMovieState();
    updateAuthUI();
  } catch {
    setAuthToken(null);
    currentUser = null;
    currentPerfil = null;
  }
}

/* ============================================================
   EVENTOS
   ============================================================ */
sendBtn.addEventListener('click', handleSend);
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleSend(); });
restartBtn.addEventListener('click', () => { if (currentUser) newConversation(); });
userPill.addEventListener('click', () => showAccount());

authTabs.querySelectorAll('.auth-tab').forEach(btn => btn.addEventListener('click', () => switchAuthTab(btn.dataset.tab)));
loginForm.addEventListener('submit', handleLogin);
registerForm.addEventListener('submit', handleRegister);
document.getElementById('regTelefone').addEventListener('input', e => maskBRPhone(e.target));
logoutBtn.addEventListener('click', handleLogout);
goQuizBtn.addEventListener('click', () => showChat());
document.getElementById('authCloseBtn')?.addEventListener('click', () => { if (currentUser) showChat(); });

/* ── Char counter ── */
const charCountEl = document.getElementById('inputCharCount');
chatInput.addEventListener('input', () => {
  const len = chatInput.value.length;
  const max = parseInt(chatInput.maxLength, 10) || 280;
  if (!charCountEl) return;
  if (len === 0) {
    charCountEl.classList.remove('visible', 'warn', 'limit');
    return;
  }
  charCountEl.textContent = `${len}/${max}`;
  charCountEl.classList.add('visible');
  charCountEl.classList.toggle('warn',  len > max * 0.85);
  charCountEl.classList.toggle('limit', len > max * 0.96);
});

/* ── Header scroll blur ── */
const siteHeader = document.querySelector('.site-header');
chatContainer.addEventListener('scroll', () => {
  siteHeader?.classList.toggle('scrolled', chatContainer.scrollTop > 8);
}, { passive: true });

/* ── Micro-shake no envio ── */
const origHandleSend = handleSend;
// patch send to shake input on empty
sendBtn.addEventListener('click', () => {
  if (!chatInput.value.trim()) {
    const wrapper = chatInput.closest('.input-wrapper');
    wrapper?.classList.add('shake');
    wrapper?.addEventListener('animationend', () => wrapper.classList.remove('shake'), { once: true });
  }
}, true);

/* ============================================================
   FUNDO DE PARTÍCULAS
   ============================================================ */
function initParticleBackground() {
  const canvas = document.getElementById('particles');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w, h, points;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    w = canvas.width = innerWidth * DPR;
    h = canvas.height = innerHeight * DPR;
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
    const n = Math.min(55, Math.floor(innerWidth / 28));
    points = Array.from({ length: n }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.3 * DPR,
      vy: (Math.random() - 0.5) * 0.3 * DPR,
      r: (Math.random() * 1.2 + 0.5) * DPR,
    }));
  }

  let rafId = null;

  function tick() {
    ctx.clearRect(0, 0, w, h);

    for (const p of points) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;

      // Traço de filme: linha curta na direção do movimento
      const tailLen = 8 * DPR;
      ctx.beginPath();
      ctx.moveTo(p.x - p.vx * tailLen, p.y - p.vy * tailLen);
      ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = 'rgba(45, 228, 255, 0.55)';
      ctx.lineWidth = p.r;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    const max = 120 * DPR;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i], b = points[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < max) {
          ctx.globalAlpha = (1 - d / max) * 0.14;
          ctx.strokeStyle = '#2de4ff'; ctx.lineWidth = DPR * 0.5;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  // Pausa a animação quando a aba não está visível (economia de CPU/bateria)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(rafId);
      rafId = null;
    } else if (rafId === null) {
      rafId = requestAnimationFrame(tick);
    }
  });

  addEventListener('resize', resize);
  resize();
  rafId = requestAnimationFrame(tick);
}

/* ============================================================
   INIT
   ============================================================ */
(async function init() {
  initParticleBackground();
  await checkSession();
  if (currentUser) showChat();
  else showAccount();
})();
