'use strict';

/**
 * Cache em memória com TTL e limite de entradas (evicção FIFO).
 * Suficiente para um processo único; trocar por Redis se escalar horizontalmente.
 */
function createTTLCache({ ttlMs, max = 100 }) {
  const store = new Map();

  return {
    get(key) {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (Date.now() > hit.expires) {
        store.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key, value) {
      if (store.size >= max) store.delete(store.keys().next().value);
      store.set(key, { value, expires: Date.now() + ttlMs });
    },
    get size() { return store.size; },
  };
}

module.exports = { createTTLCache };
