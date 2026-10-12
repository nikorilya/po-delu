// Единая точка аналитики. Сейчас события пишутся в консоль.
// Чтобы подключить сервис, добавь приёмник через addSink() — см. README, раздел «Аналитика».
//
// События: app_open, level_start, answer, level_complete, dialog_end,
//          profile_shown, share_click, restart.

const sessionId = Math.random().toString(36).slice(2, 10);
const sinks = [
  (event, params) => console.info('[track]', event, params),
];

export function addSink(fn) {
  sinks.push(fn);
}

export function track(event, params = {}) {
  const payload = { ...params, session: sessionId, ts: Date.now() };
  for (const sink of sinks) {
    try { sink(event, payload); } catch (e) { console.warn('[track] sink failed', e); }
  }
}

// Для отладки из консоли браузера.
window.__track = track;
