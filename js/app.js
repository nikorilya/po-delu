// Точка входа: загрузка контента и прогресса, маршрутизация экранов,
// учёт ответов и завершение уровней.

import { initTelegram, backButton, mainButton, settingsButton } from './telegram.js';
import { loadState, saveState, emptyState } from './storage.js';
import { track } from './analytics.js';
import { h } from './ui.js';
import * as screens from './screens.js';

const root = document.getElementById('app');

const ctx = {
  content: null,
  state: null,
  track,
  save: () => saveState(ctx.state),
  go,
  level: (id) => ctx.content.levels.find((l) => l.id === id),
  character: (key) => ctx.content.characters[key],
  isUnlocked: (id) => id === 1 || Boolean(ctx.state.levels[id - 1] && ctx.state.levels[id - 1].done),
  allDone: () => ctx.content.levels.every((l) => ctx.state.levels[l.id] && ctx.state.levels[l.id].done),
  newRun,
  record,
  finishLevel,
  maxScore,
  resetProgress,
};

let cleanup = null;

function go(name, params = {}) {
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  backButton.hide();
  mainButton.hide();
  document.querySelectorAll('.sheet, .sheet-backdrop, .confetti, .toast').forEach((n) => n.remove());
  root.replaceChildren();
  root.className = '';
  window.scrollTo(0, 0);
  cleanup = screens[name](root, params, ctx);
}

/* ---------- Прогон уровня ---------- */

function newRun(levelId) {
  const L = ctx.level(levelId);
  const run = { level: levelId, idx: 0, score: 0, answered: 0, wrong: 0, errors: {} };
  if (L.type === 'dialog') {
    run.dlg = { d: 0, node: null, trust: L.trustStart, path: [], results: [] };
  }
  return run;
}

/**
 * Учитывает ответ.
 * correct      — верно ли в целом;
 * errorTypes   — типы ошибок для профиля (неизвестные/пустые не учитываются);
 * answered     — сколько «ответов» засчитать (в уровне 3 — 4 слота);
 * wrongCount   — сколько из них ошибочны;
 * points       — баллы;
 * trackError   — что отправить в аналитику как error_type.
 */
function record({ itemId, correct, errorTypes = [], answered = 1, wrongCount, points = 0, timeMs, trackError }) {
  const run = ctx.state.run;
  const types = ctx.content.errorTypes;
  run.answered += answered;
  run.wrong += wrongCount != null ? wrongCount : (correct ? 0 : 1);
  run.score += points;
  for (const t of errorTypes) {
    if (t && types[t]) run.errors[t] = (run.errors[t] || 0) + 1;
  }
  track('answer', {
    level: run.level,
    item_id: itemId,
    correct,
    error_type: trackError !== undefined ? trackError : (errorTypes.filter(Boolean).join(',') || null),
    time_ms: timeMs != null ? Math.round(timeMs) : null,
  });
  ctx.save();
}

function maxScore(L) {
  switch (L.type) {
    case 'swipe':
    case 'fix': return L.items.length * (L.pointsPerItem || 10);
    case 'build': return L.items.length * L.slots.length * (L.pointsPerSlot || 10);
    case 'dialog': return L.dialogs.length * 100;
    default: return 0;
  }
}

function starsFor(pct) {
  if (pct >= 0.9) return 3;
  if (pct >= 0.7) return 2;
  return 1;
}

function finishLevel() {
  const run = ctx.state.run;
  const L = ctx.level(run.level);
  const max = maxScore(L);
  const pct = max ? run.score / max : 0;
  const starsNow = starsFor(pct);
  const prev = ctx.state.levels[L.id] || {};
  ctx.state.levels[L.id] = {
    done: true,
    stars: Math.max(prev.stars || 0, starsNow),
    bestScore: Math.max(prev.bestScore || 0, run.score),
    lastScore: run.score,
    maxScore: max,
    // Профиль строится по последней попытке каждого уровня.
    errors: run.errors,
    answered: run.answered,
    wrong: run.wrong,
    extra: run.dlg ? { dialogs: run.dlg.results } : null,
  };
  ctx.state.run = null;
  ctx.save();
  track('level_complete', { level: L.id, score: run.score, stars: starsNow });
  go('levelDone', { id: L.id, score: run.score, max, stars: starsNow });
}

function resetProgress() {
  const fresh = emptyState();
  fresh.welcomed = true;
  fresh.settings = ctx.state.settings;
  ctx.state = fresh;
  ctx.save();
}

/* ---------- Запуск ---------- */

async function boot() {
  initTelegram();
  try {
    const res = await fetch('content.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ctx.content = await res.json();
  } catch (e) {
    console.error(e);
    root.replaceChildren(h('div', { class: 'boot-error' },
      h('p', null, 'Не удалось загрузить задания. Проверь соединение и попробуй ещё раз.'),
      h('button', { class: 'btn btn-primary', onclick: () => location.reload() }, 'Обновить'),
    ));
    return;
  }
  ctx.state = await loadState();
  document.title = `${ctx.content.app.title} — ${ctx.content.app.subtitle}`;

  settingsButton.show(() => screens.openSettings(ctx));
  track('app_open', { resumed_level: ctx.state.run ? ctx.state.run.level : null });

  if (!ctx.state.welcomed) go('welcome');
  else if (ctx.state.run) go('level', { id: ctx.state.run.level });
  else go('map');
}

boot();
