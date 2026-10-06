// Spaced repetition: an SM-2 style scheduler (the family Anki uses), plus the
// review queue. Pure functions so the browser can preview intervals and the
// server can schedule with the same rules.
//
// Ratings: 1 = Again (forgot), 2 = Hard, 3 = Good, 4 = Easy.

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export const CONFIG = {
  learningSteps: [1, 10], // minutes
  relearnSteps: [10], // minutes
  graduatingInterval: 1, // days
  easyInterval: 4, // days
  startEase: 2.5,
  minEase: 1.3,
  maxInterval: 365,
  hardFactor: 1.2,
  easyBonus: 1.3,
  lapseFactor: 0.5,
  learnAheadMinutes: 20
};

export const RATINGS = [
  [1, "Again"],
  [2, "Hard"],
  [3, "Good"],
  [4, "Easy"]
];

export function newSrs() {
  return { state: "new", due: null, interval: 0, ease: CONFIG.startEase, step: 0, reps: 0, lapses: 0, lastReview: null };
}

export function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

// Calendar-day arithmetic in local time, so DST changes don't shift due dates.
export function addDays(value, days) {
  const date = startOfDay(value);
  date.setDate(date.getDate() + days);
  return date;
}

export function parseLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function minutesFrom(now, minutes) {
  return new Date(now.getTime() + Math.round(minutes * MINUTE));
}

function clampInterval(days) {
  return Math.min(CONFIG.maxInterval, Math.max(1, Math.round(days)));
}

// Never schedule a card past the day before its division's exam.
function capToExam(due, now, examDate) {
  const exam = parseLocalDate(examDate);
  if (!exam) return due;
  const cap = addDays(exam, -1);
  if (cap <= startOfDay(now)) return due;
  return due > cap ? cap : due;
}

function graduate(next, interval, now, options) {
  next.state = "review";
  next.step = 0;
  next.interval = clampInterval(interval);
  next.due = capToExam(addDays(now, next.interval), now, options.examDate).toISOString();
  return next;
}

export function schedule(srs, rating, now = new Date(), options = {}) {
  const prev = { ...newSrs(), ...(srs || {}) };
  const next = { ...prev, reps: prev.reps + 1, lastReview: now.toISOString() };
  const r = Number(rating);
  if (![1, 2, 3, 4].includes(r)) throw new Error("Rating must be 1-4.");

  if (prev.state === "new" || prev.state === "learning") {
    const steps = CONFIG.learningSteps;
    const step = prev.state === "new" ? 0 : Math.min(prev.step, steps.length - 1);
    next.state = "learning";
    if (r === 1) {
      next.step = 0;
      next.due = minutesFrom(now, steps[0]).toISOString();
    } else if (r === 2) {
      next.step = step;
      const delay = step === 0 && steps.length > 1 ? (steps[0] + steps[1]) / 2 : steps[step];
      next.due = minutesFrom(now, delay).toISOString();
    } else if (r === 3) {
      if (step + 1 >= steps.length) return graduate(next, CONFIG.graduatingInterval, now, options);
      next.step = step + 1;
      next.due = minutesFrom(now, steps[step + 1]).toISOString();
    } else {
      return graduate(next, CONFIG.easyInterval, now, options);
    }
    return next;
  }

  if (prev.state === "relearning") {
    const steps = CONFIG.relearnSteps;
    const step = Math.min(prev.step, steps.length - 1);
    if (r === 1) {
      next.step = 0;
      next.due = minutesFrom(now, steps[0]).toISOString();
    } else if (r === 2) {
      next.step = step;
      next.due = minutesFrom(now, steps[step]).toISOString();
    } else if (r === 3) {
      if (step + 1 >= steps.length) return graduate(next, prev.interval, now, options);
      next.step = step + 1;
      next.due = minutesFrom(now, steps[step + 1]).toISOString();
    } else {
      return graduate(next, prev.interval + 1, now, options);
    }
    return next;
  }

  // Review state.
  const interval = Math.max(1, prev.interval);
  if (r === 1) {
    next.state = "relearning";
    next.step = 0;
    next.lapses = prev.lapses + 1;
    next.ease = Math.max(CONFIG.minEase, prev.ease - 0.2);
    next.interval = clampInterval(interval * CONFIG.lapseFactor);
    next.due = minutesFrom(now, CONFIG.relearnSteps[0]).toISOString();
    return next;
  }
  if (r === 2) {
    next.ease = Math.max(CONFIG.minEase, prev.ease - 0.15);
    return graduate(next, Math.max(interval + 1, interval * CONFIG.hardFactor), now, options);
  }
  if (r === 3) return graduate(next, Math.max(interval + 1, interval * prev.ease), now, options);
  next.ease = prev.ease + 0.15;
  return graduate(next, Math.max(interval + 1, interval * prev.ease * CONFIG.easyBonus), now, options);
}

