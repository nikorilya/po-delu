// «Работа над ошибками»: короткий раунд на два самых частых типа ошибок человека
// (3 + 2 задания: найди, почини, перепиши сам). Для «Мастера фидбэка» — «Сложный раунд»
// с тонко спрятанными ловушками. Баллы и звёзды основного прохождения не меняются.

import { h, fmt, plural, icon, avatar, topbar, feedbackSheet, hearsBlock } from './ui.js';
import { haptic, mainButton } from './telegram.js';
import { evaluate } from './check.js';

/* ================= Данные ================= */

export function emptyReview() {
  return { seen: {}, rounds: [], mastered: {}, run: null, last: 0 };
}

const reviewState = (ctx) => {
  if (!ctx.state.review) ctx.state.review = emptyReview();
  return ctx.state.review;
};

/** Сумма ошибок по типам за последнюю попытку каждого уровня. */
function errorCounts(ctx) {
  const by = {};
  let answered = 0;
  let wrong = 0;
  for (const L of ctx.content.levels) {
    const st = ctx.state.levels[L.id];
    if (!st) continue;
    answered += st.answered || 0;
    wrong += st.wrong || 0;
    for (const [t, n] of Object.entries(st.errors || {})) by[t] = (by[t] || 0) + n;
  }
  return { by, rate: answered ? wrong / answered : 0 };
}

/**
 * Какой раунд положен человеку: целевой — по двум самым частым типам ошибок;
 * сложный — если профиль «Мастер фидбэка» или ошибок с типом не было.
 */
export function reviewPlan(ctx) {
  const R = ctx.content.review;
  const { by, rate } = errorCounts(ctx);
  const types = Object.entries(by)
    .filter(([t, n]) => n > 0 && R.banks[t])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([t]) => t);
  const master = rate < ctx.content.profiles.masterThreshold;
  if (master || !types.length) return { kind: 'hard', types: [] };
  return { kind: 'targeted', types };
}

// append без пустых значений (null не превращается в текст «null»).
const put = (el, ...kids) => el.append(...kids.flat().filter((k) => k != null && k !== false));

const allItems = (R) => [...Object.values(R.banks).flat(), ...R.hard];
const itemById = (R, id) => allItems(R).find((i) => i.id === id);

/** Подбирает 5 заданий: по слоту «вид + тип» берёт то, что человек видел реже всего. */
function buildRun(ctx, kind, types) {
  const R = ctx.content.review;
  const rv = reviewState(ctx);
  const chosen = [];
  const slotTypes = kind === 'targeted'
    ? (() => {
      const [t1, t2 = t1] = types;
      // find(t1), find(t2), fix(t1), fix(t2), rewrite(t1) → t1: 3 задания, t2: 2
      return [t1, t2, t1, t2, t1];
    })()
    : R.slots.map(() => null);

  R.slots.forEach((kindOfTask, i) => {
    const pool = (kind === 'targeted' ? R.banks[slotTypes[i]] : R.hard)
      .filter((it) => it.kind === kindOfTask && !chosen.includes(it.id));
    const pick = pool.slice().sort((a, b) => (rv.seen[a.id] || 0) - (rv.seen[b.id] || 0))[0];
    if (pick) chosen.push(pick.id);
  });
  return { kind, types, items: chosen, slotTypes, idx: 0, results: [], started: false, startedAt: Date.now() };
}

