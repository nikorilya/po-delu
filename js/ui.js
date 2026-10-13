// Общие UI-помощники: создание элементов, иконки, аватары, нижняя панель
// с разбором ответа, таймер, конфетти.

import { haptic, backButton } from './telegram.js';

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Элементы ---------- */

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [p, val] of Object.entries(v)) {
        if (p.startsWith('--')) el.style.setProperty(p, val);
        else el.style[p] = val;
      }
    } else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const fmt = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));

export function plural(n, [one, few, many]) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------- Иконки ---------- */

const ICONS = {
  check: '<path d="M5 12.5l4.2 4.2L19 7" />',
  cross: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />',
  back: '<path d="M15 5l-7 7 7 7" />',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.5" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />',
  gear: '<circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6" />',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6" />',
  share: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" /><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />',
  restart: '<path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4.5h4.5" />',
  minus: '<path d="M6 12h12" />',
  clock: '<circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" />',
  link: '<path d="M14 5h5v5M19 5l-8 8" /><path d="M17 14v4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 18V8.5A1.5 1.5 0 0 1 6.5 7H10" />',
  chat: '<path d="M20 12a7.5 7.5 0 0 1-11 6.6L4.5 20l1.4-4.3A7.5 7.5 0 1 1 20 12z" />',
  help: '<circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7" /><path d="M12 16.9h.01" />',
  book: '<path d="M4.5 5.5A1.5 1.5 0 0 1 6 4h4.5A1.5 1.5 0 0 1 12 5.5V20a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 1 4.5 17z" /><path d="M19.5 5.5A1.5 1.5 0 0 0 18 4h-4.5A1.5 1.5 0 0 0 12 5.5V20a1.5 1.5 0 0 1 1.5-1.5H18a1.5 1.5 0 0 0 1.5-1.5z" />',
};

export function icon(name, size = 20, cls = '') {
  const span = h('span', { class: `icon ${cls}`, 'aria-hidden': 'true' });
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span;
}

export function star(filled, size = 18) {
  const span = h('span', { class: `star ${filled ? 'is-on' : ''}`, 'aria-hidden': 'true' });
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24"><path d="M12 3.2l2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 16.6l-5.3 2.9 1.1-5.9-4.4-4.1 6-.8z" stroke-linejoin="round"/></svg>`;
  return span;
}

export function stars(n, size = 18) {
  return h('span', { class: 'stars', role: 'img', 'aria-label': `${n} из 3 звёзд` },
    [0, 1, 2].map((i) => star(i < n, size)));
}

/* ---------- Персонажи ---------- */

