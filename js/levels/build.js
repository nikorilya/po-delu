// Уровень 3. «Собери фидбэк»: 4 слота SBI+ и 7 блоков (4 верных, 3 ловушки).
// Основная механика — тапы: блок встаёт в первый свободный слот,
// тап по заполненному слоту возвращает блок обратно.

import { h, icon, avatar, fmt, feedbackSheet, seededShuffle } from '../ui.js';
import { haptic } from '../telegram.js';

export function mount(root, api) {
  const { L, ui, run } = api;
  const items = L.items;

  function show() {
    if (run.idx >= items.length) { api.finish(); return; }
    const item = items[run.idx];
    const c = api.character(item.character);
    api.setProgress(`${run.idx + 1} / ${items.length}`);
    const t0 = performance.now();

    const order = seededShuffle(item.blocks, item.id);
    const placed = Object.fromEntries(L.slots.map((s) => [s.key, null]));
    let checked = false;

    const slotEls = {};
    const slotList = h('ol', { class: 'slots' }, L.slots.map((s) => {
      const body = h('span', { class: 'slot-body' }, h('span', { class: 'slot-hint' }, s.hint));
      const el = h('button', {
        class: 'slot is-empty',
        'aria-label': `${s.label}: пусто`,
        onclick: () => unplace(s.key),
      },
        h('span', { class: 'slot-label' }, s.label),
        body,
        h('span', { class: 'slot-mark', 'aria-hidden': 'true' }),
      );
      slotEls[s.key] = { el, body, slot: s };
      return h('li', null, el);
    }));

    const blockEls = {};
    const pool = h('div', { class: 'pool' }, order.map((b) => {
      const el = h('button', { class: 'block', onclick: () => place(b.id) }, b.text);
      blockEls[b.id] = el;
      return el;
    }));

    const checkBtn = h('button', { class: 'btn btn-primary btn-block', disabled: true, onclick: check }, ui.check);

    root.replaceChildren(
      h('div', { class: 'build' },
        h('section', { class: 'situation' },
          h('div', { class: 'situation-head' }, avatar(c, 32), h('h2', null, item.title)),
          h('p', { class: 'situation-text' }, item.context),
        ),
        slotList,
        pool,
      ),
      h('div', { class: 'footer-action' }, checkBtn),
    );
    window.scrollTo(0, 0);

    function place(blockId) {
      if (checked) return;
      const free = L.slots.find((s) => !placed[s.key]);
      if (!free) return;
      haptic.light();
      placed[free.key] = blockId;
      blockEls[blockId].classList.add('is-used');
      blockEls[blockId].disabled = true;
      render();
    }

    function unplace(key) {
      if (checked || !placed[key]) return;
      haptic.light();
      const id = placed[key];
      placed[key] = null;
      blockEls[id].classList.remove('is-used');
      blockEls[id].disabled = false;
      render();
    }

    function render() {
      for (const { el, body, slot } of Object.values(slotEls)) {
        const id = placed[slot.key];
        if (id) {
          const b = item.blocks.find((x) => x.id === id);
          if (!el.classList.contains('is-filled') || body.dataset.id !== id) {
            body.replaceChildren(h('span', { class: 'slot-text' }, b.text));
            body.dataset.id = id;
            el.classList.remove('is-empty');
            el.classList.add('is-filled', 'is-pop');
            setTimeout(() => el.classList.remove('is-pop'), 220);
          }
          el.setAttribute('aria-label', `${slot.label}: ${b.text}. Нажми, чтобы вернуть`);
        } else {
          body.replaceChildren(h('span', { class: 'slot-hint' }, slot.hint));
          delete body.dataset.id;
          el.classList.add('is-empty');
          el.classList.remove('is-filled');
          el.setAttribute('aria-label', `${slot.label}: пусто`);
        }
      }
      checkBtn.disabled = L.slots.some((s) => !placed[s.key]);
    }

    function check() {
      if (checked) return;
      checked = true;
      checkBtn.disabled = true;

      let okCount = 0;
      const traps = [];
      let misordered = false;
      for (const s of L.slots) {
        const b = item.blocks.find((x) => x.id === placed[s.key]);
        const ok = b.slot === s.key;
        const { el } = slotEls[s.key];
        el.classList.add(ok ? 'is-ok' : 'is-bad');
        el.querySelector('.slot-mark').replaceChildren(icon(ok ? 'check' : 'cross', 18));
        el.disabled = true;
        if (ok) okCount += 1;
        else if (b.errorType) traps.push(b);
        else misordered = true;
      }
      Object.values(blockEls).forEach((el) => { el.disabled = true; });

      const allOk = okCount === L.slots.length;
      api.record({
        itemId: item.id,
        correct: allOk,
        answered: L.slots.length,
        wrongCount: L.slots.length - okCount,
        errorTypes: traps.map((t) => t.errorType),
        points: okCount * (L.pointsPerSlot || 10),
        timeMs: performance.now() - t0,
        trackError: allOk ? null : (traps.map((t) => t.errorType).join(',') || 'order'),
      });
      run.idx += 1;
      api.save();

      const trap = traps[0];
      const message = L.slots.map((s) => item.blocks.find((b) => b.slot === s.key).text).join(' ');
      feedbackSheet({
        ui,
        ok: allOk,
        note: allOk ? null : fmt(L.partialNote, { n: okCount }),
        chip: trap ? api.content.errorTypes[trap.errorType].title : null,
        why: allOk ? L.okWhy : trap ? trap.why : L.orderHint,
        extra: h('div', { class: 'assembled-preview' },
          h('p', { class: 'assembled-label' }, ui.assembledLabel),
          h('p', { class: 'bubble bubble--out' }, message),
        ),
        character: c,
        hears: trap ? trap.hears : item.hears,
        onNext: show,
      });
    }
  }

  show();
  return null;
}
