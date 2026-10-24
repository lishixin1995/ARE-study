import { useEffect } from "react";
import { createPortal } from "react-dom";

// Export study notes as a PDF through the browser's print window ("Save as
// PDF"). The notes are laid out as a plain document beside #root, and the app
// is hidden while printing, so the PDF has real, searchable text (Chinese
// included) instead of a screenshot.
//
// job: { title, heading, subtitle, items: [{ note, path }] }
//   title becomes the suggested file name; one item prints without a cover.

const IMAGE_WAIT_MS = 4000;

function isImage(item) {
  return item.kind === "image" || String(item.type || "").startsWith("image/");
}

function formatDay(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

// Characters a file name can't hold become dashes.
function fileTitle(value) {
  return String(value || "Study notes").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "Study notes";
}

// Screenshots must be decoded before the print window lays out the pages.
function imagesLoaded(root) {
  const pending = [...root.querySelectorAll("img")].filter(img => !img.complete);
  if (!pending.length) return Promise.resolve();
  const loads = pending.map(img => new Promise(resolve => {
    img.addEventListener("load", resolve, { once: true });
    img.addEventListener("error", resolve, { once: true });
  }));
  return Promise.race([Promise.all(loads), new Promise(resolve => window.setTimeout(resolve, IMAGE_WAIT_MS))]);
}

function PrintedNote({ note, path }) {
  const images = (note.attachments || []).filter(isImage);
  const files = (note.attachments || []).filter(item => !isImage(item));
  const summary = note.analysis?.summary || "";
  const bullets = note.analysis?.bulletPoints || [];
  return (
    <article className="print-note">
      <header className="print-note-head">
        {path ? <div className="print-path">{path}</div> : null}
        <h2>{note.title}</h2>
        {formatDay(note.savedAt) ? <small>Updated {formatDay(note.savedAt)}</small> : null}
      </header>
      {summary ? (
        <section className="print-block">
          <h3>Summary</h3>
          <p>{summary}</p>
        </section>
      ) : null}
      {bullets.length ? (
        <section className="print-block">
          <h3>Bullet points</h3>
          <ul>{bullets.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </section>
      ) : null}
      {note.rawNotes ? (
        <section className="print-block">
          {summary || bullets.length ? <h3>Raw notes</h3> : null}
          <div className="print-raw">{note.rawNotes}</div>
        </section>
      ) : null}
      {images.map(item => (
        <figure className="print-figure" key={item.id}>
          <img src={item.dataUrl} alt={item.name} />
          <figcaption>{item.name}</figcaption>
        </figure>
      ))}
      {files.length ? (
        <p className="print-files">Attached files, not included in this PDF: {files.map(item => item.name).join(", ")}</p>
      ) : null}
    </article>
  );
}

export default function NotePrint({ job, onDone }) {
  useEffect(() => {
    if (!job) return undefined;
    let cancelled = false;
    const appTitle = document.title;
    const finish = () => {
      document.body.classList.remove("is-printing-notes");
      document.title = appTitle;
      onDone();
    };
    (async () => {
      await imagesLoaded(document.querySelector(".print-sheet") || document.body);
      if (cancelled) return;
      document.body.classList.add("is-printing-notes");
      // Chrome and Safari suggest the page title as the PDF's file name.
      document.title = fileTitle(job.title);
      window.addEventListener("afterprint", finish, { once: true });
      window.print();
    })();
    return () => {
      cancelled = true;
      window.removeEventListener("afterprint", finish);
      document.body.classList.remove("is-printing-notes");
      document.title = appTitle;
    };
    // One print per job; onDone only clears it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  if (!job) return null;
  const single = job.items.length === 1;
  return createPortal(
    <div className="print-sheet" aria-hidden="true">
      {single ? null : (
        <header className="print-cover">
          <div className="print-path">ARE Study Vault</div>
          <h1>{job.heading}</h1>
          <p>{job.subtitle}</p>
        </header>
      )}
      {job.items.map(({ note, path }) => <PrintedNote key={note.id} note={note} path={path} />)}
    </div>,
    document.body
  );
}
