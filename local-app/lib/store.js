import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { DIVISION_CODES } from "../public/shared/are.js";

export const SCHEMA_VERSION = 1;
const DATA_FILE = "study.json";

export function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
}

export function localDateKey(value = new Date()) {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function defaultSettings() {
  return { newPerDay: 20, dailyGoalMinutes: 60, geminiApiKey: "", geminiModel: "gemini-2.5-flash" };
}

export function defaultDivision() {
  return { status: "not-started", examDate: "", passedDate: "", confidence: {} };
}

export function emptyData() {
  return {
    version: SCHEMA_VERSION,
    settings: defaultSettings(),
    divisions: Object.fromEntries(DIVISION_CODES.map(code => [code, defaultDivision()])),
    notes: [],
    cards: [],
    reviews: [],
    sessions: [],
    attachments: {},
    imports: {}
  };
}

// Fill in anything missing so older or hand-edited files still load.
export function normalizeData(raw) {
  const base = emptyData();
  const data = raw && typeof raw === "object" ? raw : {};
  const divisions = { ...base.divisions };
  for (const code of DIVISION_CODES) {
    divisions[code] = { ...defaultDivision(), ...(data.divisions?.[code] || {}) };
    if (!divisions[code].confidence || typeof divisions[code].confidence !== "object") divisions[code].confidence = {};
  }
  return {
    version: SCHEMA_VERSION,
    settings: { ...base.settings, ...(data.settings || {}) },
    divisions,
    notes: Array.isArray(data.notes) ? data.notes : [],
    cards: Array.isArray(data.cards) ? data.cards : [],
    reviews: Array.isArray(data.reviews) ? data.reviews : [],
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    attachments: data.attachments && typeof data.attachments === "object" ? data.attachments : {},
    imports: data.imports && typeof data.imports === "object" ? data.imports : {}
  };
}

function safeExtension(name = "") {
  const ext = path.extname(String(name)).slice(1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? `.${ext}` : "";
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function renameWithRetry(from, to) {
  // Windows can briefly lock a file (antivirus, indexer); retry a few times.
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fs.rename(from, to);
    } catch (error) {
      if (attempt >= 5 || !["EPERM", "EBUSY", "EACCES"].includes(error.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

export class Store {
  constructor(dir, options = {}) {
    this.dir = path.resolve(dir);
    this.file = path.join(this.dir, DATA_FILE);
    this.attachmentsDir = path.join(this.dir, "attachments");
    this.backupsDir = path.join(this.dir, "backups");
    this.keepBackups = options.keepBackups ?? 30;
    this.now = options.now || (() => new Date());
    this.data = emptyData();
    this.warnings = [];
    this.queue = Promise.resolve();
  }

  async open() {
    await fs.mkdir(this.attachmentsDir, { recursive: true });
    await fs.mkdir(this.backupsDir, { recursive: true });
    if (!(await exists(this.file))) {
      this.data = emptyData();
      await this.writeFile();
      return this;
    }
    try {
      this.data = normalizeData(JSON.parse(await fs.readFile(this.file, "utf8")));
    } catch (error) {
      await this.recoverFromCorruptFile(error);
    }
    return this;
  }

  async recoverFromCorruptFile(error) {
    const aside = path.join(this.dir, `study.corrupt-${Date.now()}.json`);
    await renameWithRetry(this.file, aside);
    const backups = await this.listBackups();
    for (const backup of backups) {
      try {
        this.data = normalizeData(JSON.parse(await fs.readFile(path.join(this.backupsDir, backup), "utf8")));
        this.warnings.push(`Your data file could not be read (${error.message}). It was moved to ${path.basename(aside)} and your backup ${backup} was restored.`);
        await this.writeFile();
        return;
      } catch {
        // Try the next older backup.
      }
    }
    this.data = emptyData();
    this.warnings.push(`Your data file could not be read (${error.message}) and no usable backup was found. It was moved to ${path.basename(aside)}; starting fresh.`);
    await this.writeFile();
  }

  async listBackups() {
    const names = await fs.readdir(this.backupsDir).catch(() => []);
    return names.filter(name => /^study-\d{4}-\d{2}-\d{2}.*\.json$/.test(name)).sort().reverse();
  }

  // Run a change against a copy of the data and persist it. Writes are
  // serialized, and a mutator that throws leaves the data untouched.
  update(mutator) {
    const task = this.queue.then(async () => {
      const draft = structuredClone(this.data);
      const result = await mutator(draft);
      this.data = draft;
      await this.writeFile();
      return result;
    });
    this.queue = task.catch(() => {});
    return task;
  }

  async backupNow(label = "") {
    const suffix = label ? `-${label}` : "";
    const name = `study-${localDateKey(this.now())}${suffix}.json`;
    await fs.writeFile(path.join(this.backupsDir, name), JSON.stringify(this.data, null, 2));
    await this.pruneBackups();
    return name;
  }

  async pruneBackups() {
    const backups = await this.listBackups();
    for (const name of backups.slice(this.keepBackups)) {
      await fs.rm(path.join(this.backupsDir, name), { force: true });
    }
  }

  async writeFile() {
    const dailyBackup = path.join(this.backupsDir, `study-${localDateKey(this.now())}.json`);
    if ((await exists(this.file)) && !(await exists(dailyBackup))) {
      await fs.copyFile(this.file, dailyBackup);
      await this.pruneBackups();
    }
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2));
    await renameWithRetry(tmp, this.file);
  }

  async saveAttachment({ name, type, buffer }) {
    const id = makeId("att");
    const cleanName = String(name || "attachment").replace(/[\\/\0]/g, "_").slice(0, 200) || "attachment";
    const file = `${id}${safeExtension(cleanName)}`;
    await fs.writeFile(path.join(this.attachmentsDir, file), buffer);
    const meta = {
      id,
      name: cleanName,
      type: String(type || "application/octet-stream").split(";")[0].trim().toLowerCase(),
      size: buffer.length,
      file,
      createdAt: this.now().toISOString()
    };
    await this.update(data => {
      data.attachments[id] = meta;
    });
    return meta;
  }

  attachmentPath(id) {
    const meta = this.data.attachments[id];
    if (!meta) return null;
    // meta.file is generated by saveAttachment; still refuse anything path-like.
    if (path.basename(meta.file) !== meta.file) return null;
    return path.join(this.attachmentsDir, meta.file);
  }

  // Delete attachments nothing points to any more (after edits and deletes).
  async removeOrphanAttachments() {
    const used = new Set();
    for (const item of [...this.data.notes, ...this.data.cards]) {
      for (const id of item.attachments || []) used.add(id);
    }
    const graceMs = 60 * 60 * 1000; // keep fresh uploads that aren't saved into a note yet
    const nowMs = this.now().getTime();
    const orphans = Object.values(this.data.attachments).filter(meta => !used.has(meta.id) && nowMs - Date.parse(meta.createdAt || 0) > graceMs);
    if (!orphans.length) return 0;
    await this.update(data => {
      for (const meta of orphans) delete data.attachments[meta.id];
    });
    for (const meta of orphans) {
      if (path.basename(meta.file) === meta.file) await fs.rm(path.join(this.attachmentsDir, meta.file), { force: true });
    }
    return orphans.length;
  }
}
