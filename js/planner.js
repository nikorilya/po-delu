// «Подготовь реальный разговор»: человек собирает обратную связь по SBI+
// для настоящего сотрудника. Проверки — по словарям из content.json → planner.markers,
// мягкие: ничего не блокируют, только подсказывают. Текст хранится только у пользователя.

import { h, fmt, icon, topbar, toast, confirmSheet, copyText } from './ui.js';
import { haptic, confirmDialog, canNativeConfirm, shareMessage } from './telegram.js';
import { loadPlan, savePlan, deletePlan } from './storage.js';

const FIELDS = ['situation', 'behavior', 'impact', 'next'];
const MARKER_TYPES = ['generalization', 'label', 'hearsay', 'vague', 'command', 'passive_aggressive', 'empty_praise', 'sandwichTail'];
// Эти типы подсвечиваются в итоговом тексте.
const HIGHLIGHT = new Set(['generalization', 'label', 'hearsay', 'vague', 'command', 'passive_aggressive', 'sandwichTail']);

/* ================= Проверки ================= */

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const regexCache = new Map();

/** Слово без пробелов — основа (ловит любые окончания); фраза — как есть. */
function matcher(list) {
  const key = list.join('|');
  if (!regexCache.has(key)) {
    const parts = list.map((e) => (/[\s\-,]/.test(e) ? esc(e) : `${esc(e)}[\\p{L}-]*`));
    regexCache.set(key, new RegExp(`(?<![\\p{L}])(?:${parts.join('|')})`, 'giu'));
  }
  const re = regexCache.get(key);
  re.lastIndex = 0;
  return re;
}

const words = (t) => t.trim().split(/\s+/).filter(Boolean).length;

