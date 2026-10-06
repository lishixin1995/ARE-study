import { DIVISIONS, MISTAKE_REASONS, weightMid } from "../public/shared/are.js";
import { addDays, buildQueue, startOfDay } from "../public/shared/srs.js";
import { localDateKey } from "./store.js";

const MAX_REVIEW_MS = 5 * 60 * 1000; // ignore time when a card was left open

function lastDays(now, count) {
  const days = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) days.push(localDateKey(addDays(now, -offset)));
  return days;
}

function reviewMinutes(review) {
  return Math.min(MAX_REVIEW_MS, Math.max(0, Number(review.ms) || 0)) / 60000;
}

// Higher score = more exam weight, less confidence, more recent misses.
export function focusRanking(divisionCode, confidence = {}, recentMistakesByArea = {}) {
  const division = DIVISIONS.find(item => item.code === divisionCode);
  if (!division) return [];
  return division.areas
    .map(area => {
      const rating = Number(confidence[area.id]) || 0;
      const recentMistakes = recentMistakesByArea[area.id] || 0;
      const gap = rating ? (5 - rating) / 4 : 0.5;
      const pressure = Math.min(1, recentMistakes / 5);
      return {
        areaId: area.id,
        name: area.name,
        weight: weightMid(area),
        confidence: rating,
        recentMistakes,
        score: Math.round(weightMid(area) * (0.65 * gap + 0.35 * pressure) * 10) / 10
      };
    })
    .sort((a, b) => b.score - a.score);
}

function computeStreak(activeDays, now) {
  let cursor = startOfDay(now);
  if (!activeDays.has(localDateKey(cursor))) cursor = addDays(cursor, -1);
  let streak = 0;
  while (activeDays.has(localDateKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function computeStats(data, now = new Date()) {
  const days = lastDays(now, 30);
  const since30 = addDays(now, -29).getTime();
  const todayKey = localDateKey(now);
  const byDay = Object.fromEntries(days.map(day => [day, { date: day, reviews: 0, again: 0, minutes: 0 }]));
  const activeDays = new Set();
  const cardsById = new Map(data.cards.map(card => [card.id, card]));

  const perDivision = Object.fromEntries(DIVISIONS.map(({ code }) => [code, {
    flashcards: 0, mistakes: 0, needsAnswer: 0, notes: 0, reviews30: 0, again30: 0, minutes30: 0, due: 0, newToday: 0, newWaiting: 0
  }]));

  for (const review of data.reviews) {
    const at = new Date(review.at);
    const key = localDateKey(at);
    activeDays.add(key);
    if (at.getTime() < since30) continue;
    const minutes = reviewMinutes(review);
    if (byDay[key]) {
      byDay[key].reviews += 1;
      if (Number(review.rating) === 1) byDay[key].again += 1;
      byDay[key].minutes += minutes;
    }
    const division = review.division || cardsById.get(review.cardId)?.division;
    if (perDivision[division]) {
      perDivision[division].reviews30 += 1;
      if (Number(review.rating) === 1) perDivision[division].again30 += 1;
      perDivision[division].minutes30 += minutes;
    }
  }

  for (const session of data.sessions) {
    activeDays.add(session.date);
    const minutes = Number(session.minutes) || 0;
    if (byDay[session.date]) byDay[session.date].minutes += minutes;
    if (perDivision[session.division] && session.date >= days[0]) perDivision[session.division].minutes30 += minutes;
  }

  const reasons = {};
  const reasonsByDivision = {};
  const recentMistakesByArea = {};
  const recentCutoff = addDays(now, -30).getTime();
  for (const card of data.cards) {
    const stats = perDivision[card.division];
    if (card.kind === "mistake") {
      if (stats) stats.mistakes += 1;
      const answered = String(card.mistake?.correctAnswer || card.mistake?.explanation || "").trim();
      if (stats && !answered) stats.needsAnswer += 1;
      const reason = card.mistake?.reason || "";
      if (reason) {
        reasons[reason] = (reasons[reason] || 0) + 1;
        if (card.division) {
          reasonsByDivision[card.division] ||= {};
          reasonsByDivision[card.division][reason] = (reasonsByDivision[card.division][reason] || 0) + 1;
        }
      }
      if (card.area && Date.parse(card.createdAt) >= recentCutoff) {
        recentMistakesByArea[card.area] = (recentMistakesByArea[card.area] || 0) + 1;
      }
    } else if (stats) {
      stats.flashcards += 1;
    }
  }
  for (const note of data.notes) {
    if (perDivision[note.division]) perDivision[note.division].notes += 1;
  }

  const newPerDay = data.settings?.newPerDay ?? 20;
  for (const { code } of DIVISIONS) {
    const queue = buildQueue(data.cards, data.reviews, { now, division: code, newPerDay });
    perDivision[code].due = queue.counts.learning + queue.counts.review;
    perDivision[code].newToday = queue.counts.new;
    perDivision[code].newWaiting = queue.newWaiting;
  }
  const overall = buildQueue(data.cards, data.reviews, { now, newPerDay });

  const focus = {};
  for (const { code } of DIVISIONS) {
    focus[code] = focusRanking(code, data.divisions?.[code]?.confidence, recentMistakesByArea);
  }

  const daily = days.map(day => ({ ...byDay[day], minutes: Math.round(byDay[day].minutes) }));
  return {
    today: daily[daily.length - 1] || { date: todayKey, reviews: 0, again: 0, minutes: 0 },
    daily,
    streak: computeStreak(activeDays, now),
    queue: overall.counts,
    newWaiting: overall.newWaiting,
    perDivision: Object.fromEntries(Object.entries(perDivision).map(([code, stats]) => [code, {
      ...stats,
      minutes30: Math.round(stats.minutes30),
      retention30: stats.reviews30 ? Math.round(((stats.reviews30 - stats.again30) / stats.reviews30) * 100) : null
    }])),
    mistakeReasons: Object.fromEntries(MISTAKE_REASONS.map(([key]) => [key, reasons[key] || 0])),
    mistakeReasonsByDivision: reasonsByDivision,
    recentMistakesByArea,
    focus
  };
}
