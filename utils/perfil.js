'use strict';

const ARCHETYPES = [
  { id: 'flaneur',       nome: 'O Flâneur',       simbolo: '◈', cor: '#38e8ff', descricao: 'Você observa o mundo com distância poética. Prefere filmes contemplativos, cenas longas, silêncios expressivos. Flui sem destino fixo — e absorve tudo.' },
  { id: 'oraculo',       nome: 'O Oráculo',        simbolo: '⬡', cor: '#8b5cf6', descricao: 'Você busca padrões ocultos e verdades em filmes densos. Ama narrativas não-lineares, simbolismo e finais abertos que exigem interpretação.' },
  { id: 'sombra',        nome: 'A Sombra',         simbolo: '◆', cor: '#f871a0', descricao: 'Você é atraído pelo lado negro — noir, thriller psicológico, antihéróis. Vive na tensão e encontra beleza na escuridão.' },
  { id: 'pioneiro',      nome: 'O Pioneiro',       simbolo: '▲', cor: '#4ade80', descricao: 'Sempre em busca do próximo, do não visto, do cult. A vanguarda e o desconforto te alimentam. Você descobre antes de todo mundo.' },
  { id: 'contemplativo', nome: 'O Contemplativo',  simbolo: '○', cor: '#7af3ff', descricao: 'Lento, profundo, sensível. Você ama filmes de câmera lenta, silêncios que falam e histórias que ficam.' },
  { id: 'arquiteto',     nome: 'O Arquiteto',      simbolo: '◻', cor: '#a855f7', descricao: 'Você vê o cinema como construção: roteiro, estrutura, plot twist. Analisa mais do que sente — e encontra prazer na engenharia narrativa.' },
  { id: 'nomade',        nome: 'O Nômade',         simbolo: '⟐', cor: '#38e8ff', descricao: 'Sem gênero fixo, sem era preferida — o acaso é o seu guia. Você ama a descoberta aleatória e não tem preconceitos.' },
  { id: 'mago',          nome: 'O Mago',           simbolo: '✦', cor: '#8b5cf6', descricao: 'Encantado por fantasia, ficção científica e mundos construídos do zero. A magia da tela é o que te move.' },
  { id: 'sentinela',     nome: 'O Sentinela',      simbolo: '◉', cor: '#f871a0', descricao: 'Você está conectado com o coletivo — filmes que revelam a sociedade, o humano, o político. Cinema é espelho do mundo.' },
  { id: 'cronista',      nome: 'O Cronista',       simbolo: '▣', cor: '#4ade80', descricao: 'Memória afetiva é tudo. Nostálgico e arquivista, você re-assiste, compara épocas e coleciona filmes como quem guarda memórias.' },
];

const SEMENTE_POOL = {
  cosmos: [
    'abismo', 'crepúsculo', 'éter', 'nebulosa', 'eclipse', 'aurora', 'vórtice',
    'penumbra', 'horizonte', 'solstício', 'zênite', 'nadir', 'constelação',
    'pulsação', 'singularidade', 'quasar', 'fóton', 'gravidade', 'paradoxo',
    'infinito', 'vácuo', 'colisão', 'órbita', 'intermitência', 'amplitude',
    'frequência', 'ressonância', 'cristal', 'nêutron', 'evento',
    'distância', 'silêncio', 'fronteira', 'intervalo', 'tensão',
    'convergência', 'ruptura', 'espiral', 'deriva', 'pulso',
    'névoa', 'sombra', 'clarão', 'noite', 'limiar',
    'umbral', 'precipício', 'abismo', 'margem', 'fissura',
  ],
  materia: [
    'veludo', 'mercúrio', 'tungstênio', 'obsidiana', 'âmbar', 'titânio',
    'magnésio', 'índigo', 'cinábrio', 'carvão', 'cobalto', 'níquel',
    'safira', 'ardósia', 'granito', 'quartzo', 'silex', 'basalto',
    'ferro', 'cobre', 'prata', 'bronze', 'ônix', 'lazúli',
    'lacre', 'resina', 'cera', 'marfim', 'ébano', 'cedro',
    'seda', 'linho', 'feltro', 'porcelana', 'esmalte', 'vidro',
    'sal', 'enxofre', 'cal', 'argila', 'pedra', 'musgo',
    'turfa', 'xisto', 'mica', 'talco', 'gesso', 'breu',
    'grafite', 'chumbo',
  ],
  conceito: [
    'labirinto', 'espelho', 'cifra', 'axioma', 'dilema', 'enigma',
    'paradoxo', 'vestígio', 'rastro', 'equívoco', 'presságio', 'indício',
    'limiar', 'threshold', 'nexo', 'lacuna', 'ruptura', 'dobra',
    'trama', 'viés', 'contorno', 'reverso', 'avesso', 'réplica',
    'decalque', 'sobreposição', 'latência', 'intervalo', 'silêncio', 'eco',
    'palimpsesto', 'fragmento', 'hiato', 'vertigem', 'ilusão', 'reflexo',
    'sombra', 'duplo', 'origem', 'ausência', 'traço', 'memória',
    'cenário', 'código', 'chave', 'mapa', 'signo', 'marca',
    'escrita', 'voz',
  ],
};