function findMarkers(text, type, P) {
  const list = P.markers[type] || [];
  if (!list.length || !text) return [];
  const out = [];
  const re = matcher(list);
  let m;
  while ((m = re.exec(text))) {
    out.push({ type, start: m.index, end: m.index + m[0].length, word: m[0].trim() });
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return out;
}

/**
 * Проверяет текст поля. Возвращает { issues: [{type, word, message}], spans: [...] }.
 * spans — найденные слова для подсветки, без пересечений.
 */
export function analyze(text, checks, P) {
  const t = text || '';
  const issues = [];
  let spans = [];
  if (!t.trim()) return { issues, spans };

  for (const type of checks) {
    if (!MARKER_TYPES.includes(type)) continue;
    const found = findMarkers(t, type, P);
    if (!found.length) continue;
    if (type === 'empty_praise' && words(t) > P.emptyPraiseMaxWords) continue;
    spans.push(...found);
  }
  // Убираем пересечения: «как всегда» (сарказм) важнее, чем «всегда» (обобщение).
  spans.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const clean = [];
  for (const s of spans) {
    const last = clean[clean.length - 1];
    if (last && s.start < last.end) continue;
    clean.push(s);
  }
  spans = clean;

  const seen = new Set();
  for (const s of spans) {
    if (seen.has(s.type)) continue;
    seen.add(s.type);
    issues.push({ type: s.type, word: s.word, message: fmt(P.messages[s.type], { word: s.word }) });
  }

  if (checks.includes('noTime')) {
    const hasTime = /\d/.test(t) || findMarkers(t, 'time', P).length > 0;
    if (!hasTime) issues.push({ type: 'noTime', message: P.messages.noTime });
  }
  if (checks.includes('shortImpact') && words(t) < P.shortImpactMinWords) {
    issues.push({ type: 'shortImpact', message: P.messages.shortImpact });
  }
  if (checks.includes('noQuestion')) {
    const ok = t.includes('?') || findMarkers(t, 'agreement', P).length > 0;
    if (!ok) issues.push({ type: 'noQuestion', message: P.messages.noQuestion });
  }
  return { issues, spans: spans.filter((s) => HIGHLIGHT.has(s.type)) };
}

function analyzePlan(plan, P) {
  const steps = P.steps[plan.mode];
  const byField = {};
  for (const st of steps) byField[st.field] = analyze(plan.fields[st.field], st.checks, P);
  return byField;
}

/* ================= Сборка текста ================= */

const ENDS = /[.!?…:;,]$/;

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Склеивает части в один текст: ситуация переходит в поведение через запятую,
 * остальные части — отдельными предложениями. Длина каждой части не меняется,
 * кроме знака в конце, поэтому позиции подсветки остаются верными.
 */
function joinParts(fields, { open = false } = {}) {
  const parts = FIELDS.map((f) => [f, (fields[f] || '').trim()]).filter(([, s]) => s);
  const out = [];
  parts.forEach(([f, raw], i) => {
    const prev = out[out.length - 1];
    let s = !prev || /[.!?…]$/.test(prev) ? cap(raw) : raw;
    if (!ENDS.test(s)) {
      // open — текст ещё будет продолжен (превью во время заполнения).
      const last = i === parts.length - 1 && !open;
      s += f === 'situation' && !last ? ',' : '.';
    }
    out.push(s);
  });
  return out;
}

/** Тот же текст, но с подсветкой найденных слов (DOM-узлы). */
function highlighted(plan, P, byField) {
  const pieces = joinParts(plan.fields);
  const nodes = [];
  let k = 0;
  for (const f of FIELDS) {
    const raw = (plan.fields[f] || '').trim();
    if (!raw) continue;
    const piece = pieces[k++];
    // Смещение: при склейке могла поменяться первая буква и добавиться знак в конце —
    // длина исходного текста сохраняется, поэтому позиции совпадают.
    const lead = (plan.fields[f] || '').length - (plan.fields[f] || '').trimStart().length;
    const spans = (byField[f] ? byField[f].spans : []).map((s) => ({ ...s, start: s.start - lead, end: s.end - lead }));
    let pos = 0;
    for (const s of spans) {
      if (s.start < pos || s.start < 0) continue;
      nodes.push(piece.slice(pos, s.start));
      nodes.push(h('mark', { class: 'plan-mark', title: P.messages[s.type] ? fmt(P.messages[s.type], { word: s.word }) : '' }, piece.slice(s.start, s.end)));
      pos = s.end;
    }
    nodes.push(piece.slice(pos));
    nodes.push(' ');
  }
  nodes.pop();
  return nodes;
}

const plainText = (plan) => joinParts(plan.fields).join(' ');

// append без пустых значений (null не превращается в текст «null»).
const put = (el, ...kids) => el.append(...kids.flat().filter((k) => k != null && k !== false));

/* ================= Общие помощники ================= */

const askConfirm = (ui, message, okText) =>
  (canNativeConfirm() ? confirmDialog(message) : confirmSheet(message, okText, ui.cancel));

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function upsertMeta(ctx, plan) {
  const list = ctx.state.plans || (ctx.state.plans = []);
  const meta = { id: plan.id, name: plan.name, mode: plan.mode, done: Boolean(plan.done), updatedAt: Date.now() };
  const i = list.findIndex((p) => p.id === plan.id);
  if (i >= 0) list[i] = meta; else list.unshift(meta);
  ctx.save();
}

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }).replace(' ', ' ');
  } catch { return ''; }
}

/* ================= Экран: список разговоров ================= */

export function plans(root, { from } = {}, ctx) {
  if (!ctx.plannerOn()) { ctx.go('map'); return null; }
  const P = ctx.content.planner;
  const ui = ctx.content.ui;
  const list = (ctx.state.plans || []).slice().sort((a, b) => b.updatedAt - a.updatedAt);
  const full = list.length >= P.limit;
  const modeTitle = (m) => (P.who.modes.find((x) => x.id === m) || {}).title || '';

  root.className = 'screen screen--plans';
  put(root, 
    topbar({ title: '', onBack: () => ctx.go(from === 'result' ? 'result' : 'map') }),
    h('header', { class: 'plans-head' },
      h('h1', { class: 'plans-title' }, P.listTitle),
      h('p', { class: 'plans-sub' }, P.privacy),
    ),
    list.length ? h('ul', { class: 'plan-list' }, list.map((m) =>
      h('li', { class: 'plan-item' },
        h('button', {
          class: 'plan-open',
          onclick: () => ctx.go('plan', { id: m.id, from: 'plans' }),
        },
          h('span', { class: 'plan-name' }, m.name),
          h('span', { class: 'plan-meta' }, `${modeTitle(m.mode)}, ${formatDate(m.updatedAt)}`),
          h('span', { class: `chip ${m.done ? 'chip--ok' : ''}` }, m.done ? P.ready : P.draft),
        ),
        h('button', {
          class: 'icon-btn plan-delete', 'aria-label': `${P.delete}: ${m.name}`,
          onclick: async () => {
            const ok = await askConfirm(ui, P.deleteConfirm, P.delete);
            if (!ok) return;
            deletePlan(m.id);
            ctx.state.plans = ctx.state.plans.filter((p) => p.id !== m.id);
            ctx.save();
            ctx.track('plan_delete', { mode: m.mode, done: m.done });
            ctx.go(ctx.state.plans.length ? 'plans' : 'map', { from });
          },
        }, icon('trash', 20)),
      ))) : null,
    full ? h('p', { class: 'plans-limit' }, P.limitNote) : null,
    full ? null : h('button', {
      class: 'btn btn-primary btn-block plans-new',
      onclick: () => ctx.go('plan', { from: 'plans' }),
    }, P.newPlan),
  );
  return null;
}

