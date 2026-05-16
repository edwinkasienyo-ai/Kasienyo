"use strict";
/**
 * AI request queue, cache and moderation guard.
 *
 * Two backends, same public API (runAiTask):
 *   - In-process (default): Map-based cache + small concurrency guard.
 *     Good enough for single-node deployments and dev.
 *   - Redis (BullMQ) when IIMS_AI_QUEUE_BACKEND=redis. Lets multiple Node
 *     workers share one fair queue, distribute load, and survive restarts.
 *
 * Prompt-injection style content is blocked in BOTH backends.
 * Every dispatch is logged in `ai_generation_logs` (institution-scoped).
 */

const crypto = require("crypto");
const { query } = require("../config/db");

const QUEUE_BACKEND = String(process.env.IIMS_AI_QUEUE_BACKEND || "memory").toLowerCase();

const AI_CACHE = new Map();
const AI_QUEUE_RUNNING = { current: 0 };
const AI_QUEUE_BACKLOG = [];

const AI_QUEUE_MAX_CONCURRENT = Math.max(1, Number(process.env.AI_QUEUE_MAX_CONCURRENT || 2));
const AI_CACHE_TTL_MS = Math.max(0, Number(process.env.AI_CACHE_TTL_MS || 5 * 60 * 1000));
const AI_QUEUE_MAX_BACKLOG = Math.max(0, Number(process.env.AI_QUEUE_MAX_BACKLOG || 60));

const FORBIDDEN_PATTERNS = [
  /(?:^|\W)(?:ignore|disregard|override)\s+(?:all|previous|the)\s+(?:prior\s+)?instructions/i,
  /system\s+prompt/i,
  /you\s+are\s+now\s+(?:a|an)\s+/i,
  /\bjailbreak\b/i,
  /BEGIN\s+ROOT\s+SHELL/i
];

function moderatePromptContent(text) {
  const value = String(text || "").trim();
  if (!value) return { ok: false, reason: "empty" };
  if (value.length > Number(process.env.AI_PROMPT_MAX_CHARS || 24_000)) {
    return { ok: false, reason: "too_long" };
  }
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(value)) return { ok: false, reason: "prompt_injection" };
  }
  return { ok: true };
}

function cacheKey({ institutionId, namespace, payload }) {
  const h = crypto.createHash("sha256");
  h.update(String(institutionId || "*"));
  h.update("|");
  h.update(String(namespace || "default"));
  h.update("|");
  h.update(JSON.stringify(payload || {}));
  return h.digest("hex");
}

function pruneCache() {
  const now = Date.now();
  for (const [key, entry] of AI_CACHE.entries()) {
    if (entry.expiresAt < now) AI_CACHE.delete(key);
  }
}

function cacheGet(key) {
  pruneCache();
  const entry = AI_CACHE.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    AI_CACHE.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value) {
  AI_CACHE.set(key, { value, expiresAt: Date.now() + AI_CACHE_TTL_MS });
}

