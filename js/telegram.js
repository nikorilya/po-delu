// Обёртка над Telegram WebApp SDK.
// Всё, что зависит от Telegram, проходит через этот модуль: если SDK нет
// (обычный браузер), каждая функция тихо переключается на веб-замену.

const tg = window.Telegram && window.Telegram.WebApp;

/** true — приложение открыто внутри Telegram (есть initData). */
export const inTelegram = Boolean(tg && tg.initData);

const supports = (version) =>
  inTelegram && typeof tg.isVersionAtLeast === 'function' && tg.isVersionAtLeast(version);

export const user = {
  firstName: (inTelegram && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.first_name) || '',
};

export const platform = inTelegram ? tg.platform : 'web';

/* ---------- Запуск и тема ---------- */

export function initTelegram() {
  if (!inTelegram) {
    applyColorScheme(webColorScheme());
    return;
  }
  tg.ready();
  tg.expand();
  // Свайпы карточек не должны сворачивать мини-приложение.
  if (supports('7.7')) tg.disableVerticalSwipes();
  if (supports('6.1')) {
    tg.setHeaderColor('secondary_bg_color');
    tg.setBackgroundColor('secondary_bg_color');
  }
  applyColorScheme(tg.colorScheme);
  tg.onEvent('themeChanged', () => applyColorScheme(tg.colorScheme));
}

// Вне Telegram: ?theme=dark|light для показа и тестов, иначе системная тема.
function webColorScheme() {
  const q = new URLSearchParams(location.search).get('theme');
  if (q === 'dark' || q === 'light') return q;
  return null;
}

function applyColorScheme(scheme) {
  if (scheme) document.documentElement.dataset.theme = scheme;
}

/* ---------- Тактильный отклик ---------- */

export const haptic = {
  success() { if (supports('6.1')) tg.HapticFeedback.notificationOccurred('success'); },
  error() { if (supports('6.1')) tg.HapticFeedback.notificationOccurred('error'); },
  light() { if (supports('6.1')) tg.HapticFeedback.impactOccurred('light'); },
};

/* ---------- Кнопки Telegram с веб-заменой ---------- */

let backHandler = null;
export const backButton = {
  /** Внутри Telegram показывает нативную «Назад». Возвращает true, если показана нативная. */
  show(handler) {
    this.hide();
    backHandler = handler;
    if (supports('6.1')) {
      tg.BackButton.onClick(backHandler);
      tg.BackButton.show();
      return true;
    }
    return false;
  },
  hide() {
    if (backHandler && supports('6.1')) {
      tg.BackButton.offClick(backHandler);
      tg.BackButton.hide();
    }
    backHandler = null;
  },
  get native() { return supports('6.1'); },
};

let mainHandler = null;
const webMain = () => document.getElementById('mainbar');

export const mainButton = {
  show(text, handler) {
    this.hide();
    mainHandler = handler;
    if (inTelegram) {
      tg.MainButton.setParams({ text, is_visible: true, is_active: true });
      tg.MainButton.onClick(mainHandler);
      return;
    }
    const bar = webMain();
    const btn = bar.querySelector('button');
    btn.textContent = text;
    btn.onclick = () => mainHandler && mainHandler();
    bar.hidden = false;
    document.body.classList.add('has-mainbar');
  },
  hide() {
    if (inTelegram) {
      if (mainHandler) tg.MainButton.offClick(mainHandler);
      tg.MainButton.hide();
    } else {
      const bar = webMain();
      if (bar) bar.hidden = true;
      document.body.classList.remove('has-mainbar');
    }
    mainHandler = null;
  },
};

export const settingsButton = {
  show(handler) {
    if (!supports('7.0')) return false;
    tg.SettingsButton.onClick(handler);
    tg.SettingsButton.show();
    return true;
  },
};

/* ---------- Ссылки, диалоги, шаринг ---------- */

export function openLink(url) {
  if (inTelegram && /^https:\/\/t\.me\//.test(url)) return tg.openTelegramLink(url);
  if (inTelegram) return tg.openLink(url);
  window.open(url, '_blank', 'noopener');
}

/** Есть ли нативный диалог подтверждения Telegram (иначе используется свой, на странице). */
export const canNativeConfirm = () => supports('6.2');

export function confirmDialog(message) {
  return new Promise((resolve) => tg.showConfirm(message, (ok) => resolve(Boolean(ok))));
}

/**
 * Открывает выбор чата с готовым сообщением.
 * Возвращает 'telegram' | 'native' | 'clipboard' | 'none'.
 */
export async function shareMessage(text, url) {
  if (inTelegram) {
    tg.openTelegramLink(
      `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
    );
    return 'telegram';
  }
  if (navigator.share) {
    try { await navigator.share({ text, url }); return 'native'; } catch (e) {
      if (e && e.name === 'AbortError') return 'none'; // пользователь закрыл меню
      // иначе (например, share запрещён во фрейме) — копируем в буфер
    }
  }
  try { await navigator.clipboard.writeText(`${text} ${url}`); return 'clipboard'; } catch { return 'none'; }
}

/* ---------- CloudStorage ---------- */

export const cloud = {
  get available() { return supports('6.9'); },
  get(key) {
    return new Promise((resolve) => {
      if (!this.available) return resolve(null);
      try {
        tg.CloudStorage.getItem(key, (err, value) => resolve(err ? null : value || null));
      } catch { resolve(null); }
    });
  },
  set(key, value) {
    return new Promise((resolve) => {
      if (!this.available) return resolve(false);
      try {
        tg.CloudStorage.setItem(key, value, (err, ok) => resolve(!err && ok));
      } catch { resolve(false); }
    });
  },
};
