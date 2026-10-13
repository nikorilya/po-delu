// Проверка свободных ответов. Модуль без DOM: его можно запускать и в браузере, и в Node.
//
// Сейчас работает проверка по правилам (словари из content.json → planner.markers).
// Точка расширения для ИИ — evaluate(): если в content.json → review.ai.endpoint указан адрес,
// ответ дополнительно отправляется на сервер, и его разбор объединяется с правилами.
// Контракт сервера описан в README, раздел «Проверка ИИ».

/* ---------- Поиск слов по словарям ---------- */

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const regexCache = new Map();

/** Слово без пробелов — основа (ловит любые окончания); запись с пробелом, дефисом или запятой — фраза. */
export function matcher(list) {
  const key = list.join('|');
  if (!regexCache.has(key)) {
    const parts = list.map((e) => (/[\s\-,]/.test(e) ? esc(e) : `${esc(e)}[\\p{L}-]*`));
    regexCache.set(key, new RegExp(`(?<![\\p{L}])(?:${parts.join('|')})`, 'giu'));
  }
  const re = regexCache.get(key);
  re.lastIndex = 0;
  return re;
}

export const words = (t) => (t || '').trim().split(/\s+/).filter(Boolean).length;

export function findMarkers(text, type, markers) {
  const list = markers[type] || [];
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

export const hasTime = (text, markers) => /\d/.test(text) || findMarkers(text, 'time', markers).length > 0;
export const hasQuestion = (text, markers) => text.includes('?') || findMarkers(text, 'agreement', markers).length > 0;

/** Похожесть двух фраз по словам (0…1). Нужна, чтобы отличить «переписал» от «чуть подправил». */
export function similarity(a, b) {
  const toSet = (s) => new Set((s || '').toLowerCase().match(/[\p{L}\d]{3,}/gu) || []);
  const A = toSet(a);
  const B = toSet(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common += 1;
  return common / Math.min(A.size, B.size);
}

/* ---------- Проверка по правилам ---------- */

/**
 * @param text   ответ пользователя
 * @param task   задание { bad, criteria: [{check, types?, n?, role?, required}] }
 * @param env    { markers, errorTypes, labels, notCopyThreshold }
 * @returns { passed, criteria: [{id, label, ok, required, found?}], source: 'rules' }
 */
export function rulesCheck(text, task, env) {
  const t = (text || '').trim();
  const L = env.labels;
  const title = (type) => (env.errorTypes[type] ? env.errorTypes[type].title.toLowerCase() : type === 'sandwichTail' ? 'сэндвич' : type);
  const criteria = task.criteria.map((cr, i) => {
    const id = `${cr.check}${cr.role ? `_${cr.role}` : ''}_${i}`;
    let ok = true;
    let found = null;
    let label = cr.label;
    switch (cr.check) {
      case 'noMarkers': {
        const hits = cr.types.flatMap((type) => findMarkers(t, type, env.markers));
        ok = hits.length === 0;
        if (!ok) found = hits[0].word;
        if (!label) {
          label = cr.role === 'target'
            ? L.target.replace('{types}', [...new Set(cr.types.map(title))].join('», «'))
            : L.extra;
        }
        break;
      }
      case 'hasDetail': ok = hasTime(t, env.markers); label = label || L.hasDetail; break;
      case 'hasQuestion': ok = hasQuestion(t, env.markers); label = label || L.hasQuestion; break;
      case 'notCopy': ok = similarity(t, task.bad) < (env.notCopyThreshold || 0.6); label = label || L.notCopy; break;
      case 'minWords': ok = words(t) >= (cr.n || 8); label = label || L.minWords; break;
      default: ok = true;
    }
    return { id, label, ok, required: cr.required !== false, found };
  });
  const passed = t.length > 0 && criteria.filter((c) => c.required).every((c) => c.ok);
  return { passed, criteria, source: 'rules' };
}

/* ---------- Точка подключения ИИ ---------- */

/**
 * Проверяет ответ: сначала правила, затем (если настроено) сервер с ИИ.
 * Если сервер не ответил или ответил ошибкой — возвращается результат правил,
 * пользователь не замечает сбоя.
 *
 * @param ai { endpoint, timeoutMs } из content.json → review.ai
 */
export async function evaluate(text, task, env, ai) {
  const rules = rulesCheck(text, task, env);
  if (!ai || !ai.endpoint) return rules;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), ai.timeoutMs || 8000) : null;
  try {
    const res = await fetch(ai.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller ? controller.signal : undefined,
      body: JSON.stringify({
        task: { id: task.id, context: task.context, bad: task.bad, model: task.model, positive: Boolean(task.positive) },
        answer: text,
        rules: { passed: rules.passed, criteria: rules.criteria.map(({ id, label, ok }) => ({ id, label, ok })) },
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      // Решение ИИ важнее правил: оно понимает смысл. Если ИИ не вернул passed — остаются правила.
      passed: typeof data.passed === 'boolean' ? data.passed : rules.passed,
      criteria: rules.criteria.concat(Array.isArray(data.criteria)
        ? data.criteria.map((c, i) => ({ id: `ai_${i}`, label: String(c.label || ''), ok: Boolean(c.ok), required: false }))
        : []),
      feedback: typeof data.feedback === 'string' ? data.feedback : null,
      source: 'ai',
    };
  } catch (e) {
    console.warn('[check] проверка ИИ недоступна, используются правила', e);
    return { ...rules, aiError: true };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
