// Микроурок перед уровнем: 2–3 карточки (идея, контраст «плохо / хорошо»,
// мини-проверка). Один и тот же компонент работает как отдельный экран
// (перед уровнем) и как слой поверх уровня (кнопка «?»).

import { h, icon, avatar, topbar } from './ui.js?v=0.4.3';
import { haptic } from './telegram.js?v=0.4.3';

/**
 * @param root   контейнер
 * @param opts   { L, content, ui, mode: 'auto'|'refresh'|'help', startCard,
 *                 onBack, onCard(i), onDone(), onSkip(), track }
 * @returns cleanup
 */
export function mountLesson(root, opts) {
  const { L, content, ui, mode, track } = opts;
  const lesson = L.lesson;
  const cards = lesson.cards;
  const t0 = performance.now();
  let i = Math.min(opts.startCard || 0, cards.length - 1);
  let checkResult = null; // true/false после ответа в проверке
  const answered = new Set();
  const choices = new Map(); // индекс карточки → выбранный вариант

  track('lesson_start', { level: L.id, source: mode, card: i });

  const right = mode === 'auto'
    ? h('button', { class: 'topbar-link', onclick: skip }, ui.lessonSkip)
    : null;

  const steps = h('div', { class: 'lesson-steps', 'aria-hidden': 'true' },
    cards.map(() => h('span')));
  const stage = h('div', { class: 'lesson-stage' });
  const prevBtn = h('button', { class: 'btn btn-secondary lesson-prev', 'aria-label': ui.lessonPrev, onclick: prev }, icon('arrowLeft', 20));
  const nextBtn = h('button', { class: 'btn btn-primary btn-block', onclick: next });

  root.append(
    topbar({ title: `${ui.lessonLabel}: ${lesson.title}`, onBack: opts.onBack, right }),
    steps,
    stage,
    h('div', { class: 'lesson-nav' }, prevBtn, nextBtn),
  );

  const onKey = (e) => {
    if (document.querySelector('.sheet')) return;
    if (e.key === 'ArrowRight' && !nextBtn.disabled) next();
    if (e.key === 'ArrowLeft' && i > 0) prev();
    if (e.key === 'Escape' && mode === 'help') opts.onBack();
  };
  window.addEventListener('keydown', onKey);

  function render(dir) {
    const card = cards[i];
    [...steps.children].forEach((s, k) => {
      s.className = k < i ? 'is-done' : k === i ? 'is-current' : '';
    });
    const el = renderCard(card);
    el.classList.add('lesson-card');
    if (dir) el.classList.add(dir > 0 ? 'from-right' : 'from-left');
    stage.replaceChildren(el);
    stage.scrollTop = 0;
    if (root.scrollTo) root.scrollTo(0, 0);
    window.scrollTo(0, 0);

    prevBtn.hidden = i === 0;
    updateNext();
    if (opts.onCard) opts.onCard(i);
    setTimeout(() => {
      const heading = el.querySelector('h2');
      if (heading && dir) heading.focus({ preventScroll: true });
    }, 30);
  }

  function updateNext() {
    const card = cards[i];
    const last = i === cards.length - 1;
    const blocked = card.type === 'check' && !answered.has(i);
    nextBtn.disabled = blocked;
    if (blocked) nextBtn.textContent = ui.lessonCheckHint;
    else if (!last) nextBtn.textContent = ui.lessonNext;
    else nextBtn.textContent = mode === 'help' ? ui.lessonBackToTask : ui.lessonToLevel;
  }

  function next() {
    if (nextBtn.disabled) return;
    haptic.light();
    if (i < cards.length - 1) { i += 1; render(1); return; }
    track('lesson_complete', {
      level: L.id, source: mode,
      time_ms: Math.round(performance.now() - t0),
      check_correct: checkResult,
    });
    opts.onDone();
  }

  function prev() {
    if (i === 0) return;
    i -= 1;
    render(-1);
  }

  function skip() {
    track('lesson_skip', { level: L.id, card: i });
    opts.onSkip();
  }

  /* ---------- Карточки ---------- */

  function renderCard(card) {
    switch (card.type) {
      case 'idea': return ideaCard(card);
      case 'contrast': return contrastCard(card);
      case 'traps': return trapsCard(card);
      case 'steps': return stepsCard(card);
      case 'parts': return partsCard(card);
      case 'check': return checkCard(card);
      default: return h('article', null, card.title || '');
    }
  }

  const title = (text) => h('h2', { class: 'lesson-title', tabindex: '-1' }, text);
  const note = (text) => (text ? h('p', { class: 'lesson-note' }, text) : null);

  function ideaCard(card) {
    return h('article', null,
      title(card.title),
      card.text ? h('p', { class: 'lesson-text' }, card.text) : null,
      card.chips ? h('div', { class: 'markers' },
        card.chipsLabel ? h('p', { class: 'markers-label' }, card.chipsLabel) : null,
        h('ul', { class: 'markers-list' }, card.chips.map((c) => h('li', null, c))),
      ) : null,
      card.list ? h('ul', { class: 'term-list' }, card.list.map((it) =>
        h('li', null, h('span', { class: 'term' }, it.term), h('span', { class: 'term-text' }, it.text)))) : null,
      note(card.note),
    );
  }

  function contrastCard(card) {
    const side = (kind, data) => h('section', { class: `contrast contrast--${kind}` },
      h('p', { class: 'contrast-label' },
        h('span', { class: 'contrast-icon' }, icon(kind === 'good' ? 'check' : 'cross', 14)),
        kind === 'good' ? ui.lessonGood : ui.lessonBad),
      h('p', { class: 'contrast-text' }, `«${data.text}»`),
      h('p', { class: 'contrast-note' }, data.note),
    );
    return h('article', null,
      title(card.title),
      card.situation ? h('p', { class: 'lesson-situation' }, card.situation) : null,
      side('bad', card.bad),
      side('good', card.good),
    );
  }

  function trapsCard(card) {
    const profiles = content.profiles.items;
    return h('article', null,
      title(card.title),
      card.text ? h('p', { class: 'lesson-text' }, card.text) : null,
      h('ul', { class: 'traps' }, card.traps.map((t) => {
        const p = profiles[t.profile];
        return h('li', null,
          h('span', { class: 'trap-head' },
            h('span', { class: 'trap-name' }, t.name),
            p ? h('span', { class: 'chip' }, `${p.name} ${p.emoji}`) : null),
          h('span', { class: 'trap-example' }, `«${t.example}»`),
        );
      })),
      note(card.note),
    );
  }

  function stepsCard(card) {
    return h('article', null,
      title(card.title),
      card.text ? h('p', { class: 'lesson-text' }, card.text) : null,
      h('ol', { class: 'sbi' }, card.steps.map((s) =>
        h('li', null, h('span', { class: 'sbi-name' }, s.name), h('span', { class: 'sbi-text' }, s.text)))),
      note(card.note),
    );
  }

  function partsCard(card) {
    const slots = (content.levels.find((l) => l.type === 'build') || {}).slots || [];
    const label = (key) => (slots.find((s) => s.key === key) || {}).label || key;
    const c = card.character && content.characters[card.character];
    return h('article', null,
      title(card.title),
      c ? h('p', { class: 'lesson-situation lesson-to' }, avatar(c, 28), h('span', null, `${c.name}, ${c.role}`)) : null,
      h('ol', { class: 'slots slots--static' }, card.parts.map((p) =>
        h('li', null, h('div', { class: 'slot is-filled' },
          h('span', { class: 'slot-label' }, label(p.slot)),
          h('span', { class: 'slot-body' }, p.text))))),
      note(card.note),
    );
  }

  function checkCard(card) {
    const verdict = h('div', { class: 'lesson-verdict', 'aria-live': 'polite' });
    const list = h('div', { class: 'options', role: 'group' }, card.options.map((opt, k) =>
      h('button', { class: 'option', onclick: () => pick(k) },
        h('span', { class: 'option-text' }, opt.text),
        h('span', { class: 'option-mark', 'aria-hidden': 'true' }))));

    function pick(k, replay = false) {
      if (!replay && answered.has(i)) return;
      answered.add(i);
      choices.set(i, k);
      const opt = card.options[k];
      const ok = Boolean(opt.correct);
      if (!replay) {
        checkResult = ok;
        if (ok) haptic.success(); else haptic.error();
      }
      [...list.children].forEach((btn, n) => {
        const o = card.options[n];
        btn.disabled = true;
        if (o.correct) { btn.classList.add('is-ok'); btn.querySelector('.option-mark').append(icon('check', 18)); }
        else if (n === k) { btn.classList.add('is-bad'); btn.querySelector('.option-mark').append(icon('cross', 18)); }
        else btn.classList.add('is-dim');
      });
      verdict.className = `lesson-verdict ${ok ? 'is-ok' : 'is-bad'}`;
      verdict.replaceChildren(
        h('p', { class: 'lesson-verdict-head' },
          h('span', { class: 'verdict-icon' }, icon(ok ? 'check' : 'cross', 16)),
          h('span', { class: 'verdict-word' }, ok ? ui.verdictOk : ui.verdictBad)),
        h('p', { class: 'lesson-verdict-why' }, opt.why),
      );
      if (replay) return;
      track('lesson_check', { level: L.id, correct: ok });
      updateNext();
      setTimeout(() => verdict.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
    }

    const el = h('article', null,
      title(card.question),
      card.quote ? h('p', { class: 'bubble bubble--out bubble--big lesson-quote' }, `«${card.quote}»`) : null,
      list,
      verdict,
    );
    // Вернулись к уже отвеченной проверке — показываем её с прежним ответом.
    if (choices.has(i)) pick(choices.get(i), true);
    return el;
  }

  render(0);

  return () => window.removeEventListener('keydown', onKey);
}
