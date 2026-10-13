// Уровень 4. «Разговор»: чат в стиле Telegram, шкала доверия, 3 варианта на ход.
// Ветки задаются в content.json (nodes → options → next). Состояние хода
// хранится как путь [узел, вариант], поэтому разговор восстанавливается после закрытия.

import { h, icon, avatar, feedbackSheet, Countdown, sleep, reducedMotion } from '../ui.js?v=0.4.3';

const clamp = (n) => Math.max(0, Math.min(100, n));

export function mount(root, api) {
  const { L, ui, run } = api;
  const st = run.dlg;
  const timerOn = api.settings.timerDialog !== false;

  let dialog = null;
  let character = null;
  let alive = true;
  let busy = false;
  let t0 = 0;

  // ---------- Разметка ----------
  const statusEl = h('span', { class: 'chat-status' }, ui.online);
  const nameEl = h('span', { class: 'chat-name' });
  const avatarSlot = h('span', { class: 'chat-avatar' });
  const trustFill = h('span', { class: 'trust-fill' });
  const trustValue = h('span', { class: 'trust-value' }, '50');
  const trustDelta = h('span', { class: 'trust-delta', 'aria-hidden': 'true' });
  const face = h('span', { class: 'trust-face', 'aria-hidden': 'true' });
  const trustBar = h('div', {
    class: 'trust-track', role: 'meter', 'aria-label': ui.trust, 'aria-valuemin': 0, 'aria-valuemax': 100,
  }, trustFill);
  const chat = h('div', { class: 'chat', role: 'log', 'aria-live': 'polite' });
  const timerFill = h('span', { class: 'timer-fill' });
  const timer = h('div', { class: 'timer timer--dialog', 'aria-hidden': 'true', hidden: !timerOn }, timerFill);
  const optionsEl = h('div', { class: 'reply-options', role: 'group' });
  const dock = h('div', { class: 'dock' }, timer, optionsEl);

  root.append(
    h('div', { class: 'chat-head' },
      h('div', { class: 'chat-who' }, avatarSlot, h('span', { class: 'chat-meta' }, nameEl, statusEl)),
      h('div', { class: 'trust' },
        face,
        h('span', { class: 'trust-label' }, ui.trust),
        trustBar,
        trustValue,
        trustDelta,
      ),
    ),
    chat,
    dock,
  );

  const countdown = new Countdown({ seconds: L.timerSec || 20, fill: timerFill, onExpire: onTimeout });

  // ---------- Шкала доверия ----------
  function setTrust(value, delta) {
    trustFill.style.transform = `scaleX(${value / 100})`;
    trustValue.textContent = String(value);
    trustBar.setAttribute('aria-valuenow', String(value));
    face.innerHTML = faceSvg(value);
    if (delta) {
      trustDelta.textContent = delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
      trustDelta.className = `trust-delta ${delta > 0 ? 'is-up' : 'is-down'}`;
      void trustDelta.offsetWidth;
      trustDelta.classList.add('is-show');
    }
  }

  // ---------- Сообщения ----------
  function scrollDown() {
    chat.scrollTo({ top: chat.scrollHeight, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }
  function addMsg(kind, text) {
    const el = h('div', { class: `msg msg--${kind}` }, h('p', { class: `bubble bubble--${kind === 'in' ? 'in' : 'out'}` }, text));
    chat.append(el);
    scrollDown();
    return el;
  }
  function addNote(text) {
    chat.append(h('p', { class: 'chat-note' }, text));
    scrollDown();
  }
  async function typeReply(text) {
    statusEl.textContent = ui.typing;
    statusEl.classList.add('is-typing');
    const dots = h('div', { class: 'msg msg--in' }, h('p', { class: 'bubble bubble--in typing', 'aria-label': ui.typing }, h('i'), h('i'), h('i')));
    chat.append(dots);
    scrollDown();
    await sleep(Math.min(2000, Math.max(900, 400 + text.length * 14)));
    if (!alive) return;
    dots.remove();
    statusEl.textContent = ui.online;
    statusEl.classList.remove('is-typing');
    addMsg('in', text);
  }

  // ---------- Ход ----------
  function showOptions() {
    const node = dialog.nodes[st.node];
    optionsEl.replaceChildren(...node.options.map((opt) =>
      h('button', { class: 'reply', onclick: () => choose(opt) }, opt.text)));
    dock.classList.add('is-open');
    requestAnimationFrame(scrollDown);
    busy = false;
    t0 = performance.now();
    if (timerOn) countdown.start();
  }
  function hideOptions() {
    countdown.stop();
    dock.classList.remove('is-open');
    optionsEl.replaceChildren();
  }

  async function choose(opt) {
    if (busy) return;
    busy = true;
    const nodeId = st.node;
    hideOptions();
    addMsg('out', opt.text);

    st.path.push([nodeId, opt.id]);
    st.trust = clamp(st.trust + opt.trust);
    st.node = opt.next;
    api.record({
      itemId: `${dialog.id}:${nodeId}`,
      correct: Boolean(opt.good),
      errorTypes: opt.good ? [] : [opt.errorType],
      points: 0,
      timeMs: performance.now() - t0,
    });
    setTrust(st.trust, opt.trust);

    await typeReply(opt.reply);
    if (!alive) return;
    feedbackSheet({
      ui,
      ok: Boolean(opt.good),
      chip: opt.good ? null : api.content.errorTypes[opt.errorType].title,
      why: opt.why,
      character,
      hears: opt.hears,
      onNext: afterTurn,
    });
  }

  async function onTimeout() {
    if (busy) return;
    busy = true;
    const node = dialog.nodes[st.node];
    const nodeId = st.node;
    hideOptions();
    addNote(ui.timeoutNote);

    const delta = L.timeoutTrust || -10;
    st.path.push([nodeId, 'timeout']);
    st.trust = clamp(st.trust + delta);
    st.node = node.onTimeout.next;
    api.record({
      itemId: `${dialog.id}:${nodeId}`,
      correct: false,
      errorTypes: [],
      timeMs: (L.timerSec || 20) * 1000,
      trackError: 'timeout',
    });
    setTrust(st.trust, delta);

    await typeReply(node.onTimeout.reply);
    if (!alive) return;
    feedbackSheet({ ui, ok: false, note: ui.timeUp, why: L.timeoutWhy, onNext: afterTurn });
  }

  function afterTurn() {
    if (!alive) return;
    if (st.node) showOptions();
    else endDialog();
  }

  // ---------- Финал разговора ----------
  function endDialog() {
    const trust = st.trust;
    const ending = dialog.endings
      .slice()
      .sort((a, b) => b.minTrust - a.minTrust)
      .find((e) => trust >= e.minTrust);

    st.results.push({ id: dialog.id, trust, ending: ending.type });
    run.score += trust;
    api.save();
    api.track('dialog_end', { dialog_id: dialog.id, trust, ending: ending.type });

    st.d += 1;
    st.node = null;
    st.path = [];
    st.trust = L.trustStart;
    api.save();

    const iconName = ending.type === 'agreed' ? 'check' : ending.type === 'left' ? 'cross' : 'minus';
    chat.append(h('section', { class: `ending is-${ending.type}` },
      h('span', { class: 'ending-icon' }, icon(iconName, 22)),
      h('h3', { class: 'ending-title' }, ending.title),
      h('p', { class: 'ending-epi' }, ending.epilogue),
      h('p', { class: 'ending-trust' }, `${ui.trust}: ${trust} из 100`),
    ));
    scrollDown();

    const last = st.d >= L.dialogs.length;
    optionsEl.replaceChildren(h('button', {
      class: 'btn btn-primary btn-block',
      onclick: () => (last ? api.finish() : startDialog()),
    }, last ? ui.finishLevel : ui.nextDialog));
    dock.classList.add('is-open');
    timer.hidden = true;
    requestAnimationFrame(scrollDown);
  }

  // ---------- Старт / восстановление ----------
  async function startDialog() {
    if (st.d >= L.dialogs.length) { api.finish(); return; }
    timer.hidden = !timerOn;
    dialog = L.dialogs[st.d];
    character = api.character(dialog.character);
    api.setProgress(`${st.d + 1} / ${L.dialogs.length}`);
    avatarSlot.replaceChildren(avatar(character, 40));
    nameEl.textContent = character.name;
    chat.replaceChildren();
    hideOptions();

    const fresh = st.node == null && st.path.length === 0;
    if (fresh) {
      st.node = dialog.start;
      st.trust = L.trustStart;
      api.save();
    }
    setTrust(st.trust);

    addNote(dialog.context);

    if (fresh) {
      busy = true;
      await sleep(400);
      if (!alive) return;
      await typeReply(dialog.opening);
      if (!alive) return;
      showOptions();
      return;
    }

    // Восстановление: проигрываем путь без анимаций.
    addMsg('in', dialog.opening);
    for (const [nodeId, optId] of st.path) {
      const node = dialog.nodes[nodeId];
      if (optId === 'timeout') {
        addNote(ui.timeoutNote);
        addMsg('in', node.onTimeout.reply);
      } else {
        const opt = node.options.find((o) => o.id === optId);
        addMsg('out', opt.text);
        addMsg('in', opt.reply);
      }
    }
    if (st.node) showOptions();
    else endDialog();
  }

  startDialog();

  return () => {
    alive = false;
    countdown.stop();
  };
}

// Лицо-индикатор: улыбка плавно меняется вместе с доверием.
function faceSvg(trust) {
  const curve = ((trust - 50) / 50) * 4.5; // −4.5 … +4.5
  const y = 15.5 - curve / 3;
  return `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
    <circle cx="12" cy="12" r="9.5"/>
    <circle cx="9" cy="10" r=".9" fill="currentColor" stroke="none"/>
    <circle cx="15" cy="10" r=".9" fill="currentColor" stroke="none"/>
    <path d="M8 ${y.toFixed(2)} Q12 ${(y + curve).toFixed(2)} 16 ${y.toFixed(2)}"/>
  </svg>`;
}
