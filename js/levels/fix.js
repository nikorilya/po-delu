// Уровень 2. «Почини фразу»: выбрать лучший из трёх вариантов.

import { h, icon, avatar, feedbackSheet } from '../ui.js?v=0.4.3';

export function mount(root, api) {
  const { L, ui, run } = api;
  const items = L.items;
  let t0 = 0;

  function show() {
    if (run.idx >= items.length) { api.finish(); return; }
    const item = items[run.idx];
    const c = api.character(item.character);
    api.setProgress(`${run.idx + 1} / ${items.length}`);
    t0 = performance.now();

    const options = item.options.map((opt) =>
      h('button', { class: 'option', onclick: () => pick(item, opt, list) },
        h('span', { class: 'option-text' }, opt.text),
        h('span', { class: 'option-mark', 'aria-hidden': 'true' }),
      ));
    const list = h('div', { class: 'options', role: 'group', 'aria-label': ui.fixQuestion }, options);

    root.replaceChildren(
      h('div', { class: 'fix' },
        h('p', { class: 'context' }, avatar(c, 28), h('span', null, item.context)),
        h('div', { class: 'bad' },
          h('span', { class: 'bad-label' }, ui.badPhraseLabel),
          h('p', { class: 'bubble bubble--out bubble--big' }, item.bad),
        ),
        h('h2', { class: 'question' }, item.positive ? ui.fixQuestionPositive : ui.fixQuestion),
        list,
      ),
    );
    window.scrollTo(0, 0);
  }

  function pick(item, opt, list) {
    if (list.classList.contains('is-answered')) return;
    list.classList.add('is-answered');
    const correct = Boolean(opt.correct);
    [...list.children].forEach((btn, i) => {
      const o = item.options[i];
      btn.disabled = true;
      if (o.correct) {
        btn.classList.add('is-ok');
        btn.querySelector('.option-mark').append(icon('check', 18));
      } else if (o === opt) {
        btn.classList.add('is-bad');
        btn.querySelector('.option-mark').append(icon('cross', 18));
      } else {
        btn.classList.add('is-dim');
      }
    });

    api.record({
      itemId: item.id,
      correct,
      errorTypes: correct ? [] : [opt.errorType],
      points: correct ? (L.pointsPerItem || 10) : 0,
      timeMs: performance.now() - t0,
    });
    run.idx += 1;
    api.save();

    feedbackSheet({
      ui,
      ok: correct,
      chip: correct ? null : api.content.errorTypes[opt.errorType].title,
      why: opt.why,
      character: api.character(item.character),
      hears: opt.hears,
      onNext: show,
    });
  }

  show();
  return null;
}
