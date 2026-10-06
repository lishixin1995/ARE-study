import { useEffect, useRef, useState } from "react";
import { missReasonLabel, nextDueLabel } from "../lib/wrongReview.js";

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function attachmentKind(item) {
  if (item.kind === "pdf" || item.type === "application/pdf") return "pdf";
  if (item.kind === "docx" || item.type === DOCX_TYPE) return "docx";
  return "image";
}

function openAttachment(item) {
  if (item?.dataUrl) window.open(item.dataUrl, "_blank", "noopener,noreferrer");
}

// Review session: try the question, reveal, then mark Got it / Missed it.
// Missed questions go to the back of the queue so they come up again before
// the session ends.
export default function WrongReview({ cards, scopeLabel, practice = false, onResult, onEdit, onClose }) {
  const [queue, setQueue] = useState(() => cards.map(card => card.id));
  const [byId, setById] = useState(() => new Map(cards.map(card => [card.id, card])));
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  // Blocks a second answer to the same question (fast double press): set when
  // an answer starts, cleared once the next question is on screen.
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState({ got: 0, missed: new Set() });
  const total = cards.length;
  const current = queue.length ? byId.get(queue[0]) : null;
  const done = total - new Set(queue).size;
  const panelRef = useRef(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    busyRef.current = false;
  }, [queue, revealed]);

  async function answer(result) {
    if (!current || busyRef.current || !revealed) return;
    busyRef.current = true;
    try {
      setBusy(true);
      setError("");
      const updated = (await onResult(current, result)) || current;
      setById(prev => new Map(prev).set(updated.id, { ...current, ...updated }));
      if (result === "got") {
        setStats(prev => ({ ...prev, got: prev.got + 1 }));
        setQueue(prev => prev.slice(1));
      } else {
        setStats(prev => ({ ...prev, missed: new Set(prev.missed).add(current.id) }));
        setQueue(prev => [...prev.slice(1), prev[0]]);
      }
      setRevealed(false);
    } catch (reason) {
      busyRef.current = false;
      setError(`Couldn't save that result: ${reason.message}`);
    } finally {
      setBusy(false);
    }
  }

  function handleKey(event) {
    if (event.key === "Escape") return onClose();
    // A held-down key repeats; only the first press counts.
    if (event.repeat) return;
    if (event.target.closest?.("input, textarea, select")) return;
    const onButton = Boolean(event.target.closest?.("button, a"));
    if (!revealed && !onButton && (event.key === " " || event.key === "Enter")) {
      event.preventDefault();
      setRevealed(true);
    } else if (revealed && (event.key === "1" || event.key === "ArrowLeft")) answer("missed");
    else if (revealed && (event.key === "2" || event.key === "ArrowRight")) answer("got");
  }
  const keyRef = useRef(handleKey);
  keyRef.current = handleKey;

  useEffect(() => {
    const listener = event => keyRef.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const attachments = current?.attachments || [];
  const images = attachments.filter(item => attachmentKind(item) === "image");
  const files = attachments.filter(item => attachmentKind(item) !== "image");
  const path = current ? [current.division, current.roomName, current.subroomName].filter(Boolean).join(" / ") : "";

  return (
    <div className="modal-backdrop review-backdrop" onClick={onClose}>
      <section className="review-panel" ref={panelRef} tabIndex={-1} onClick={event => event.stopPropagation()} aria-label="Wrong question review">
        <header className="review-head">
          <div>
            <div className="eyebrow">{practice ? "Practice round" : "Review session"} · {scopeLabel}</div>
            <div className="review-progress" aria-label={`${done} of ${total} done`}>
              <span style={{ width: `${total ? (done / total) * 100 : 100}%` }} />
            </div>
          </div>
          <div className="review-count">{Math.min(done + 1, total)} / {total}</div>
          <button type="button" onClick={onClose}>End session</button>
        </header>

        {current ? (
          <div className="review-body">
            <div className="review-question">
              <small>{path || "Unassigned"}</small>
              <h2>{current.title}</h2>
              {current.text && current.text !== current.title ? <div className="raw-note-text">{current.text}</div> : null}
              {images.length ? <div className="review-images">{images.map(item => <img key={item.id} src={item.dataUrl} alt={item.name} />)}</div> : null}
              {files.length ? <div className="review-files">{files.map(item => <button type="button" key={item.id} onClick={() => openAttachment(item)}>Open {attachmentKind(item).toUpperCase()} · {item.name}</button>)}</div> : null}
            </div>

            {revealed ? (
              <div className="review-answer">
                <section>
                  <div className="eyebrow">Correct answer</div>
                  {current.answer ? <p className="answer-text">{current.answer}</p> : <p className="muted-text">No answer saved yet. Add it so this card can check you next time.</p>}
                </section>
                {current.explanation ? (
                  <section>
                    <div className="eyebrow">Rule to remember</div>
                    <p>{current.explanation}</p>
                  </section>
                ) : null}
                {current.missReason ? <span className="reason-chip">Missed before: {missReasonLabel(current.missReason)}</span> : null}
                {!current.answer ? <button type="button" className="mini-action" onClick={() => onEdit(current)}>Add the answer</button> : null}
              </div>
            ) : null}

            {error ? <p className="status-banner">{error}</p> : null}

            <footer className="review-actions">
              {revealed ? (
                <>
                  <button type="button" className="review-missed" disabled={busy} onClick={() => answer("missed")}>Missed it <kbd>1</kbd></button>
                  <button type="button" className="review-got" disabled={busy} onClick={() => answer("got")}>Got it <kbd>2</kbd></button>
                </>
              ) : (
                <button type="button" className="primary review-reveal" onClick={() => setRevealed(true)}>Reveal answer <kbd>Space</kbd></button>
              )}
            </footer>
          </div>
        ) : (
          <div className="review-done">
            <div className="eyebrow">Session complete</div>
            <h2>{stats.got} answered · {stats.missed.size} needed another try</h2>
            <p>{stats.missed.size ? "Questions you missed come back tomorrow after the first retry." : "Nice work. Each question now waits longer before it comes back."}</p>
            <ul className="review-summary">
              {cards.map(card => {
                const latest = byId.get(card.id) || card;
                return <li key={card.id}><span>{latest.title}</span><small>{nextDueLabel(latest.reviewState)}</small></li>;
              })}
            </ul>
            <button type="button" className="primary" onClick={onClose}>Close</button>
          </div>
        )}
      </section>
    </div>
  );
}
