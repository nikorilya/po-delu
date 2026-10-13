// Сохранение прогресса: Telegram CloudStorage + localStorage как запасной вариант и кэш.
// Хранится одно компактное JSON-состояние; при загрузке берётся более свежая копия.

import { cloud } from './telegram.js';

const KEY = 'podelu_state_v1';
const CLOUD_LIMIT = 4096; // ограничение CloudStorage на значение

export function emptyState() {
  return {
    v: 1,
    welcomed: false,
    path: null,       // 'learn' — с уроками перед уровнями, 'practice' — сразу к практике
    lessonsSeen: {},  // id уровня -> true, урок пройден или пропущен
    lesson: null,     // открытый урок: { level, card, source, away }
    settings: { timerSwipe: true, timerDialog: true },
    levels: {},   // id -> { done, stars, bestScore, lastScore, maxScore, errors, answered, wrong, extra }
    run: null,    // незаконченный уровень, см. app.js → newRun()
    plans: [],    // «Подготовь разговор»: только список { id, name, mode, done, updatedAt }; тексты — в отдельных ключах
    review: { seen: {}, rounds: [], mastered: {}, run: null, last: 0 }, // «Работа над ошибками», см. review.js
    updatedAt: 0,
  };
}

function parse(raw) {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    return s && s.v === 1 ? s : null;
  } catch { return null; }
}

function readLocal() {
  try { return parse(localStorage.getItem(KEY)); } catch { return null; }
}

export async function loadState() {
  const [remote, local] = [parse(await cloud.get(KEY)), readLocal()];
  const pick = [remote, local].filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const base = emptyState();
  if (!pick) return base;
  return { ...base, ...pick, settings: { ...base.settings, ...(pick.settings || {}) } };
}

let timer = null;
let pending = null;

export function saveState(state) {
  state.updatedAt = Date.now();
  const raw = JSON.stringify(state);
  try { localStorage.setItem(KEY, raw); } catch { /* приватный режим: работаем без кэша */ }
  pending = raw;
  clearTimeout(timer);
  timer = setTimeout(flush, 400);
}

export function flush() {
  clearTimeout(timer);
  if (!pending) return;
  const raw = pending;
  pending = null;
  if (raw.length > CLOUD_LIMIT) {
    console.warn('[storage] состояние больше лимита CloudStorage, сохранено только локально');
    return;
  }
  cloud.set(KEY, raw);
}

/* ---------- Планы разговоров ----------
   Каждый план — отдельный ключ: так пять планов не упираются в лимит 4096 символов
   на одно значение CloudStorage. Тексты не уходят никуда, кроме хранилища самого пользователя. */

const planKey = (id) => `podelu_plan_${id}`;
const planTimers = new Map();
const planPending = new Map();

function parsePlan(raw) {
  if (!raw) return null;
  try { const p = JSON.parse(raw); return p && p.id ? p : null; } catch { return null; }
}

export async function loadPlan(id) {
  let local = null;
  try { local = parsePlan(localStorage.getItem(planKey(id))); } catch { /* нет доступа */ }
  const remote = parsePlan(await cloud.get(planKey(id)));
  return [remote, local].filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
}

export function savePlan(plan) {
  plan.updatedAt = Date.now();
  const raw = JSON.stringify(plan);
  try { localStorage.setItem(planKey(plan.id), raw); } catch { /* приватный режим */ }
  planPending.set(plan.id, raw);
  clearTimeout(planTimers.get(plan.id));
  planTimers.set(plan.id, setTimeout(() => flushPlan(plan.id), 600));
}

function flushPlan(id) {
  clearTimeout(planTimers.get(id));
  const raw = planPending.get(id);
  planPending.delete(id);
  if (!raw) return;
  if (raw.length > CLOUD_LIMIT) {
    console.warn('[storage] план больше лимита CloudStorage, сохранён только локально');
    return;
  }
  cloud.set(planKey(id), raw);
}

export function deletePlan(id) {
  clearTimeout(planTimers.get(id));
  planPending.delete(id);
  try { localStorage.removeItem(planKey(id)); } catch { /* нет доступа */ }
  cloud.remove(planKey(id));
}

function flushAll() {
  flush();
  for (const id of [...planPending.keys()]) flushPlan(id);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushAll();
});
window.addEventListener('pagehide', flushAll);