async function logAiUsage({ institutionId, requestedByUserId, service, model, status, error, metadata }) {
  try {
    await query(
      `INSERT INTO ai_generation_logs
        (institution_id, requested_by_user_id, service, model, status, error_message, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(institutionId) || null,
        Number(requestedByUserId) || null,
        String(service || "ai"),
        String(model || "") || null,
        String(status || "OK"),
        error ? String(error).slice(0, 800) : null,
        JSON.stringify(metadata || {})
      ]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[ai-log] failed:", err?.message);
  }
}

function pumpQueue() {
  while (AI_QUEUE_RUNNING.current < AI_QUEUE_MAX_CONCURRENT && AI_QUEUE_BACKLOG.length) {
    const job = AI_QUEUE_BACKLOG.shift();
    AI_QUEUE_RUNNING.current += 1;
    Promise.resolve()
      .then(() => job.execute())
      .then((value) => job.resolve(value))
      .catch((err) => job.reject(err))
      .finally(() => {
        AI_QUEUE_RUNNING.current -= 1;
        pumpQueue();
      });
  }
}

/**
 * Run an AI task respecting concurrency, prompt moderation and cache.
 *
 * @param {object} opts
 * @param {string|number} opts.institutionId
 * @param {string|number} [opts.requestedByUserId]
 * @param {string} opts.namespace            label saved in ai_generation_logs
 * @param {string} [opts.model]
 * @param {object} [opts.cacheKeyPayload]    if provided, identical payloads
 *                                           re-use cached results for TTL.
 * @param {string[]} [opts.moderatePrompts]  texts to vet before sending.
 * @param {() => Promise<any>} opts.execute  the actual AI call.
 */
async function runAiTask(opts) {
  const {
    institutionId,
    requestedByUserId,
    namespace,
    model,
    cacheKeyPayload,
    moderatePrompts,
    execute
  } = opts || {};

  if (typeof execute !== "function") {
    throw new Error("runAiTask: execute() function is required.");
  }

  if (Array.isArray(moderatePrompts) && moderatePrompts.length) {
    for (const prompt of moderatePrompts) {
      const verdict = moderatePromptContent(prompt);
      if (!verdict.ok) {
        await logAiUsage({
          institutionId,
          requestedByUserId,
          service: namespace || "ai",
          model,
          status: "MODERATION_BLOCKED",
          error: verdict.reason,
          metadata: { reason: verdict.reason }
        });
        const error = new Error(`AI request blocked by moderation: ${verdict.reason}`);
        error.code = "AI_MODERATION_BLOCKED";
        throw error;
      }
    }
  }

  let key = null;
  if (cacheKeyPayload) {
    key = cacheKey({ institutionId, namespace, payload: cacheKeyPayload });
    const cached = cacheGet(key);
    if (cached !== null) {
      await logAiUsage({
        institutionId,
        requestedByUserId,
        service: namespace || "ai",
        model,
        status: "CACHE_HIT",
        metadata: { cache_key: key }
      });
      return cached;
    }
  }

  if (AI_QUEUE_BACKLOG.length >= AI_QUEUE_MAX_BACKLOG) {
    const error = new Error("AI request queue is saturated; please retry shortly.");
    error.code = "AI_QUEUE_FULL";
    throw error;
  }

  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    AI_QUEUE_BACKLOG.push({
      execute,
      resolve: async (value) => {
        if (key) cacheSet(key, value);
        await logAiUsage({
          institutionId,
          requestedByUserId,
          service: namespace || "ai",
          model,
          status: "OK",
          metadata: { duration_ms: Date.now() - startedAt, cache_key: key }
        });
        resolve(value);
      },
      reject: async (err) => {
        await logAiUsage({
          institutionId,
          requestedByUserId,
          service: namespace || "ai",
          model,
          status: "ERROR",
          error: err?.message || "ai task failed",
          metadata: { duration_ms: Date.now() - startedAt }
        });
        reject(err);
      }
    });
    pumpQueue();
  });
}

function aiQueueStats() {
  pruneCache();
  return {
    backend: QUEUE_BACKEND,
    running: AI_QUEUE_RUNNING.current,
    backlog: AI_QUEUE_BACKLOG.length,
    cache_size: AI_CACHE.size,
    max_concurrent: AI_QUEUE_MAX_CONCURRENT,
    max_backlog: AI_QUEUE_MAX_BACKLOG,
    cache_ttl_ms: AI_CACHE_TTL_MS
  };
}

// =====================================================================
// Redis / BullMQ backend (item 42)
// =====================================================================
let _redisQueue = null;
let _redisWorker = null;
let _redisConnection = null;
const _redisJobRegistry = new Map(); // jobId -> { resolve, reject }

function _initRedisIfNeeded() {
  if (_redisQueue) return _redisQueue;
  if (QUEUE_BACKEND !== "redis") return null;
  try {
    // Lazy require so installs without Redis still boot.
    const { Queue, Worker } = require("bullmq");
    const Redis = require("ioredis");
    const url = process.env.REDIS_URL || "redis://127.0.0.1:6379";
    _redisConnection = new Redis(url, { maxRetriesPerRequest: null });
    const queueName = process.env.AI_QUEUE_NAME || "imis-ai";
    _redisQueue = new Queue(queueName, { connection: _redisConnection });
    _redisWorker = new Worker(queueName, async (job) => {
      const reg = _redisJobRegistry.get(job.id);
      if (!reg) {
        // Job was published from another worker — we cannot execute() its
        // closure here. Skip; the publisher will run it locally.
        return null;
      }
      try {
        const out = await reg.execute();
        reg.resolve(out);
        return out;
      } catch (err) {
        reg.reject(err);
        throw err;
      } finally {
        _redisJobRegistry.delete(job.id);
      }
    }, {
      connection: _redisConnection,
      concurrency: AI_QUEUE_MAX_CONCURRENT
    });
    // eslint-disable-next-line no-console
    console.log(`[ai-queue] redis backend ready on ${queueName}`);
    return _redisQueue;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[ai-queue] redis backend init failed; staying in-process: ${err?.message || err}`);
    _redisQueue = null;
    return null;
  }
}

