const { KVStore } = require('./mongo');

const memoryCache = new Map();
const stats = {
  hits: 0,
  misses: 0,
  sets: 0,
  invalidations: 0
};

async function getCache(key) {
  const local = memoryCache.get(key);
  if (local && local.expiresAt > Date.now()) {
    stats.hits += 1;
    return { value: local.value, layer: 'Memory-KV' };
  }
  if (local) {
    memoryCache.delete(key);
  }

  try {
    const doc = await KVStore.findOne({ key, expires_at: { $gt: new Date() } }).lean();
    if (doc) {
      memoryCache.set(key, { value: doc.value, expiresAt: new Date(doc.expires_at).getTime() });
      stats.hits += 1;
      return { value: doc.value, layer: 'MongoDB-KV' };
    }
  } catch (err) {
    // Non-fatal cache fallback
  }

  stats.misses += 1;
  return null;
}

async function setCache(key, value, ttlSeconds = 60) {
  const expiresAtMs = Date.now() + ttlSeconds * 1000;
  memoryCache.set(key, { value, expiresAt: expiresAtMs });
  stats.sets += 1;

  try {
    await KVStore.findOneAndUpdate(
      { key },
      { key, value, expires_at: new Date(expiresAtMs) },
      { upsert: true, new: true }
    );
  } catch (err) {
    // Non-fatal cache fallback
  }
}

async function invalidatePrefix(prefix) {
  let removed = 0;
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key);
      removed += 1;
    }
  }
  stats.invalidations += removed > 0 ? removed : 1;

  try {
    await KVStore.deleteMany({ key: { $regex: `^${prefix}` } });
  } catch (err) {
    // Non-fatal cache fallback
  }
}

async function clearAllCache() {
  memoryCache.clear();
  stats.invalidations += 1;
  try {
    await KVStore.deleteMany({});
  } catch (err) {
    // Non-fatal cache fallback
  }
}

async function getCacheStats() {
  const activeKeys = [];
  const now = Date.now();
  for (const [key, entry] of memoryCache.entries()) {
    if (entry.expiresAt > now) {
      activeKeys.push({
        key,
        ttl_remaining_sec: Math.max(0, Math.round((entry.expiresAt - now) / 1000))
      });
    }
  }
  let mongoCount = 0;
  try {
    mongoCount = await KVStore.countDocuments({ expires_at: { $gt: new Date() } });
  } catch (err) {
    mongoCount = 0;
  }

  return {
    ...stats,
    memory_keys_count: activeKeys.length,
    mongo_kv_count: mongoCount,
    active_keys: activeKeys
  };
}

module.exports = { getCache, setCache, invalidatePrefix, clearAllCache, getCacheStats };
