import { randomUUID } from "node:crypto";
import type { SessionDetail, SessionInteraction, SessionSummary } from "@local-ai/shared";
import Database from "better-sqlite3";

export class HistoryStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initialize();
  }

  private initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        app_title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_interaction_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS interactions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        screenshot_path TEXT NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        window_title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_app_title ON sessions(app_title);
      CREATE INDEX IF NOT EXISTS idx_interactions_session_id ON interactions(session_id);
    `);
  }

  createSession(appTitle: string, createdAt: string): string {
    const id = randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, app_title, created_at, last_interaction_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(id, appTitle, createdAt, createdAt);
    return id;
  }

  ensureSession(sessionId: string | undefined, appTitle: string, createdAt: string): string {
    if (!sessionId) {
      return this.createSession(appTitle, createdAt);
    }

    const existing = this.db.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId) as { id: string } | undefined;
    if (existing) {
      return sessionId;
    }

    return this.createSession(appTitle, createdAt);
  }

  saveInteraction(record: Omit<SessionInteraction, "id">): string {
    const id = randomUUID();

    this.db.prepare(`
      INSERT INTO interactions (id, session_id, screenshot_path, question, answer, window_title, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      record.sessionId,
      record.screenshotPath,
      record.question,
      record.answer,
      record.windowTitle,
      record.createdAt,
    );

    this.db.prepare(`
      UPDATE sessions
      SET last_interaction_at = ?
      WHERE id = ?
    `).run(record.createdAt, record.sessionId);

    return id;
  }

  listSessions(appTitle?: string): SessionSummary[] {
    const query = appTitle
      ? "SELECT id, app_title, created_at, last_interaction_at FROM sessions WHERE app_title = ? ORDER BY last_interaction_at DESC"
      : "SELECT id, app_title, created_at, last_interaction_at FROM sessions ORDER BY last_interaction_at DESC";

    const rows = appTitle ? this.db.prepare(query).all(appTitle) : this.db.prepare(query).all();

    return (rows as any[]).map((row) => ({
      id: row.id,
      appTitle: row.app_title,
      createdAt: row.created_at,
      lastInteractionAt: row.last_interaction_at,
    }));
  }

  getSessionDetail(sessionId: string): SessionDetail | null {
    const sessionRow = this.db.prepare(
      "SELECT id, app_title, created_at, last_interaction_at FROM sessions WHERE id = ?",
    ).get(sessionId) as any;

    if (!sessionRow) {
      return null;
    }

    const interactionRows = this.db.prepare(`
      SELECT id, session_id, screenshot_path, question, answer, window_title, created_at
      FROM interactions
      WHERE session_id = ?
      ORDER BY created_at ASC
    `).all(sessionId) as any[];

    return {
      session: {
        id: sessionRow.id,
        appTitle: sessionRow.app_title,
        createdAt: sessionRow.created_at,
        lastInteractionAt: sessionRow.last_interaction_at,
      },
      interactions: interactionRows.map((row) => ({
        id: row.id,
        sessionId: row.session_id,
        screenshotPath: row.screenshot_path,
        question: row.question,
        answer: row.answer,
        windowTitle: row.window_title,
        createdAt: row.created_at,
      })),
    };
  }
}