export function avatar(character, size = 36) {
  return h('span', {
    class: 'avatar',
    'aria-hidden': 'true',
    style: { '--av': character.color, width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.44)}px` },
  }, character.name.charAt(0));
}

/* ---------- Верхняя строка экрана ---------- */

export function topbar({ title, progress, onBack, right, help }) {
  const nativeBack = onBack ? backButton.show(onBack) : false;
  return h('header', { class: 'topbar' },
    onBack && !nativeBack
      ? h('button', { class: 'icon-btn topbar-back', 'aria-label': 'Назад', onclick: onBack }, icon('back', 22))
      : h('span', { class: 'topbar-spacer' }),
    h('div', { class: 'topbar-title' }, title || ''),
    h('div', { class: 'topbar-right' },
      progress != null ? h('div', { class: 'topbar-progress', 'aria-live': 'polite' }, progress) : null,
      help ? h('button', { class: 'icon-btn topbar-help', 'aria-label': help.label, title: help.label, onclick: help.onClick }, icon('help', 22)) : null,
      right || null,
    ),
  );
}

/* ---------- Нижняя панель с разбором ответа ---------- */

/**
 * Показывает разбор: вердикт, почему, как это услышит сотрудник.
 * Не закрывается сама — только по кнопке.
 */
export function feedbackSheet({ ui, ok, note, chip, why, character, hears, extra, button, onNext }) {
  if (ok) haptic.success(); else haptic.error();

  const backdrop = h('div', { class: 'sheet-backdrop' });
  const nextBtn = h('button', { class: 'btn btn-primary btn-block' }, button || ui.next);

  const sheet = h('section', {
    class: `sheet ${ok ? 'is-ok' : 'is-bad'}`,
    role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-verdict',
  },
    h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
    h('div', { class: 'verdict' },
      h('span', { class: 'verdict-icon' }, icon(ok ? 'check' : 'cross', 20)),
      h('span', { class: 'verdict-word', id: 'sheet-verdict' }, ok ? ui.verdictOk : ui.verdictBad),
      note ? h('span', { class: 'verdict-note' }, note) : null,
      chip ? h('span', { class: 'chip' }, chip) : null,
    ),
    why ? h('p', { class: 'sheet-why' }, why) : null,
    extra || null,
    character && hears ? hearsBlock(ui, character, hears) : null,
    nextBtn,
  );

  document.body.append(backdrop, sheet);
  requestAnimationFrame(() => {
    backdrop.classList.add('is-open');
    sheet.classList.add('is-open');
  });
  setTimeout(() => nextBtn.focus({ preventScroll: true }), 60);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    sheet.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    setTimeout(() => { sheet.remove(); backdrop.remove(); }, reducedMotion() ? 0 : 220);
  };
  nextBtn.addEventListener('click', () => { close(); onNext && onNext(); });
  return close;
}

export function hearsBlock(ui, character, text) {
  return h('figure', { class: 'hears' },
    avatar(character, 32),
    h('div', { class: 'hears-bubble' },
      h('figcaption', { class: 'hears-label' }, fmt(ui.hearsPrefix, { name: character.hearsName || character.name })),
      h('blockquote', { class: 'hears-text' }, capitalize(text)),
    ),
  );
}

/* ---------- Простая нижняя панель (настройки и т. п.) ---------- */

export function sheet(content, { onClose } = {}) {
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const panel = h('section', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }), content);
  const close = () => {
    panel.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    setTimeout(() => { panel.remove(); backdrop.remove(); onClose && onClose(); }, reducedMotion() ? 0 : 220);
  };
  backdrop.addEventListener('click', close);
  document.body.append(backdrop, panel);
  requestAnimationFrame(() => { backdrop.classList.add('is-open'); panel.classList.add('is-open'); });
  return close;
}

/** Подтверждение на странице (вне Telegram). Возвращает Promise<boolean>. */
export function confirmSheet(message, okText, cancelText) {
  return new Promise((resolve) => {
    let answer = false;
    const okBtn = h('button', { class: 'btn btn-danger btn-block', onclick: () => { answer = true; close(); } }, okText);
    const cancelBtn = h('button', { class: 'btn btn-secondary btn-block', onclick: () => close() }, cancelText);
    const close = sheet(h('div', { class: 'confirm' },
      h('p', { class: 'confirm-text' }, message), okBtn, cancelBtn,
    ), { onClose: () => resolve(answer) });
    setTimeout(() => cancelBtn.focus({ preventScroll: true }), 60);
  });
}

export function toast(text) {
  const t = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('is-open'));
  setTimeout(() => { t.classList.remove('is-open'); setTimeout(() => t.remove(), 250); }, 2200);
}

/* ---------- Таймер с паузой ---------- */

const live = new Set();
let holds = 0; // сколько слоёв (например, урок поверх уровня) держат таймеры на паузе

document.addEventListener('visibilitychange', () => {
  for (const c of live) {
    if (document.visibilityState === 'hidden') c.pause();
    else if (holds === 0) c.resume();
  }
});

/** Ставит все таймеры на паузу, пока открыт слой поверх уровня. */
export function holdTimers() {
  holds += 1;
  for (const c of live) c.pause();
}

export function releaseTimers() {
  holds = Math.max(0, holds - 1);
  if (holds === 0 && document.visibilityState !== 'hidden') {
    for (const c of live) c.resume();
  }
}

export class Countdown {
  constructor({ seconds, fill, onExpire }) {
    this.total = seconds * 1000;
    this.fill = fill;
    this.onExpire = onExpire;
    this.raf = null;
    this.running = false;
  }
  start() {
    this.left = this.total;
    this.render(1);
    live.add(this);
    if (holds === 0) this.resume();
  }
  resume() {
    if (this.running || this.left == null || this.left <= 0) return;
    this.running = true;
    this.t0 = performance.now();
    const tick = (now) => {
      const remaining = this.left - (now - this.t0);
      this.render(Math.max(0, remaining / this.total));
      if (remaining <= 0) {
        this.stop();
        this.onExpire();
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  pause() {
    if (!this.running) return;
    this.left -= performance.now() - this.t0;
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
  stop() {
    this.running = false;
    this.left = null;
    cancelAnimationFrame(this.raf);
    live.delete(this);
  }
  render(fraction) {
    if (this.fill) {
      this.fill.style.transform = `scaleX(${fraction})`;
      this.fill.classList.toggle('is-low', fraction < 0.3);
    }
  }
}

/* ---------- Детерминированное перемешивание ---------- */

export function seededShuffle(list, seedText) {
  let seed = 0;
  for (const ch of seedText) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ---------- Конфетти (только при завершении уровня) ---------- */

export function confetti() {
  if (reducedMotion()) return;
  const colors = ['#FF6B4A', '#FFB199', '#BCD7F2', '#C4E3C1', '#F2D6A9', '#E8C6E1'];
  const layer = h('div', { class: 'confetti', 'aria-hidden': 'true' });
  for (let i = 0; i < 42; i++) {
    layer.append(h('i', {
      style: {
        left: `${Math.random() * 100}%`,
        background: colors[i % colors.length],
        '--dx': `${(Math.random() - 0.5) * 120}px`,
        '--rot': `${(Math.random() - 0.5) * 720}deg`,
        animationDelay: `${Math.random() * 180}ms`,
        animationDuration: `${1100 + Math.random() * 700}ms`,
      },
    }));
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 2200);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, reducedMotion() ? Math.min(ms, 250) : ms));
