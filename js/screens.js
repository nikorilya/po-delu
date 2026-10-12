// Экраны: приветствие, карта уровней, обёртка уровня, итог уровня,
// итоговый профиль, «Об авторе и методике», настройки.

import { user, inTelegram, mainButton, openLink, confirmDialog, canNativeConfirm, shareMessage } from './telegram.js';
import {
  h, fmt, plural, icon, stars, avatar, topbar, sheet, toast, confetti, hearsBlock, confirmSheet,
} from './ui.js';
import * as swipe from './levels/swipe.js';
import * as fix from './levels/fix.js';
import * as build from './levels/build.js';
import * as dialog from './levels/dialog.js';

const MODULES = { swipe, fix, build, dialog };

const askConfirm = (ui, message) =>
  (canNativeConfirm() ? confirmDialog(message) : confirmSheet(message, ui.confirmReset, ui.cancel));

// append без пустых значений (null/false не превращаются в текст).
const put = (root, ...kids) => root.append(...kids.flat().filter((k) => k != null && k !== false));

const countOf = (L) => (L.items ? L.items.length : L.dialogs.length);
const countLabel = (L) => `${countOf(L)} ${plural(countOf(L), L.unit)}`;

/* ================= Приветствие ================= */

export function welcome(root, _p, ctx) {
  const { app } = ctx.content;
  const w = app.welcome;
  const hello = user.firstName ? fmt(w.greeting, { name: user.firstName }) : w.greetingNoName;

  root.className = 'screen screen--welcome';
  put(root, 
    h('div', { class: 'welcome' },
      h('div', { class: 'welcome-mark', 'aria-hidden': 'true' }, welcomeMark(ctx)),
      h('p', { class: 'welcome-app' }, `${app.title} — ${app.subtitle}`),
      h('h1', { class: 'welcome-hello' }, hello),
      h('p', { class: 'welcome-lead' }, w.lead),
      h('ul', { class: 'welcome-facts' }, w.facts.map((f) => h('li', null, f))),
    ),
  );
  mainButton.show(w.cta, () => {
    ctx.state.welcomed = true;
    ctx.save();
    ctx.go('map');
  });
}

// Небольшая «переписка» персонажей вместо иллюстрации.
function welcomeMark(ctx) {
  const c = ctx.content.characters;
  return h('div', { class: 'mark-stack' },
    ['anya', 'oleg', 'dima', 'marina'].map((k, i) =>
      h('span', { class: 'mark-item', style: { '--i': i } }, avatar(c[k], 44))),
  );
}

/* ================= Карта уровней ================= */