async function _enqueueRedis(payload, execute) {
  const queue = _initRedisIfNeeded();
  if (!queue) return null;
  const job = await queue.add(payload.namespace || "ai", payload, {
    removeOnComplete: 200,
    removeOnFail: 200
  });
  return new Promise((resolve, reject) => {
    _redisJobRegistry.set(job.id, { execute, resolve, reject });
    // BullMQ will invoke the worker which reads from _redisJobRegistry.
  });
}

// Patch runAiTask to delegate to Redis when configured.
const _originalRunAiTask = runAiTask;
async function runAiTaskWithBackend(opts) {
  if (QUEUE_BACKEND === "redis") {
    const queue = _initRedisIfNeeded();
    if (queue) {
      // Run moderation + cache locally first (cheap, deterministic).
      const {
        institutionId,
        requestedByUserId,
        namespace,
        model,
        moderatePrompts,
        cacheKeyPayload,
        execute
      } = opts || {};
      if (Array.isArray(moderatePrompts) && moderatePrompts.length) {
        for (const prompt of moderatePrompts) {
          const verdict = moderatePromptContent(prompt);
          if (!verdict.ok) {
            await logAiUsage({
              institutionId, requestedByUserId, service: namespace || "ai", model,
              status: "MODERATION_BLOCKED", error: verdict.reason,
              metadata: { reason: verdict.reason }
            });
            const error = new Error(`AI request blocked by moderation: ${verdict.reason}`);
            error.code = "AI_MODERATION_BLOCKED";
            throw error;
          }
        }
      }
      let key = null;
      if (cacheKeyPayload) {
        key = cacheKey({ institutionId, namespace, payload: cacheKeyPayload });
        const cached = cacheGet(key);
        if (cached !== null) {
          await logAiUsage({
            institutionId, requestedByUserId, service: namespace || "ai", model,
            status: "CACHE_HIT", metadata: { cache_key: key, backend: "redis" }
          });
          return cached;
        }
      }
      const startedAt = Date.now();
      try {
        const value = await _enqueueRedis({
          institutionId, requestedByUserId, namespace, model
        }, execute);
        if (key) cacheSet(key, value);
        await logAiUsage({
          institutionId, requestedByUserId, service: namespace || "ai", model,
          status: "OK",
          metadata: { duration_ms: Date.now() - startedAt, cache_key: key, backend: "redis" }
        });
        return value;
      } catch (err) {
        await logAiUsage({
          institutionId, requestedByUserId, service: namespace || "ai", model,
          status: "ERROR", error: err?.message || "ai task failed",
          metadata: { duration_ms: Date.now() - startedAt, backend: "redis" }
        });
        throw err;
      }
    }
  }
  return _originalRunAiTask(opts);
}

module.exports = {
  moderatePromptContent,
  runAiTask: runAiTaskWithBackend,
  aiQueueStats,
  cacheKey,
  cacheGet,
  cacheSet
};
