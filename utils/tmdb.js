'use strict';

/* ============================================================
   TMDb server-side — descoberta de filmes para o curador IA
   Espelha os mapas que antes viviam no script.js (cliente).
   ============================================================ */

const { createTTLCache } = require('./cache');

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w300';

// Discover é determinístico por parâmetros — 6h de cache evita re-fetch idêntico
const discoverCache = createTTLCache({ ttlMs: 6 * 60 * 60 * 1000, max: 200 });

const GENRE_MAP = {
  'ação': 28, 'acao': 28,
  'aventura': 12,
  'animação': 16, 'animacao': 16,
  'comédia': 35, 'comedia': 35,
  'crime': 80,
  'documentário': 99, 'documentario': 99,
  'drama': 18,
  'família': 10751, 'familia': 10751,
  'fantasia': 14,
  'ficção científica': 878, 'ficcao cientifica': 878, 'sci-fi': 878,
  'história': 36, 'historia': 36,
  'terror': 27,
  'música': 10402, 'musica': 10402, 'musical': 10402,
  'mistério': 9648, 'misterio': 9648,
  'romance': 10749,
  'thriller': 53, 'suspense': 53,
  'guerra': 10752,
  'western': 37, 'faroeste': 37,
};

const MOOD_PARAMS = {
  'feliz':       { sort_by: 'popularity.desc', with_genres_extra: [35] },
  'nostálgico':  { sort_by: 'vote_average.desc', 'primary_release_date.lte': '2005-12-31' },
  'nostalgico':  { sort_by: 'vote_average.desc', 'primary_release_date.lte': '2005-12-31' },
  'tenso':       { sort_by: 'popularity.desc', with_genres_extra: [53, 80] },
  'romântico':   { sort_by: 'popularity.desc', with_genres_extra: [10749] },
  'romantico':   { sort_by: 'popularity.desc', with_genres_extra: [10749] },
  'reflexivo':   { sort_by: 'vote_average.desc' },
  'maravilhado': { sort_by: 'popularity.desc', with_genres_extra: [878, 14] },
  'empolgado':   { sort_by: 'popularity.desc', with_genres_extra: [28] },
  'assustado':   { sort_by: 'popularity.desc', with_genres_extra: [27] },
};

const ERA_MAP = {
  'clássico': { 'primary_release_date.lte': '1979-12-31' },
  'classico': { 'primary_release_date.lte': '1979-12-31' },
  '80s-90s':  { 'primary_release_date.gte': '1980-01-01', 'primary_release_date.lte': '1999-12-31' },
  '2000s':    { 'primary_release_date.gte': '2000-01-01', 'primary_release_date.lte': '2009-12-31' },
  'recente':  { 'primary_release_date.gte': '2010-01-01' },
};

const COMPANY_PARAMS = {
  'sozinho':  { with_genres_extra: [] },
  'casal':    { with_genres_extra: [10749, 35] },
  'família':  { with_genres_extra: [10751, 16], certification_country: 'BR', 'certification.lte': '12' },
  'familia':  { with_genres_extra: [10751, 16], certification_country: 'BR', 'certification.lte': '12' },
  'amigos':   { with_genres_extra: [28, 35, 878] },
};

function norm(s) {
  return (s || '').toString().trim().toLowerCase();
}

/**
 * Busca filmes reais no TMDb com base nas pistas que a IA reuniu.
 * @param {{ generos?: string[], humor?: string, era?: string, companhia?: string, abertura?: string }} args
 * @returns {Promise<Array<{id,title,year,rating,overview,poster}>>}
 */
async function discoverMovies(args = {}) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    console.warn('TMDB_API_KEY ausente — recomendações indisponíveis.');
    return [];
  }

  const params = new URLSearchParams({
    api_key: apiKey,
    language: 'pt-BR',
    include_adult: 'false',
    sort_by: 'popularity.desc',
    'vote_count.gte': '120',
    // Página aleatória varia as recomendações entre sessões com os mesmos filtros
    page: String(1 + Math.floor(Math.random() * 3)),
  });

  // Gêneros explícitos
  const genreIds = (args.generos || [])
    .map(g => GENRE_MAP[norm(g)])
    .filter(Boolean);

  // Humor
  const mood = MOOD_PARAMS[norm(args.humor)] || {};
  if (mood.sort_by) params.set('sort_by', mood.sort_by);
  if (mood['primary_release_date.lte']) params.set('primary_release_date.lte', mood['primary_release_date.lte']);

  // Companhia
  const company = COMPANY_PARAMS[norm(args.companhia)] || {};
  if (company.certification_country) {
    params.set('certification_country', company.certification_country);
    params.set('certification.lte', company['certification.lte']);
  }

  const extraGenres = [
    ...(mood.with_genres_extra || []),
    ...(company.with_genres_extra || []),
  ];
  const allGenres = [...new Set([...genreIds, ...extraGenres])];
  if (allGenres.length) params.set('with_genres', allGenres.slice(0, 3).join('|'));

  // Era (sobrescreve datas do humor quando informada)
  const era = ERA_MAP[norm(args.era)] || {};
  Object.entries(era).forEach(([k, v]) => params.set(k, v));

  // Abertura: cult/explorador prioriza nota
  const abertura = norm(args.abertura);
  if (abertura === 'cult' || abertura === 'exploradores' || abertura === 'explorador') {
    params.set('sort_by', 'vote_average.desc');
    params.set('vote_count.gte', '250');
  }

  // Chave de cache: todos os parâmetros exceto a api_key
  const cacheKey = [...params.entries()]
    .filter(([k]) => k !== 'api_key')
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const cached = discoverCache.get(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(`${TMDB_BASE}/discover/movie?${params}`);
    const data = await res.json();
    if (!res.ok) {
      console.error('TMDb discover error:', data.status_message || res.status);
      return [];
    }
    const movies = (data.results || []).slice(0, 6).map(f => ({
      id: f.id,
      title: f.title,
      year: f.release_date ? f.release_date.slice(0, 4) : '—',
      rating: f.vote_average ? Number(f.vote_average.toFixed(1)) : null,
      overview: f.overview || '',
      poster: f.poster_path ? `${TMDB_IMG}${f.poster_path}` : null,
      genreIds: f.genre_ids || [],
    }));
    discoverCache.set(cacheKey, movies);
    return movies;
  } catch (err) {
    console.error('TMDb discover request failed:', err.message);
    return [];
  }
}

module.exports = { discoverMovies, GENRE_MAP, MOOD_PARAMS, ERA_MAP, COMPANY_PARAMS };