export function map(root, _p, ctx) {
  const { content, state } = ctx;
  const ui = content.ui;
  const levels = content.levels;
  const starsTotal = levels.reduce((s, l) => s + ((state.levels[l.id] && state.levels[l.id].stars) || 0), 0);

  root.className = 'screen screen--map';
  put(root, 
    h('header', { class: 'map-head' },
      h('div', null,
        h('h1', { class: 'map-title' }, content.app.title),
        h('p', { class: 'map-sub' }, content.app.subtitle),
      ),
      h('button', { class: 'icon-btn', 'aria-label': ui.settings, onclick: () => openSettings(ctx) }, icon('gear', 22)),
    ),
    h('div', { class: 'map-progress' },
      h('div', { class: 'meter', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': levels.length * 3, 'aria-valuenow': starsTotal },
        h('span', { class: 'meter-fill', style: { width: `${(starsTotal / (levels.length * 3)) * 100}%` } })),
      h('span', { class: 'map-progress-text' }, star1(), `${starsTotal} из ${levels.length * 3}`),
    ),
    ctx.allDone() ? profileTeaser(ctx) : null,
    h('ol', { class: 'path' }, levels.map((L) => levelCard(L, ctx))),
    h('button', { class: 'link-btn map-about', onclick: () => ctx.go('about') }, ui.aboutLink),
  );
}

function star1() {
  return stars(1, 14).firstChild;
}

function levelCard(L, ctx) {
  const st = ctx.state.levels[L.id];
  const unlocked = ctx.isUnlocked(L.id);
  const inRun = ctx.state.run && ctx.state.run.level === L.id;
  const status = st && st.done ? 'done' : unlocked ? 'open' : 'locked';
  const ui = ctx.content.ui;

  let aside;
  if (status === 'done') aside = stars(st.stars, 18);
  else if (status === 'locked') aside = h('span', { class: 'lvl-lock' }, icon('lock', 18));
  else aside = h('span', { class: 'pill' }, inRun ? ui.levelContinue : ui.levelStart);

  const body = [
    h('span', { class: 'lvl-num', 'aria-hidden': 'true' }, status === 'done' ? icon('check', 18) : String(L.id)),
    h('span', { class: 'lvl-body' },
      h('span', { class: 'lvl-title' }, L.title),
      h('span', { class: 'lvl-goal' }, L.goal),
      h('span', { class: 'lvl-meta' }, status === 'locked'
        ? fmt(ui.lockedHint, { n: L.id - 1 })
        : `${countLabel(L)}, ${L.duration}`),
    ),
    h('span', { class: 'lvl-aside' }, aside),
  ];

  return h('li', { class: `lvl is-${status}` },
    status === 'locked'
      ? h('div', { class: 'lvl-card', 'aria-disabled': 'true' }, body)
      : h('button', {
        class: 'lvl-card',
        'aria-label': `Уровень ${L.id}. ${L.title}`,
        onclick: () => ctx.go('level', { id: L.id }),
      }, body),
  );
}

function profileTeaser(ctx) {
  const p = computeProfile(ctx);
  return h('button', { class: 'teaser', onclick: () => ctx.go('result') },
    h('span', { class: 'teaser-label' }, ctx.content.ui.profileCard),
    h('span', { class: 'teaser-name' }, `${p.profile.name} ${p.profile.emoji}`),
    icon('arrowRight', 20, 'teaser-arrow'),
  );
}

/* ================= Уровень (обёртка) ================= */

export function level(root, { id }, ctx) {
  const L = ctx.level(id);
  const ui = ctx.content.ui;
  if (!L || !ctx.isUnlocked(id)) { ctx.go('map'); return null; }

  let moduleCleanup = null;
  const back = () => ctx.go('map');

  // Интро: одна-две строки о механике, без теории.
  const resuming = ctx.state.run && ctx.state.run.level === id;
  const done = ctx.state.levels[id] && ctx.state.levels[id].done;
  const run = resuming ? ctx.state.run : null;
  const position = run ? (L.type === 'dialog' ? run.dlg.d : run.idx) : 0;

  root.className = 'screen screen--intro';
  put(root, 
    topbar({ title: '', onBack: back }),
    h('div', { class: 'intro' },
      h('span', { class: 'intro-num' }, String(L.id)),
      h('h1', { class: 'intro-title' }, L.title),
      h('p', { class: 'intro-goal' }, L.goal),
      h('p', { class: 'intro-text' }, L.intro),
      h('p', { class: 'intro-meta' }, icon('clock', 16), `${countLabel(L)}, ${L.duration}`),
      resuming && position > 0
        ? h('p', { class: 'intro-resume' }, fmt(ui.resume, { n: position + 1, total: countOf(L) }))
        : null,
    ),
  );

  mainButton.show(resuming ? ui.levelContinue : done ? ui.replay : ui.levelStart, start);

  function start() {
    mainButton.hide();
    if (!resuming) {
      ctx.state.run = ctx.newRun(id);
      ctx.save();
    }
    ctx.track('level_start', { level: id, resumed: Boolean(resuming) });

    root.replaceChildren();
    root.className = `screen screen--level screen--${L.type}`;
    const progress = h('span', null, '');
    const bar = topbar({ title: L.title, progress, onBack: back });
    const stage = h('main', { class: 'stage' });
    put(root, bar, stage);

    const api = {
      L,
      ui,
      content: ctx.content,
      run: ctx.state.run,
      settings: ctx.state.settings,
      character: ctx.character,
      setProgress: (text) => { progress.textContent = text; },
      record: ctx.record,
      save: ctx.save,
      finish: ctx.finishLevel,
      track: ctx.track,
    };
    moduleCleanup = MODULES[L.type].mount(stage, api);
  }

  return () => { if (typeof moduleCleanup === 'function') moduleCleanup(); };
}

/* ================= Итог уровня ================= */

export function levelDone(root, { id, score, max, stars: n }, ctx) {
  const L = ctx.level(id);
  const ui = ctx.content.ui;
  const isLast = id === ctx.content.levels[ctx.content.levels.length - 1].id;

  root.className = 'screen screen--done';
  put(root, 
    topbar({ title: '', onBack: () => ctx.go('map') }),
    h('section', { class: 'done' },
      h('p', { class: 'done-kicker' }, `${ui.levelDone}: ${L.title}`),
      h('div', { class: 'done-stars' }, stars(n, 40)),
      h('p', { class: 'done-score' }, fmt(ui.scoreOf, { score, max })),
      h('p', { class: 'done-line' }, ui.levelDoneLines[n - 1]),
    ),
    doneExtra(L, ctx),
    h('button', { class: 'link-btn', onclick: () => ctx.go('map') }, ui.toMap),
  );
  confetti();

  mainButton.show(isLast ? ui.toResult : ui.nextLevel, () => {
    if (isLast) ctx.go('result');
    else ctx.go('level', { id: id + 1 });
  });
}

function doneExtra(L, ctx) {
  const ui = ctx.content.ui;
  if (L.type === 'build') {
    // Уровень 3: собранные сообщения целиком.
    return h('section', { class: 'done-extra' },
      h('h2', { class: 'section-title' }, 'Пять готовых сообщений'),
      L.items.map((item) => {
        const c = ctx.character(item.character);
        const text = L.slots.map((s) => item.blocks.find((b) => b.slot === s.key).text).join(' ');
        return h('article', { class: 'assembled' },
          h('div', { class: 'assembled-head' }, avatar(c, 28), h('span', null, `${c.name}: ${item.title}`)),
          h('p', { class: 'bubble bubble--out' }, text),
        );
      }),
    );
  }
  if (L.type === 'dialog') {
    const res = (ctx.state.levels[L.id].extra || {}).dialogs || [];
    return h('section', { class: 'done-extra' },
      res.map((r) => {
        const d = L.dialogs.find((x) => x.id === r.id);
        const ending = d.endings.find((e) => e.type === r.ending);
        const c = ctx.character(d.character);
        return h('article', { class: `outcome is-${r.ending}` },
          avatar(c, 36),
          h('div', null,
            h('p', { class: 'outcome-title' }, ending.title),
            h('p', { class: 'outcome-epi' }, ending.epilogue),
          ),
          h('span', { class: 'outcome-trust' }, `${ui.trust} ${r.trust}`),
        );
      }),
    );
  }
  return null;
}

/* ================= Итоговый профиль ================= */

export function computeProfile(ctx) {
  const { profiles, errorTypes, levels } = ctx.content;
  let answered = 0, wrong = 0;
  const byType = {};
  for (const L of levels) {
    const st = ctx.state.levels[L.id];
    if (!st) continue;
    answered += st.answered || 0;
    wrong += st.wrong || 0;
    for (const [t, n] of Object.entries(st.errors || {})) byType[t] = (byType[t] || 0) + n;
  }
  const groups = {};
  for (const [t, n] of Object.entries(byType)) {
    const g = errorTypes[t] && errorTypes[t].group;
    if (g) groups[g] = (groups[g] || 0) + n;
  }
  const rate = answered ? wrong / answered : 0;
  let key = 'master';
  if (rate >= profiles.masterThreshold) {
    // Самая частая группа ошибок; при равенстве — порядок tieOrder.
    let best = -1;
    for (const g of profiles.tieOrder) {
      if ((groups[g] || 0) > best) { best = groups[g] || 0; key = g; }
    }
    if (best <= 0) key = profiles.tieOrder[profiles.tieOrder.length - 1];
  }
  const top = Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return { key, profile: profiles.items[key], rate, answered, wrong, byType, top };
}

export function result(root, _p, ctx) {
  if (!ctx.allDone()) { ctx.go('map'); return; }
  const { content } = ctx;
  const ui = content.ui;
  const p = computeProfile(ctx);
  const total = content.levels.reduce((s, L) => s + (ctx.state.levels[L.id].bestScore || 0), 0);
  const totalMax = content.levels.reduce((s, L) => s + ctx.maxScore(L), 0);
  ctx.track('profile_shown', { profile: p.key, error_rate: Math.round(p.rate * 100) / 100 });

  const topMax = p.top.length ? p.top[0][1] : 1;

  root.className = 'screen screen--result';
  put(root, 
    topbar({ title: '', onBack: () => ctx.go('map') }),
    h('section', { class: 'profile' },
      h('p', { class: 'profile-kicker' }, ui.resultTitle),
      h('h1', { class: 'profile-name' }, h('span', null, p.profile.name), h('span', { class: 'profile-emoji', 'aria-hidden': 'true' }, p.profile.emoji)),
      h('p', { class: 'profile-tagline' }, p.profile.tagline),
    ),
    p.top.length ? h('section', { class: 'card' },
      h('h2', { class: 'section-title' }, ui.topErrors),
      h('ul', { class: 'bars' }, p.top.map(([t, n]) =>
        h('li', null,
          h('span', { class: 'bars-label' }, content.errorTypes[t].title),
          h('span', { class: 'bars-track' }, h('span', { class: 'bars-fill', style: { width: `${(n / topMax) * 100}%` } })),
          h('span', { class: 'bars-n' }, String(n)),
        ))),
    ) : null,
    h('section', { class: 'card' },
      h('h2', { class: 'section-title' }, ui.tipsTitle),
      h('ul', { class: 'tips' }, p.profile.tips.map((t) => h('li', null, t))),
    ),
    h('section', { class: 'card' },
      h('div', { class: 'total' },
        h('h2', { class: 'section-title' }, ui.totalScore),
        h('span', { class: 'total-n' }, fmt(ui.scoreOf, { score: total, max: totalMax })),
      ),
      h('ul', { class: 'level-stars' }, content.levels.map((L) =>
        h('li', null, h('span', null, `${L.id}. ${L.title}`), stars(ctx.state.levels[L.id].stars, 16)))),
    ),
    h('div', { class: 'result-actions' },
      h('button', { class: 'btn btn-primary btn-block', onclick: () => share(ctx, p) }, icon('share', 20), ui.share),
      h('button', { class: 'btn btn-secondary btn-block', onclick: () => restart(ctx) }, icon('restart', 20), ui.restart),
    ),
    authorCard(ctx),
  );
}

async function share(ctx, p) {
  const { app, ui } = ctx.content;
  ctx.track('share_click', { profile: p.key });
  const text = fmt(ui.shareText, { profile: p.profile.name, emoji: p.profile.emoji });
  const how = await shareMessage(text, app.botLink);
  if (how === 'clipboard') toast(ui.copied);
}

async function restart(ctx) {
  const ok = await askConfirm(ctx.content.ui, ctx.content.ui.restartConfirm);
  if (!ok) return;
  ctx.track('restart', {});
  ctx.resetProgress();
  ctx.go('map');
}

function authorCard(ctx) {
  const a = ctx.content.author;
  return h('section', { class: 'author' },
    h('p', { class: 'author-name' }, a.name),
    h('p', { class: 'author-role' }, a.role),
    h('p', { class: 'author-bio' }, a.bio),
    h('ul', { class: 'author-links' }, a.links.map((l) =>
      h('li', null, h('a', {
        class: 'link-btn', href: l.url, target: '_blank', rel: 'noopener',
        // В Telegram ссылки открываются средствами клиента.
        onclick: (e) => { if (inTelegram) { e.preventDefault(); openLink(l.url); } },
      }, l.label, icon('link', 15))))),
  );
}

/* ================= Об авторе и методике ================= */

export function about(root, _p, ctx) {
  const ab = ctx.content.about;
  root.className = 'screen screen--about';
  put(root, 
    topbar({ title: '', onBack: () => ctx.go('map') }),
    h('article', { class: 'about' },
      h('h1', { class: 'about-title' }, ab.title),
      h('p', { class: 'about-lead' }, ab.why),

      h('h2', { class: 'section-title' }, ab.model.title),
      h('p', { class: 'about-text' }, ab.model.text),
      h('ol', { class: 'sbi' }, ab.model.steps.map((s) =>
        h('li', null, h('span', { class: 'sbi-name' }, s.name), h('span', { class: 'sbi-text' }, s.text)))),

      h('h2', { class: 'section-title' }, ab.design.title),
      h('p', { class: 'about-text' }, ab.design.text),
      h('ol', { class: 'ladder' }, ab.design.steps.map((s, i) =>
        h('li', null, h('span', { class: 'ladder-n' }, String(i + 1)), h('span', null, s)))),

      h('ul', { class: 'principles' }, ab.principles.map((p) => h('li', null, p))),
    ),
    authorCard(ctx),
    h('p', { class: 'draft-note' }, `Контент: ${ctx.content._meta.status === 'draft' ? 'черновик' : 'версия'} ${ctx.content._meta.version}`),
  );
}

/* ================= Настройки ================= */

export function openSettings(ctx) {
  const ui = ctx.content.ui;
  const s = ctx.state.settings;
  const toggle = (key, label, hint) => {
    const input = h('input', { type: 'checkbox', role: 'switch' });
    input.checked = Boolean(s[key]);
    input.addEventListener('change', () => { s[key] = input.checked; ctx.save(); });
    return h('label', { class: 'setting' },
      h('span', null, h('span', { class: 'setting-label' }, label), h('span', { class: 'setting-hint' }, hint)),
      input,
    );
  };
  let close;
  const content = h('div', { class: 'settings' },
    h('h2', { class: 'sheet-title' }, ui.settings),
    toggle('timerSwipe', ui.settingTimerSwipe, ui.settingTimerSwipeHint),
    toggle('timerDialog', ui.settingTimerDialog, ui.settingTimerDialogHint),
    h('p', { class: 'setting-note' }, ui.storedNote),
    h('button', {
      class: 'btn btn-danger btn-block',
      onclick: async () => {
        const ok = await askConfirm(ui, ui.restartConfirm);
        if (!ok) return;
        ctx.track('restart', { source: 'settings' });
        ctx.resetProgress();
        close();
        ctx.go('map');
      },
    }, ui.settingReset),
  );
  close = sheet(content);
}

export { hearsBlock };
