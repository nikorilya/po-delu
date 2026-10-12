// Сохранение прогресса: Telegram CloudStorage + localStorage как запасной вариант и кэш.
// Хранится одно компактное JSON-состояние; при загрузке берётся более свежая копия.

import { cloud } from './telegram.js';

const KEY = 'podelu_state_v1';
const CLOUD_LIMIT = 4096; // ограничение CloudStorage на значение

export function emptyState() {
  return {
    v: 1,
    welcomed: false,
    settings: { timerSwipe: true, timerDialog: true },
    levels: {},   // id -> { done, stars, bestScore, lastScore, maxScore, errors, answered, wrong, extra }
    run: null,    // незаконченный уровень, см. app.js → newRun()
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

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});
window.addEventListener('pagehide', flush);