const joinTypes = (ctx, types) => {
  const names = types.map((t) => ctx.content.errorTypes[t].title.toLowerCase());
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}` : names[0] || '';
};

export const reviewTeaserText = (ctx, plan) => (plan.kind === 'hard'
  ? ctx.content.review.hardTeaser
  : fmt(ctx.content.review.teaser, { types: joinTypes(ctx, plan.types) }));

/** Пора ли напомнить о повторении (прошло больше againAfterHours с последнего раунда). */
export function reviewDue(ctx) {
  const rv = reviewState(ctx);
  return rv.last > 0 && Date.now() - rv.last > ctx.content.review.againAfterHours * 3600 * 1000;
}

export const masteredTypes = (ctx) => Object.keys(reviewState(ctx).mastered || {});
export const reviewInProgress = (ctx) => Boolean(reviewState(ctx).run);

/* ================= Экран раунда ================= */

export function review(root, { kind, from } = {}, ctx) {
  if (!ctx.allDone()) { ctx.go('map'); return null; }
  const R = ctx.content.review;
  const ui = ctx.content.ui;
  const rv = reviewState(ctx);
  const env = { markers: ctx.content.planner.markers, errorTypes: ctx.content.errorTypes, labels: R.criteria, notCopyThreshold: R.notCopyThreshold };
  let alive = true;

  if (!rv.run || (kind && rv.run.kind !== kind)) {
    const plan = reviewPlan(ctx);
    const k = kind || plan.kind;
    rv.run = buildRun(ctx, k, k === 'targeted' ? plan.types : []);
    ctx.save();
  }
  const run = rv.run;
  const title = run.kind === 'hard' ? R.hardTitle : R.title;
  const back = () => ctx.go(from === 'map' ? 'map' : 'result');

  root.className = 'screen screen--review';

  if (!run.started) {
    // Вступление: какие ловушки и как устроен раунд.
    root.append(
      topbar({ title: '', onBack: back }),
      h('div', { class: 'intro' },
        h('span', { class: 'intro-num' }, icon(run.kind === 'hard' ? 'alert' : 'restart', 24)),
        h('h1', { class: 'intro-title' }, title),
        h('p', { class: 'intro-text' }, run.kind === 'hard' ? R.hardIntro : fmt(R.intro, { types: joinTypes(ctx, run.types) })),
        h('p', { class: 'intro-meta' }, icon('clock', 16), `${run.items.length} ${plural(run.items.length, ['задание', 'задания', 'заданий'])}, около 2${' '}минут`),
      ),
    );
    mainButton.show(R.start, () => {
      run.started = true;
      ctx.save();
      ctx.track('review_start', { kind: run.kind, types: run.types });
      ctx.go('review', { from });
    });
    return null;
  }

  const progress = h('span', null, '');
  const stage = h('main', { class: 'stage review-stage' });
  root.append(topbar({ title, progress, onBack: back }), stage);

  function show() {
    if (!alive) return;
    if (run.idx >= run.items.length) { finish(); return; }
    const item = itemById(R, run.items[run.idx]);
    if (!item) { run.idx += 1; ctx.save(); show(); return; }
    progress.textContent = `${run.idx + 1} / ${run.items.length}`;
    stage.replaceChildren();
    window.scrollTo(0, 0);
    if (item.kind === 'find') renderFind(item);
    else if (item.kind === 'fix') renderFix(item);
    else renderRewrite(item);
  }

  function complete(item, correct, extra = {}) {
    rv.seen[item.id] = (rv.seen[item.id] || 0) + 1;
    run.results.push({ id: item.id, kind: item.kind, type: run.slotTypes[run.idx] || null, correct });
    run.idx += 1;
    ctx.save();
    ctx.track('review_answer', { item_id: item.id, kind: item.kind, type: run.slotTypes[run.idx - 1] || null, correct, ...extra });
  }

  const contextLine = (item, text) => {
    const c = ctx.character(item.character);
    return h('p', { class: 'context' }, avatar(c, 28), h('span', null, text || `${c.name}, ${c.role}`));
  };

  /* ---------- Найди ловушку ---------- */

  function renderFind(item) {
    const label = (t) => (t === 'ok' ? R.okOption : ctx.content.errorTypes[t].title);
    const list = h('div', { class: 'options', role: 'group', 'aria-label': R.findQuestion }, item.options.map((t) =>
      h('button', { class: 'option', onclick: () => pick(t) },
        h('span', { class: 'option-text' }, label(t)),
        h('span', { class: 'option-mark', 'aria-hidden': 'true' }))));
    stage.append(h('div', { class: 'fix' },
      contextLine(item),
      h('div', { class: 'bad' }, h('p', { class: 'bubble bubble--out bubble--big' }, `«${item.phrase}»`)),
      h('h2', { class: 'question' }, R.findQuestion),
      list,
    ));

    function pick(choice) {
      if (list.classList.contains('is-answered')) return;
      list.classList.add('is-answered');
      const correct = choice === item.answer;
      [...list.children].forEach((btn, i) => {
        const t = item.options[i];
        btn.disabled = true;
        if (t === item.answer) { btn.classList.add('is-ok'); btn.querySelector('.option-mark').append(icon('check', 18)); }
        else if (t === choice) { btn.classList.add('is-bad'); btn.querySelector('.option-mark').append(icon('cross', 18)); }
        else btn.classList.add('is-dim');
      });
      complete(item, correct, { chosen: choice });
      feedbackSheet({
        ui, ok: correct,
        chip: item.answer === 'ok' ? R.okChip : ctx.content.errorTypes[item.answer].title,
        why: item.why, character: ctx.character(item.character), hears: item.hears,
        onNext: show,
      });
    }
  }

  /* ---------- Почини фразу ---------- */

  function renderFix(item) {
    const list = h('div', { class: 'options', role: 'group' }, item.options.map((o) =>
      h('button', { class: 'option', onclick: () => pick(o) },
        h('span', { class: 'option-text' }, o.text),
        h('span', { class: 'option-mark', 'aria-hidden': 'true' }))));
    stage.append(h('div', { class: 'fix' },
      contextLine(item, item.context),
      h('div', { class: 'bad' },
        h('span', { class: 'bad-label' }, ui.badPhraseLabel),
        h('p', { class: 'bubble bubble--out bubble--big' }, item.bad)),
      h('h2', { class: 'question' }, item.positive ? R.fixQuestionPositive : R.fixQuestion),
      list,
    ));

    function pick(o) {
      if (list.classList.contains('is-answered')) return;
      list.classList.add('is-answered');
      const correct = Boolean(o.correct);
      [...list.children].forEach((btn, i) => {
        const x = item.options[i];
        btn.disabled = true;
        if (x.correct) { btn.classList.add('is-ok'); btn.querySelector('.option-mark').append(icon('check', 18)); }
        else if (x === o) { btn.classList.add('is-bad'); btn.querySelector('.option-mark').append(icon('cross', 18)); }
        else btn.classList.add('is-dim');
      });
      complete(item, correct, { chosen: correct ? 'correct' : o.errorType });
      feedbackSheet({
        ui, ok: correct,
        chip: correct ? null : ctx.content.errorTypes[o.errorType].title,
        why: o.why, character: ctx.character(item.character), hears: o.hears,
        onNext: show,
      });
    }
  }

  /* ---------- Перепиши сам ---------- */

  function renderRewrite(item) {
    const c = ctx.character(item.character);
    const area = h('textarea', {
      class: 'plan-input plan-area', id: `rw-${item.id}`, rows: '4', maxlength: '400',
      placeholder: R.rewritePlaceholder,
    });
    const resultEl = h('div', { class: 'rewrite-result', 'aria-live': 'polite' });
    const btn = h('button', { class: 'btn btn-primary btn-block', onclick: check });
    stage.append(
      h('div', { class: 'fix' },
        contextLine(item, item.context),
        h('div', { class: 'bad' },
          h('span', { class: 'bad-label' }, ui.badPhraseLabel),
          h('p', { class: 'bubble bubble--out bubble--big' }, item.bad)),
        h('h2', { class: 'question' }, h('label', { for: `rw-${item.id}` }, item.positive ? R.rewriteTitlePositive : R.rewriteTitle)),
        area,
        resultEl,
      ),
      h('div', { class: 'footer-action' }, btn),
    );

    let checked = false;
    let selfAnswer = null;
    const update = () => {
      const ok = area.value.trim().length >= 2;
      btn.disabled = !ok;
      btn.textContent = ok ? R.rewriteCheck : R.rewriteRequired;
    };
    area.addEventListener('input', update);
    update();
    setTimeout(() => area.focus({ preventScroll: true }), 80);

    async function check() {
      if (checked || btn.disabled) return;
      checked = true;
      btn.disabled = true;
      btn.textContent = R.rewriteChecking;
      area.readOnly = true;
      const res = await evaluate(area.value, item, env, R.ai);
      if (!alive) return;
      if (res.passed) haptic.success(); else haptic.error();

      const selfNote = h('p', { class: 'self-note', hidden: true });
      const selfBtns = h('div', { class: 'self-buttons' },
        [['yes', R.selfYes], ['no', R.selfNo]].map(([v, text]) =>
          h('button', {
            class: 'reaction-chip', 'aria-pressed': 'false',
            onclick: (e) => {
              selfAnswer = v;
              [...selfBtns.children].forEach((b) => b.setAttribute('aria-pressed', 'false'));
              e.currentTarget.setAttribute('aria-pressed', 'true');
              selfNote.textContent = v === 'yes' ? R.selfYesNote : R.selfNoNote;
              selfNote.hidden = false;
              btn.disabled = false;
              btn.textContent = ui.next;
              btn.onclick = next;
            },
          }, text)));

      resultEl.replaceChildren(
        h('div', { class: `lesson-verdict ${res.passed ? 'is-ok' : 'is-bad'}` },
          h('p', { class: 'lesson-verdict-head' },
            h('span', { class: 'verdict-icon' }, icon(res.passed ? 'check' : 'alert', 16)),
            h('span', { class: 'verdict-word' }, res.passed ? R.rewritePassed : R.rewriteAlmost)),
          h('ul', { class: 'checklist' }, res.criteria.map((cr) =>
            h('li', { class: cr.ok ? 'is-ok' : 'is-warn' },
              h('span', { class: 'checklist-icon' }, icon(cr.ok ? 'check' : 'alert', 16)),
              h('span', null, cr.label, !cr.ok && cr.found ? h('span', { class: 'crit-found' }, ` — ${fmt(R.criteriaFoundWord, { word: cr.found })}`) : null)))),
          res.feedback ? h('div', { class: 'ai-feedback' }, h('p', { class: 'ai-title' }, R.aiTitle), h('p', null, res.feedback)) : null,
        ),
        h('section', { class: 'review-model' },
          h('p', { class: 'assembled-label' }, R.modelLabel),
          h('p', { class: 'bubble bubble--out' }, item.model),
          hearsBlock(ui, c, item.hears),
        ),
        h('section', { class: 'self-check' },
          h('p', { class: 'self-question' }, item.positive ? R.selfQuestionPositive : R.selfQuestion),
          selfBtns,
          selfNote,
        ),
      );
      btn.textContent = R.selfRequired;
      btn.disabled = true;
      setTimeout(() => resultEl.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);

      function next() {
        ctx.track('review_rewrite', {
          item_id: item.id, passed: res.passed, source: res.source,
          failed: res.criteria.filter((x) => !x.ok).map((x) => x.id), self_check: selfAnswer,
        });
        complete(item, res.passed, { self_check: selfAnswer });
        show();
      }
    }
  }

  /* ---------- Конец раунда ---------- */

  function finish() {
    const score = run.results.filter((r) => r.correct).length;
    const total = run.results.length;
    const newlyMastered = [];
    if (run.kind === 'targeted' && score >= R.masteryScore) {
      for (const t of run.types) {
        const mine = run.results.filter((r) => r.type === t);
        if (mine.length && mine.every((r) => r.correct)) {
          if (!rv.mastered[t]) newlyMastered.push(t);
          rv.mastered[t] = true;
        }
      }
    }
    const summary = {
      kind: run.kind, types: run.types, score, total, at: Date.now(),
      byType: Object.fromEntries(run.types.map((t) => {
        const mine = run.results.filter((r) => r.type === t);
        return [t, { right: mine.filter((r) => r.correct).length, total: mine.length }];
      })),
      newlyMastered,
    };
    rv.rounds.push(summary);
    if (rv.rounds.length > 20) rv.rounds.shift();
    rv.last = Date.now();
    rv.run = null;
    ctx.save();
    ctx.track('review_complete', { kind: run.kind, score, total, types: run.types, mastered: newlyMastered });
    ctx.go('reviewDone', { from });
  }

  show();

  return () => { alive = false; };
}

/* ================= Итог раунда ================= */

export function reviewDone(root, { from } = {}, ctx) {
  const R = ctx.content.review;
  const rv = reviewState(ctx);
  const s = rv.rounds[rv.rounds.length - 1];
  if (!s) { ctx.go('map'); return null; }
  const { by } = errorCounts(ctx);
  const bucket = s.score >= R.masteryScore ? 2 : s.score >= 3 ? 1 : 0;

  root.className = 'screen screen--done';
  put(root, 
    topbar({ title: '', onBack: () => ctx.go(from === 'map' ? 'map' : 'result') }),
    h('section', { class: 'done' },
      h('p', { class: 'done-kicker' }, `${R.doneTitle}: ${s.kind === 'hard' ? R.hardTitle : R.title}`),
      h('p', { class: 'done-score' }, fmt(R.doneScore, { score: s.score, total: s.total })),
      h('p', { class: 'done-line' }, R.doneLines[bucket]),
    ),
    s.kind === 'targeted' ? h('section', { class: 'card' },
      h('ul', { class: 'compare' }, s.types.map((t) => {
        const before = by[t] || 0;
        const now = s.byType[t] || { right: 0, total: 0 };
        return h('li', null,
          h('span', { class: 'compare-head' },
            h('span', { class: 'compare-type' }, ctx.content.errorTypes[t].title),
            rv.mastered[t] ? h('span', { class: 'chip chip--ok' }, icon('check', 12), R.mastered) : null),
          h('span', { class: 'compare-text' }, fmt(R.doneCompare, {
            before, times: plural(before, R.timesForms), now: now.right, total: now.total,
          })));
      })),
    ) : null,
    h('p', { class: 'repeat-note' }, icon('clock', 16), R.repeatNote),
    h('div', { class: 'result-actions' },
      h('button', { class: 'btn btn-primary btn-block', onclick: () => ctx.go('review', { kind: s.kind, from }) }, icon('restart', 20), R.again),
      h('button', {
        class: 'btn btn-secondary btn-block',
        onclick: () => ctx.go((ctx.state.plans || []).length ? 'plans' : 'plan', { from: 'result' }),
      }, R.toPlanner),
      h('button', { class: 'link-btn done-back', onclick: () => ctx.go('result') }, R.toResult),
    ),
  );
  return null;
}
