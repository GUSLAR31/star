import { getStore } from '@netlify/blobs';

/* ============================================================
   Correct answers live ONLY here, server-side. index.html ships
   prompts, hints and visuals to the browser, but never answers —
   this function is the single source of truth for grading.
   Admins can override any of this per-mission via /admin, which
   writes into the quest-config Blobs store; those overrides win
   over the defaults below when present.
   ============================================================ */

const XP_TABLE = [100, 75, 50]; // by hintsUsed: 0, 1, 2+

const DEFAULT_ANSWERS = {
  1: { stages: [['vader'], ['7']], resultKey: '7' },
  2: { stages: [['синий', 'blue'], ['корусант', 'coruscant']], resultKey: 'CORUSCANT' },
  3: { stages: [['tatooine', 'татуин'], ['хатт', 'hutt'], ['th']], resultKey: 'TATOOINE' },
  4: { stages: [['r2d2-07']], resultKey: 'R2D2-07' },
  7: { stages: [['shadow'], ['shadow']], resultKey: 'SHADOW' },
  8: { stages: [['4729']], resultKey: '4729' },
  9: { stages: [['синий', 'blue'], ['кибер', 'кайбер', 'kyber']], resultKey: 'KYBER' },
  10: { stages: [['7ctrhxs4k']], resultKey: null },
  11: { stages: [['баланс', 'равновесие', 'balance']], resultKey: null }
};

const DEFAULT_ORDER = { 5: { correct: ['hoth', 'tatooine', 'naboo', 'coruscant'], resultKey: 'HTNC' } };

const DEFAULT_QR = {
  6: {
    correct: ['QR02', 'QR04', 'QR06'],
    trap: ['QR01', 'QR03', 'QR05'],
    symbols: ['X', 'Y', 'Z'],
    resultKey: 'XYZ'
  }
};

function normalize(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/-/g, '')
    .replace(/ё/g, 'е');
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST, OPTIONS'
    }
  });
}

const ERROR_MESSAGES = [
  'ОШИБКА ДОСТУПА.<br>R2-D2 сообщает: «Бип-бип...»<br>Попробуй ещё раз.',
  'ДОСТУП ОТКЛОНЁН.<br>Архив не распознаёт этот ответ.<br>Проверь ещё раз и попробуй снова.',
  'НЕВЕРНО.<br>Оби-Ван качает головой: «Не спеши, подумай ещё раз».'
];

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('', {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type',
        'access-control-allow-methods': 'POST, OPTIONS'
      }
    });
  }
  if (req.method !== 'POST') return json({ error: 'Метод не поддерживается' }, 405);

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return json({ correct: false, message: 'Некорректный запрос.' }, 400);
  }

  const configStore = getStore({ name: 'quest-config', consistency: 'strong' });
  const cfg = (await configStore.get('config', { type: 'json' })) || {};
  const overrides = cfg.missionOverrides || {};

  /* ---------- QR scan branch (mission 6) ---------- */
  if (body.qr) {
    const missionId = Number(body.missionId) || 6;
    const code = String(body.code || '').trim().toUpperCase();
    const qrCfg = (overrides[missionId] && overrides[missionId].qr) || DEFAULT_QR[missionId] || DEFAULT_QR[6];
    const resultKey = (overrides[missionId] && overrides[missionId].resultKey) || qrCfg.resultKey;

    if (!code) return json({ outcome: 'unknown', message: 'ЭТО НЕ ТА КООРДИНАТА.' });

    const isCorrect = qrCfg.correct.map(c => c.toUpperCase()).includes(code);
    const isTrap = qrCfg.trap.map(c => c.toUpperCase()).includes(code);

    if (isCorrect) {
      const idx = qrCfg.correct.map(c => c.toUpperCase()).indexOf(code);
      const symbol = qrCfg.symbols[idx] || '?';
      const needed = qrCfg.correct.length;
      // The client tracks which symbols it already has; we can't know that
      // here statelessly, so we just report this one and let the client
      // decide when it has collected `needed` distinct symbols.
      return json({ outcome: 'correct', xpDelta: 50, symbol, needed, done: false, resultKey });
    }
    if (isTrap) {
      return json({ outcome: 'trap', xpDelta: -50 });
    }
    return json({ outcome: 'unknown', message: 'ЭТО НЕ ТА КООРДИНАТА.' });
  }

  /* ---------- Standard stage branch ---------- */
  const missionId = Number(body.missionId);
  const stageIndex = Number(body.stageIndex) || 0;
  const answer = body.answer;
  const hintsUsed = Math.max(0, Math.min(2, Number(body.hintsUsed) || 0));

  if (!missionId) return json({ correct: false, message: 'Некорректный запрос.' }, 400);

  const override = overrides[missionId] || {};

  // Mission 5 (ordering) is graded as a single "stage" whose answer is the
  // full comma-joined sequence the player tapped out.
  if (missionId === 5) {
    const orderCfg = DEFAULT_ORDER[5];
    const correctSeq = (override.stageAnswers && override.stageAnswers[0] && override.stageAnswers[0][0])
      || orderCfg.correct.join(',');
    const resultKey = override.resultKey || orderCfg.resultKey;
    if (normalize(answer) === normalize(correctSeq)) {
      const xp = XP_TABLE[hintsUsed];
      return json({ correct: true, isLastStage: true, xpAwarded: xp, resultKey });
    }
    return json({ correct: false, message: ERROR_MESSAGES[missionId % ERROR_MESSAGES.length] });
  }

  const defaults = DEFAULT_ANSWERS[missionId];
  if (!defaults || !defaults.stages[stageIndex]) {
    return json({ correct: false, message: 'Этап не найден.' }, 400);
  }

  const overrideAnswers = override.stageAnswers && override.stageAnswers[stageIndex];
  const validAnswers = (overrideAnswers && overrideAnswers.length) ? overrideAnswers : defaults.stages[stageIndex];
  const isLastStage = stageIndex >= defaults.stages.length - 1;
  const resultKey = isLastStage ? (override.resultKey || defaults.resultKey) : undefined;

  const ok = validAnswers.some(a => normalize(a) === normalize(answer));
  if (ok) {
    const xp = XP_TABLE[hintsUsed];
    return json({ correct: true, isLastStage, xpAwarded: xp, resultKey });
  }
  return json({ correct: false, message: ERROR_MESSAGES[missionId % ERROR_MESSAGES.length] });
};