export function formatDelay(ms) {
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(ms / DAY);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

// Labels for the rating buttons, e.g. { 1: "1m", 2: "6m", 3: "10m", 4: "4d" }.
export function previewIntervals(srs, now = new Date(), options = {}) {
  const labels = {};
  for (const [rating] of RATINGS) {
    const next = schedule(srs, rating, now, options);
    labels[rating] = formatDelay(new Date(next.due).getTime() - now.getTime());
  }
  return labels;
}

function hasText(value) {
  return Boolean(String(value || "").trim());
}

// A card needs something to ask and something to check against.
export function isReviewable(card) {
  if (!card || card.suspended) return false;
  const hasAttachments = Array.isArray(card.attachments) && card.attachments.length > 0;
  if (card.kind === "mistake") {
    const m = card.mistake || {};
    return (hasText(m.question) || hasAttachments) && (hasText(m.correctAnswer) || hasText(m.explanation));
  }
  return (hasText(card.front) || hasAttachments) && hasText(card.back);
}

function matchesFilter(card, filter = {}) {
  if (filter.division && card.division !== filter.division) return false;
  if (filter.area && card.area !== filter.area) return false;
  if (filter.kind && card.kind !== filter.kind) return false;
  return true;
}

export function newIntroducedToday(reviews = [], now = new Date()) {
  const todayStart = startOfDay(now).getTime();
  const ids = new Set();
  for (const review of reviews) {
    if (review.wasNew && !review.practice && Date.parse(review.at) >= todayStart) ids.add(review.cardId);
  }
  return ids.size;
}

// Cards to study now: learning steps first, then due reviews with new cards
// mixed in, capped at the daily new-card limit.
export function buildQueue(cards = [], reviews = [], options = {}) {
  const now = options.now || new Date();
  const newPerDay = Number.isFinite(Number(options.newPerDay)) ? Number(options.newPerDay) : 20;
  const learnAhead = now.getTime() + CONFIG.learnAheadMinutes * MINUTE;
  const nowMs = now.getTime();
  const learning = [];
  const due = [];
  const fresh = [];

  for (const card of cards) {
    if (!isReviewable(card) || !matchesFilter(card, options)) continue;
    const srs = card.srs || newSrs();
    const dueMs = srs.due ? Date.parse(srs.due) : 0;
    if (srs.state === "new") fresh.push(card);
    else if (srs.state === "learning" || srs.state === "relearning") {
      if (dueMs <= learnAhead) learning.push(card);
    } else if (dueMs <= nowMs) due.push(card);
  }

  const byDue = (a, b) => Date.parse(a.srs.due) - Date.parse(b.srs.due);
  learning.sort(byDue);
  due.sort(byDue);
  fresh.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  const budget = Math.max(0, newPerDay - newIntroducedToday(reviews, now));
  const newCards = fresh.slice(0, budget);

  const mixed = [];
  const gap = newCards.length ? Math.max(1, Math.floor(due.length / newCards.length)) : 0;
  let newIndex = 0;
  due.forEach((card, index) => {
    mixed.push(card);
    if (gap && (index + 1) % gap === 0 && newIndex < newCards.length) mixed.push(newCards[newIndex++]);
  });
  while (newIndex < newCards.length) mixed.push(newCards[newIndex++]);

  return {
    ids: [...learning, ...mixed].map(card => card.id),
    counts: { learning: learning.length, review: due.length, new: newCards.length },
    newWaiting: fresh.length - newCards.length
  };
}

// Practice mode ignores the schedule: weakest cards first, then shuffled.
export function buildPracticeQueue(cards = [], options = {}) {
  const random = options.random || Math.random;
  const limit = Number(options.limit) || 25;
  const pool = cards.filter(card => isReviewable(card) && matchesFilter(card, options));
  const scored = pool.map(card => {
    const srs = card.srs || newSrs();
    const weakness = srs.lapses * 2 + (CONFIG.startEase - srs.ease) * 4 + (card.kind === "mistake" ? 1 : 0);
    return { card, score: weakness + random() };
  });
  scored.sort((a, b) => b.score - a.score);
  return { ids: scored.slice(0, limit).map(item => item.card.id), total: pool.length };
}
