import { mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ChannelMode, DebateMessage, FeedbackValue, ReplyLanguage, Sensitivity } from './domain.js';

export interface GuildConfig {
  guildId: string;
  language: ReplyLanguage | null;
  sensitivity: Sensitivity;
  emergencyStopped: boolean;
  setupComplete: boolean;
}

export interface ChannelConfig {
  guildId: string;
  channelId: string;
  mode: ChannelMode;
}

export class Storage {
  private readonly db: DatabaseSync;

  constructor(
    private readonly databasePath: string,
    private readonly maxBytes: number,
  ) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  getGuildConfig(guildId: string): GuildConfig {
    const row = this.db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId) as
      | Record<string, unknown>
      | undefined;

    if (row) return this.mapGuildConfig(row);

    this.db
      .prepare(
        `INSERT INTO guild_config (guild_id, language, sensitivity, emergency_stopped, setup_complete)
         VALUES (?, NULL, 'active', 0, 0)`,
      )
      .run(guildId);

    return {
      guildId,
      language: null,
      sensitivity: 'active',
      emergencyStopped: false,
      setupComplete: false,
    };
  }

  updateGuildConfig(input: {
    guildId: string;
    language?: ReplyLanguage;
    sensitivity?: Sensitivity;
    emergencyStopped?: boolean;
  }): GuildConfig {
    const current = this.getGuildConfig(input.guildId);
    const language = input.language ?? current.language;
    const sensitivity = input.sensitivity ?? current.sensitivity;
    const emergencyStopped = input.emergencyStopped ?? current.emergencyStopped;
    const setupComplete = Boolean(language && this.listEnabledChannels(input.guildId).length > 0 && !emergencyStopped);

    this.db
      .prepare(
        `UPDATE guild_config
         SET language = ?, sensitivity = ?, emergency_stopped = ?, setup_complete = ?
         WHERE guild_id = ?`,
      )
      .run(language, sensitivity, emergencyStopped ? 1 : 0, setupComplete ? 1 : 0, input.guildId);

    return this.getGuildConfig(input.guildId);
  }

  setChannelMode(guildId: string, channelId: string, mode: ChannelMode): void {
    this.getGuildConfig(guildId);
    this.db
      .prepare(
        `INSERT INTO channel_config (guild_id, channel_id, mode)
         VALUES (?, ?, ?)
         ON CONFLICT(guild_id, channel_id) DO UPDATE SET mode = excluded.mode`,
      )
      .run(guildId, channelId, mode);
    this.refreshSetupComplete(guildId);
  }

  removeChannel(guildId: string, channelId: string): void {
    this.db.prepare('DELETE FROM channel_config WHERE guild_id = ? AND channel_id = ?').run(guildId, channelId);
    this.refreshSetupComplete(guildId);
  }

  getChannelConfig(guildId: string, channelId: string): ChannelConfig | null {
    const row = this.db.prepare('SELECT * FROM channel_config WHERE guild_id = ? AND channel_id = ?').get(guildId, channelId) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapChannelConfig(row) : null;
  }

  listEnabledChannels(guildId: string): ChannelConfig[] {
    const rows = this.db.prepare('SELECT * FROM channel_config WHERE guild_id = ? ORDER BY channel_id').all(guildId) as Record<
      string,
      unknown
    >[];
    return rows.map((row) => this.mapChannelConfig(row));
  }

  saveMessage(message: DebateMessage): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO raw_message (id, channel_id, author_id, content, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(message.id, message.channelId, message.authorId, message.content, message.createdAt.toISOString());
    this.pruneIfNeeded();
  }

  recentMessages(channelId: string, limit: number): DebateMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM raw_message WHERE channel_id = ? ORDER BY datetime(created_at) DESC LIMIT ?')
      .all(channelId, limit) as Record<string, unknown>[];
    return rows
      .reverse()
      .map((row) => ({
        id: String(row.id),
        channelId: String(row.channel_id),
        authorId: String(row.author_id),
        content: String(row.content),
        createdAt: new Date(String(row.created_at)),
      }));
  }

  getDiscussionSummary(channelId: string): string {
    const row = this.db.prepare('SELECT summary FROM discussion_state WHERE channel_id = ?').get(channelId) as
      | { summary: string }
      | undefined;
    return row?.summary ?? '';
  }

  saveDiscussionSummary(channelId: string, summary: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO discussion_state (channel_id, summary, started_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(channel_id) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at`,
      )
      .run(channelId, summary, now, now);
  }

  recordFallacyEvent(input: {
    messageId: string;
    channelId: string;
    label: string | null;
    confidence: number;
    quotedClaim: string | null;
    explanation: string;
    posted: boolean;
    reason: string;
  }): number {
    const result = this.db
      .prepare(
        `INSERT INTO fallacy_event
         (message_id, channel_id, label, confidence, quoted_claim, explanation, posted, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.messageId,
        input.channelId,
        input.label,
        input.confidence,
        input.quotedClaim,
        input.explanation,
        input.posted ? 1 : 0,
        input.reason,
        new Date().toISOString(),
      );
    return Number(result.lastInsertRowid);
  }

  recordFeedback(eventId: number, userId: string, value: FeedbackValue): void {
    this.db
      .prepare(
        `INSERT INTO feedback (event_id, user_id, value, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(event_id, user_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`,
      )
      .run(eventId, userId, value, new Date().toISOString());
  }

  hasExactPostedEvent(messageId: string, label: string, quotedClaim: string): boolean {
    const row = this.db
      .prepare(
        `SELECT id FROM fallacy_event
         WHERE message_id = ? AND label = ? AND quoted_claim = ? AND posted = 1
         LIMIT 1`,
      )
      .get(messageId, label, quotedClaim);
    return Boolean(row);
  }

  databaseSizeBytes(): number {
    try {
      return statSync(this.databasePath).size;
    } catch {
      return 0;
    }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS guild_config (
        guild_id TEXT PRIMARY KEY,
        language TEXT,
        sensitivity TEXT NOT NULL,
        emergency_stopped INTEGER NOT NULL,
        setup_complete INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS channel_config (
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        PRIMARY KEY (guild_id, channel_id)
      );

      CREATE TABLE IF NOT EXISTS raw_message (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS discussion_state (
        channel_id TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS fallacy_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        label TEXT,
        confidence REAL NOT NULL,
        quoted_claim TEXT,
        explanation TEXT NOT NULL,
        posted INTEGER NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS feedback (
        event_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (event_id, user_id)
      );
    `);
  }

  private refreshSetupComplete(guildId: string): void {
    const current = this.getGuildConfig(guildId);
    const setupComplete = Boolean(current.language && this.listEnabledChannels(guildId).length > 0 && !current.emergencyStopped);
    this.db.prepare('UPDATE guild_config SET setup_complete = ? WHERE guild_id = ?').run(setupComplete ? 1 : 0, guildId);
  }

  private pruneIfNeeded(): void {
    if (this.databaseSizeBytes() <= this.maxBytes) return;

    // Preserve derived events and feedback as long as possible. Raw text is the first data to prune.
    this.db.exec(`
      DELETE FROM raw_message
      WHERE id IN (
        SELECT id FROM raw_message
        ORDER BY datetime(created_at) ASC
        LIMIT 100
      );
      VACUUM;
    `);
  }

  private mapGuildConfig(row: Record<string, unknown>): GuildConfig {
    return {
      guildId: String(row.guild_id),
      language: row.language === null ? null : (String(row.language) as ReplyLanguage),
      sensitivity: String(row.sensitivity) as Sensitivity,
      emergencyStopped: Boolean(row.emergency_stopped),
      setupComplete: Boolean(row.setup_complete),
    };
  }

  private mapChannelConfig(row: Record<string, unknown>): ChannelConfig {
    return {
      guildId: String(row.guild_id),
      channelId: String(row.channel_id),
      mode: String(row.mode) as ChannelMode,
    };
  }
}
