// Spaced review for wrong questions (Leitner boxes). Shared by the browser and
// api/wrong-questions.js so both agree on what "due" and "mastered" mean.
//
// "Got it" moves a question up one box and waits longer before asking again;
// "Missed it" sends it back to box 0 so it comes back in the next review.

const DAY = 24 * 60 * 60 * 1000;

export const REVIEW_INTERVAL_DAYS = [0, 1, 3, 7, 14, 30];
export const MASTERED_BOX = 4;

export const MISS_REASONS = [
  ["concept", "Didn't know the concept"],
  ["misread", "Misread the question"],
  ["distractor", "Fell for a distractor"],
  ["calculation", "Calculation error"],
  ["changed", "Changed a right answer"],
  ["time", "Rushed / ran out of time"],
  ["guessed", "Guessed"]
];

export function missReasonLabel(value) {
  return MISS_REASONS.find(([key]) => key === value)?.[1] || "";
}

export function normalizeReviewState(value) {
  const state = value && typeof value === "object" ? value : {};
  const box = Number.isInteger(state.box) ? Math.min(Math.max(state.box, 0), REVIEW_INTERVAL_DAYS.length - 1) : 0;
  return {
    box,
    due: typeof state.due === "string" ? state.due : "",
    reviews: Number(state.reviews) || 0,
    correct: Number(state.correct) || 0,
    lastResult: state.lastResult === "got" || state.lastResult === "missed" ? state.lastResult : "",
    lastReviewedAt: typeof state.lastReviewedAt === "string" ? state.lastReviewedAt : ""
  };
}

export function nextReviewState(value, result, now = new Date()) {
  if (result !== "got" && result !== "missed") throw new Error('Result must be "got" or "missed".');
  const state = normalizeReviewState(value);
  const got = result === "got";
  const box = got ? Math.min(state.box + 1, REVIEW_INTERVAL_DAYS.length - 1) : 0;
  return {
    box,
    due: new Date(now.getTime() + (got ? REVIEW_INTERVAL_DAYS[box] : 0) * DAY).toISOString(),
    reviews: state.reviews + 1,
    correct: state.correct + (got ? 1 : 0),
    lastResult: result,
    lastReviewedAt: now.toISOString()
  };
}

export function isDue(value, now = new Date()) {
  const state = normalizeReviewState(value);
  return !state.due || Date.parse(state.due) <= now.getTime();
}

// "new" | "due" | "learning" | "mastered"
export function reviewStatus(value, now = new Date()) {
  const state = normalizeReviewState(value);
  if (!state.reviews) return "new";
  if (isDue(state, now)) return "due";
  return state.box >= MASTERED_BOX ? "mastered" : "learning";
}

export function nextDueLabel(value, now = new Date()) {
  const state = normalizeReviewState(value);
  if (isDue(state, now)) return state.reviews ? "Due now" : "Not reviewed yet";
  const days = Math.ceil((Date.parse(state.due) - now.getTime()) / DAY);
  return days <= 1 ? "Next review tomorrow" : `Next review in ${days} days`;
}

// Missed and lower-box questions first, then the longest-waiting.
export function sortForReview(cards = []) {
  return [...cards].sort((a, b) => {
    const left = normalizeReviewState(a.reviewState);
    const right = normalizeReviewState(b.reviewState);
    if (left.box !== right.box) return left.box - right.box;
    return (Date.parse(left.due) || 0) - (Date.parse(right.due) || 0);
  });
}