const CONQUISTAS_DEF = [
  { id: 'primeiro_quiz',   nome: 'Primeira Sessão',    simbolo: '◈', descricao: 'Completou o primeiro quiz' },
  { id: 'cinco_filmes',    nome: 'Cinéfilo Iniciante', simbolo: '▲', descricao: 'Curtiu 5 filmes' },
  { id: 'semana_cineasta', nome: 'Semana do Cineasta', simbolo: '⬡', descricao: 'Completou 7 sessões de quiz' },
  { id: 'oraculo_badge',   nome: 'Visão do Oráculo',   simbolo: '⬡', descricao: 'Completou 10 sessões de quiz' },
  { id: 'coleccionador',   nome: 'Colecionador',       simbolo: '◉', descricao: 'Curtiu 25 filmes' },
  { id: 'critico_feroz',   nome: 'Crítico Feroz',      simbolo: '◆', descricao: 'Não curtiu 10 filmes' },
];

function seededHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function seededRandom(seed, min, max) {
  const r = ((seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  return Math.floor(r * (max - min + 1)) + min;
}

function generateSemente(email, timestamp) {
  const base = `${email}|${timestamp}`;
  const hash = seededHash(base);

  const h1 = seededRandom(hash, 0, SEMENTE_POOL.cosmos.length - 1);
  const h2 = seededRandom(hash ^ 0xDEADBEEF, 0, SEMENTE_POOL.materia.length - 1);
  const h3 = seededRandom(seededRandom(hash, 1000, 9999), 0, SEMENTE_POOL.conceito.length - 1);

  return {
    palavras: [
      SEMENTE_POOL.cosmos[h1],
      SEMENTE_POOL.materia[h2],
      SEMENTE_POOL.conceito[h3],
    ],
    gerada_em: new Date(timestamp).toISOString(),
    revelada: false,
  };
}

function generateArquetipo(seed) {
  const idx = seededRandom(seededRandom(seed, 0, 999), 0, ARCHETYPES.length - 1);
  return { ...ARCHETYPES[idx], revelado: false };
}

function defaultTracos(seed) {
  const keys = ['emotividade', 'aventura', 'nostalgia', 'intensidade', 'curiosidade', 'solidao'];
  const tracos = {};
  let s = seed;
  for (const key of keys) {
    s = seededRandom(s, 1000, 9999);
    tracos[key] = seededRandom(s, 35, 65);
  }
  return tracos;
}

function defaultConquistas() {
  return CONQUISTAS_DEF.map(c => ({
    id: c.id,
    desbloqueada: false,
    desbloqueada_em: null,
  }));
}

function buildDefaultPerfil(email, timestamp) {
  const seed = seededHash(`${email}|${timestamp}`);
  const semente = generateSemente(email, timestamp);
  const arquetipo = generateArquetipo(seed);
  const tracos = defaultTracos(seed);
  const conquistas = defaultConquistas();

  return { arquetipo, semente, tracos, conquistas };
}

function updateTracosFromSession(perfilData, sessionState) {
  if (!perfilData.tracos || !sessionState) return perfilData;

  const { mood, genres = [], era, company, openness } = sessionState;
  const t = { ...perfilData.tracos };

  const clamp = v => Math.min(100, Math.max(0, v));

  if (mood === 'tenso' || mood === 'assustado') t.intensidade = clamp(t.intensidade + 4);
  if (mood === 'nostálgico') t.nostalgia = clamp(t.nostalgia + 5);
  if (mood === 'reflexivo' || mood === 'contemplativo') t.emotividade = clamp(t.emotividade + 3);
  if (mood === 'empolgado' || mood === 'feliz') t.aventura = clamp(t.aventura + 3);

  if (openness === 'cult' || openness === 'any') t.curiosidade = clamp(t.curiosidade + 4);
  if (openness === 'popular') t.curiosidade = clamp(t.curiosidade - 2);

  if (era === 'classic' || era === '80s90s') t.nostalgia = clamp(t.nostalgia + 3);
  if (era === 'recent') t.nostalgia = clamp(t.nostalgia - 2);

  if (company === 'solo') t.solidao = clamp(t.solidao + 4);
  if (company === 'family' || company === 'friends') t.solidao = clamp(t.solidao - 3);

  return { ...perfilData, tracos: t };
}

function checkAndUnlockConquistas(perfilData, memoryData) {
  if (!perfilData.conquistas) return perfilData;

  const liked = (memoryData.likedMovies || []).length;
  const disliked = (memoryData.dislikedMovies || []).length;
  const sessions = memoryData.sessions || 0;
  const now = new Date().toISOString();

  const conquistas = perfilData.conquistas.map(c => {
    if (c.desbloqueada) return c;
    let unlock = false;
    if (c.id === 'primeiro_quiz' && sessions >= 1) unlock = true;
    if (c.id === 'cinco_filmes' && liked >= 5) unlock = true;
    if (c.id === 'semana_cineasta' && sessions >= 7) unlock = true;
    if (c.id === 'oraculo_badge' && sessions >= 10) unlock = true;
    if (c.id === 'coleccionador' && liked >= 25) unlock = true;
    if (c.id === 'critico_feroz' && disliked >= 10) unlock = true;
    return unlock ? { ...c, desbloqueada: true, desbloqueada_em: now } : c;
  });

  return { ...perfilData, conquistas };
}

module.exports = {
  ARCHETYPES,
  CONQUISTAS_DEF,
  buildDefaultPerfil,
  generateSemente,
  generateArquetipo,
  defaultTracos,
  defaultConquistas,
  updateTracosFromSession,
  checkAndUnlockConquistas,
};