/* ================= Экран: разговор (шаги и итог) ================= */

export function plan(root, { id, from } = {}, ctx) {
  if (!ctx.plannerOn()) { ctx.go('map'); return null; }
  const P = ctx.content.planner;
  const ui = ctx.content.ui;
  let alive = true;
  let p = null;
  let step = 0;
  let isNew = !id;
  let inputTimer = null;

  const exit = () => ctx.go((ctx.state.plans || []).length ? 'plans' : (from === 'result' ? 'result' : 'map'), { from: from === 'plans' ? undefined : from });

  root.className = 'screen screen--plan';
  root.append(h('div', { class: 'boot' }, h('span')));

  (async () => {
    if (isNew) {
      if ((ctx.state.plans || []).length >= P.limit) { ctx.go('plans', { from }); return; }
      p = { id: newId(), name: '', mode: null, fields: { situation: '', behavior: '', impact: '', next: '' }, step: 0, done: false, createdAt: Date.now() };
    } else {
      p = await loadPlan(id);
      if (!alive) return;
      if (!p) {
        // Запись потерялась (например, очистили хранилище) — убираем из списка.
        ctx.state.plans = (ctx.state.plans || []).filter((m) => m.id !== id);
        ctx.save();
        ctx.go('plans', { from });
        return;
      }
      p.fields = { situation: '', behavior: '', impact: '', next: '', ...(p.fields || {}) };
    }
    step = p.done ? 5 : (p.step || 0);
    render();
  })();

  function persist() {
    p.step = step;
    savePlan(p);
  }

  function render() {
    if (!alive) return;
    clearTimeout(inputTimer);
    root.replaceChildren();
    window.scrollTo(0, 0);
    if (step === 5) return renderResult();

    const title = p.name || P.title;
    const segs = h('div', { class: 'lesson-steps', 'aria-hidden': 'true' },
      [0, 1, 2, 3, 4].map((k) => h('span', { class: k < step ? 'is-done' : k === step ? 'is-current' : '' })));
    const stage = h('div', { class: 'lesson-stage plan-stage' });
    const prevBtn = h('button', { class: 'btn btn-secondary lesson-prev', 'aria-label': P.nav.back, onclick: prev }, icon('arrowLeft', 20));
    const nextBtn = h('button', { class: 'btn btn-primary btn-block', onclick: next });
    prevBtn.hidden = step === 0;

    put(root, 
      topbar({ title, onBack: exit }),
      segs,
      stage,
      h('div', { class: 'lesson-nav' }, prevBtn, nextBtn),
    );

    if (step === 0) renderWho(stage, nextBtn);
    else renderField(stage, nextBtn);
  }

  /* ---------- Шаг 0: с кем и зачем ---------- */

  function renderWho(stage, nextBtn) {
    const W = P.who;
    const name = h('input', {
      class: 'plan-input', id: 'plan-name', type: 'text', maxlength: '40', autocomplete: 'off',
      placeholder: W.namePlaceholder, value: p.name || '',
    });
    name.value = p.name || '';
    const modes = h('div', { class: 'mode-cards', role: 'radiogroup', 'aria-label': W.modeLabel },
      W.modes.map((m) => h('button', {
        class: `mode-card ${p.mode === m.id ? 'is-on' : ''}`, role: 'radio', 'aria-checked': String(p.mode === m.id),
        onclick: (e) => {
          p.mode = m.id;
          haptic.light();
          [...modes.children].forEach((b) => { b.classList.remove('is-on'); b.setAttribute('aria-checked', 'false'); });
          e.currentTarget.classList.add('is-on');
          e.currentTarget.setAttribute('aria-checked', 'true');
          update();
        },
      },
        h('span', { class: 'mode-mark', 'aria-hidden': 'true' }, icon('check', 14)),
        h('span', { class: 'mode-title' }, m.title),
        h('span', { class: 'mode-text' }, m.text),
      )));

    stage.append(h('article', { class: 'lesson-card' },
      h('h2', { class: 'lesson-title' }, W.title),
      h('label', { class: 'plan-label', for: 'plan-name' }, W.nameLabel),
      name,
      h('p', { class: 'plan-label' }, W.modeLabel),
      modes,
      h('p', { class: 'plan-privacy' }, icon('lock', 15), P.privacy),
    ));

    function update() {
      p.name = name.value.trim();
      const ok = Boolean(p.name && p.mode);
      nextBtn.disabled = !ok;
      nextBtn.textContent = ok ? P.nav.next : P.nav.required;
    }
    name.addEventListener('input', update);
    update();
    if (!p.name) setTimeout(() => name.focus({ preventScroll: true }), 80);
  }

  /* ---------- Шаги 1–4: части SBI+ ---------- */

  function renderField(stage, nextBtn) {
    const st = P.steps[p.mode][step - 1];
    const field = st.field;
    const before = FIELDS.slice(0, FIELDS.indexOf(field)).filter((f) => (p.fields[f] || '').trim());
    const area = h('textarea', {
      class: 'plan-input plan-area', id: `plan-${field}`, rows: '4', maxlength: '400',
      placeholder: st.placeholder, 'aria-describedby': `plan-hint-${field} plan-issues-${field}`,
    });
    area.value = p.fields[field] || '';
    const issuesEl = h('ul', { class: 'plan-issues', id: `plan-issues-${field}`, 'aria-live': 'polite' });

    stage.append(h('article', { class: 'lesson-card' },
      before.length ? h('div', { class: 'plan-preview' },
        h('p', { class: 'bubble bubble--out plan-preview-text' }, joinParts(Object.fromEntries(before.map((f) => [f, p.fields[f]])), { open: true }).join(' ')),
      ) : null,
      h('div', { class: 'plan-q' },
        h('h2', { class: 'lesson-title' }, h('label', { for: `plan-${field}` }, st.label)),
        h('p', { class: 'plan-hint', id: `plan-hint-${field}` }, st.hint),
      ),
      area,
      issuesEl,
    ));

    const last = step === 4;
    function update(withIssues) {
      p.fields[field] = area.value;
      const ok = area.value.trim().length >= 2;
      nextBtn.disabled = !ok;
      nextBtn.textContent = !ok ? P.nav.required : last ? P.nav.finish : P.nav.next;
      if (withIssues) showIssues();
    }
    function showIssues() {
      const { issues } = analyze(area.value, st.checks, P);
      issuesEl.replaceChildren(...issues.map((i) =>
        h('li', null, icon('alert', 16), h('span', null, i.message))));
    }
    area.addEventListener('input', () => {
      update(false);
      persist();
      clearTimeout(inputTimer);
      inputTimer = setTimeout(showIssues, 350);
    });
    update(true);
    setTimeout(() => {
      area.focus({ preventScroll: true });
      area.setSelectionRange(area.value.length, area.value.length);
    }, 80);
  }

  function next() {
    haptic.light();
    if (step === 0) {
      if (isNew) {
        isNew = false;
        ctx.track('plan_start', { mode: p.mode });
      }
      step = 1;
      persist();
      upsertMeta(ctx, p);
      render();
      return;
    }
    if (step < 4) { step += 1; persist(); render(); return; }
    // Собрать разговор
    const byField = analyzePlan(p, P);
    const flags = [...new Set(Object.values(byField).flatMap((r) => r.issues.map((i) => i.type)))];
    ctx.track('plan_complete', { mode: p.mode, flags, edited: Boolean(p.done) });
    p.done = true;
    step = 5;
    persist();
    upsertMeta(ctx, p);
    render();
  }

  function prev() {
    if (step === 0) return;
    step -= 1;
    persist();
    render();
  }

  /* ---------- Итог ---------- */

  function renderResult() {
    const R = P.result;
    const byField = analyzePlan(p, P);
    const has = (types) => FIELDS.some((f) => byField[f] && byField[f].issues.some((i) => types.includes(i.type)));
    const items = p.mode === 'praise'
      ? [
        ['time', !has(['noTime'])],
        ['concrete', !has(['empty_praise', 'vague'])],
        ['impact', !has(['shortImpact'])],
        ['repeat', !has(['sandwichTail'])],
      ]
      : [
        ['time', !has(['noTime'])],
        ['concrete', !has(['generalization', 'label', 'hearsay', 'vague'])],
        ['impact', !has(['shortImpact'])],
        ['noCommand', !has(['command', 'passive_aggressive'])],
        ['next', !has(['noQuestion'])],
      ];

    const message = h('p', { class: 'bubble bubble--out plan-message' }, highlighted(p, P, byField));

    let extra;
    if (p.mode === 'praise') {
      extra = h('section', { class: 'card' },
        h('h2', { class: 'section-title' }, R.praiseTipTitle),
        h('ul', { class: 'tips' }, R.praiseTips.map((t) => h('li', null, t))));
    } else {
      const detail = h('div', { class: 'reaction-detail', 'aria-live': 'polite' });
      const chips = h('div', { class: 'reaction-chips', role: 'tablist' }, R.reactions.map((r, i) =>
        h('button', {
          class: 'reaction-chip', role: 'tab', 'aria-selected': String(i === 0),
          onclick: (e) => {
            [...chips.children].forEach((b) => b.setAttribute('aria-selected', 'false'));
            e.currentTarget.setAttribute('aria-selected', 'true');
            showReaction(r);
            ctx.track('plan_reaction', { reaction: r.id });
          },
        }, r.label)));
      function showReaction(r) {
        detail.replaceChildren(
          h('div', { class: 'msg msg--in' }, h('p', { class: 'bubble bubble--in' }, `«${r.says}»`)),
          h('div', { class: 'msg msg--out' }, h('p', { class: 'bubble bubble--out' }, r.move)),
          h('p', { class: 'reaction-why' }, r.why),
        );
      }
      showReaction(R.reactions[0]);
      extra = h('section', { class: 'card' },
        h('h2', { class: 'section-title' }, fmt(R.reactionsTitle, { name: p.name })),
        chips,
        detail);
    }

    const text = `${fmt(R.shareHeader, { name: p.name })}\n\n${plainText(p)}`;

    put(root, 
      topbar({ title: '', onBack: exit }),
      h('section', { class: 'plan-result' },
        h('p', { class: 'plan-result-kicker' }, R.kicker),
        h('h1', { class: 'plan-result-title' }, fmt(R.title, { name: p.name })),
        h('p', { class: 'plan-live' }, icon('chat', 18), p.mode === 'praise' ? P.liveNotePraise : P.liveNote),
        message,
      ),
      h('section', { class: 'card' },
        h('h2', { class: 'section-title' }, R.checklistTitle),
        h('ul', { class: 'checklist' }, items.map(([key, ok]) =>
          h('li', { class: ok ? 'is-ok' : 'is-warn' },
            h('span', { class: 'checklist-icon' }, icon(ok ? 'check' : 'alert', 16)),
            h('span', null, ok ? R.checks[key].ok : R.checks[key].warn))))),
      extra,
      h('div', { class: 'result-actions' },
        h('button', {
          class: 'btn btn-primary btn-block',
          onclick: async () => {
            ctx.track('plan_share', { mode: p.mode });
            const how = await shareMessage(text, ctx.content.app.botLink);
            if (how === 'clipboard') toast(R.copied);
          },
        }, icon('share', 20), R.sendSelf),
        h('p', { class: 'plan-send-hint' }, R.sendSelfHint),
        h('button', {
          class: 'btn btn-secondary btn-block',
          onclick: async () => {
            ctx.track('plan_copy', { mode: p.mode });
            const ok = await copyText(text);
            toast(ok ? R.copied : R.copyFailed);
          },
        }, R.copy),
        h('div', { class: 'plan-links' },
          h('button', { class: 'link-btn', onclick: () => { step = 1; persist(); render(); } }, R.edit),
          h('button', { class: 'link-btn', onclick: exit }, R.done),
        ),
      ),
    );
  }

  return () => {
    alive = false;
    clearTimeout(inputTimer);
    if (p && p.mode && !isNew) savePlan(p);
  };
}
