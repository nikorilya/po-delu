// Уровень 1. «Факт или ярлык»: свайп вправо — факт, влево — оценка.
// Кнопки внизу дублируют свайп; стрелки клавиатуры — для показа на компьютере.

import { h, icon, avatar, feedbackSheet, Countdown, reducedMotion } from '../ui.js';

const THRESHOLD = 90;

export function mount(root, api) {
  const { L, ui, run } = api;
  const items = L.items;
  const timerOn = api.settings.timerSwipe !== false;

  const fill = h('span', { class: 'timer-fill' });
  const timer = h('div', { class: 'timer', 'aria-hidden': 'true', hidden: !timerOn }, fill);
  const deck = h('div', { class: 'deck' });
  const btnJudg = h('button', { class: 'choice choice--judg', onclick: () => answer('judgment') },
    icon('arrowLeft', 20), ui.judgment);
  const btnFact = h('button', { class: 'choice choice--fact', onclick: () => answer('fact') },
    ui.fact, icon('arrowRight', 20));

  root.append(
    timer,
    deck,
    h('div', { class: 'choices' }, btnJudg, btnFact),
  );

  const countdown = new Countdown({ seconds: L.timerSec || 6, fill, onExpire: () => answer(null, true) });
  let busy = true;
  let card = null;
  let t0 = 0;

  const onKey = (e) => {
    if (busy || document.querySelector('.sheet, .lesson-overlay')) return;
    if (e.key === 'ArrowLeft') answer('judgment');
    if (e.key === 'ArrowRight') answer('fact');
  };
  window.addEventListener('keydown', onKey);

  function makeCard(item, ghost) {
    const c = api.character(item.character);
    return h('article', { class: `swipe-card${ghost ? ' is-ghost' : ''}`, 'aria-live': ghost ? null : 'polite' },
      h('span', { class: 'stamp stamp--fact' }, ui.fact),
      h('span', { class: 'stamp stamp--judg' }, ui.judgment),
      h('div', { class: 'swipe-to' }, avatar(c, 28), h('span', null, c.name)),
      h('p', { class: 'swipe-text' }, `«${item.text}»`),
    );
  }

  function show() {
    if (run.idx >= items.length) { api.finish(); return; }
    api.setProgress(`${run.idx + 1} / ${items.length}`);
    deck.replaceChildren();
    const next = items[run.idx + 1];
    if (next) deck.append(makeCard(next, true));
    card = makeCard(items[run.idx], false);
    deck.append(card);
    attachDrag(card);
    busy = false;
    t0 = performance.now();
    if (timerOn) countdown.start();
  }

  function attachDrag(el) {
    let x0 = null;
    let dx = 0;
    el.addEventListener('pointerdown', (e) => {
      if (busy) return;
      x0 = e.clientX;
      dx = 0;
      el.setPointerCapture(e.pointerId);
      el.classList.add('is-dragging');
    });
    el.addEventListener('pointermove', (e) => {
      if (x0 == null) return;
      dx = e.clientX - x0;
      el.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
      el.style.setProperty('--fact', Math.max(0, Math.min(1, dx / THRESHOLD)));
      el.style.setProperty('--judg', Math.max(0, Math.min(1, -dx / THRESHOLD)));
    });
    const release = () => {
      if (x0 == null) return;
      x0 = null;
      el.classList.remove('is-dragging');
      if (Math.abs(dx) > THRESHOLD) {
        answer(dx > 0 ? 'fact' : 'judgment');
      } else {
        el.style.transform = '';
        el.style.setProperty('--fact', 0);
        el.style.setProperty('--judg', 0);
      }
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
  }

  function flyAway(dir) {
    if (!card) return;
    const el = card;
    el.classList.add('is-leaving');
    if (reducedMotion()) {
      el.style.opacity = '0';
    } else if (dir === 'fact' || dir === 'judgment') {
      const sign = dir === 'fact' ? 1 : -1;
      el.style.setProperty(dir === 'fact' ? '--fact' : '--judg', 1);
      el.style.transform = `translateX(${sign * 140}%) rotate(${sign * 18}deg)`;
      el.style.opacity = '0';
    } else {
      el.style.transform = 'translateY(40px) scale(.96)';
      el.style.opacity = '0';
    }
  }

  function answer(choice, timeUp = false) {
    if (busy) return;
    busy = true;
    countdown.stop();
    const item = items[run.idx];
    const correct = !timeUp && choice === item.answer;
    const timeMs = performance.now() - t0;

    flyAway(timeUp ? null : choice);

    // Если не распознал оценку как оценку — это тот же тип ошибки, что в карточке.
    const missedType = !correct && !timeUp && item.answer === 'judgment' ? item.errorType : null;
    api.record({
      itemId: item.id,
      correct,
      errorTypes: missedType ? [missedType] : [],
      points: correct ? (L.pointsPerItem || 10) : 0,
      timeMs,
      trackError: correct ? null : timeUp ? 'timeout' : (missedType || 'missed_fact'),
    });
    run.idx += 1;
    api.save();

    const isFact = item.answer === 'fact';
    setTimeout(() => {
      feedbackSheet({
        ui,
        ok: correct,
        note: timeUp ? ui.timeUp : null,
        chip: isFact ? ui.fact : api.content.errorTypes[item.errorType].title,
        why: item.explain,
        character: api.character(item.character),
        hears: item.hears,
        onNext: show,
      });
    }, reducedMotion() ? 0 : 200);
  }

  show();

  return () => {
    countdown.stop();
    window.removeEventListener('keydown', onKey);
  };
}
