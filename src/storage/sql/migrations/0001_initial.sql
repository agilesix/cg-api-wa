-- Initial schema for the SQL tier of the WA CommonGrants API.
--
-- Works on both Cloudflare D1 (SQLite) and any other SQLite engine. For
-- Postgres, replace FTS5 with tsvector/tsquery — see PORTING.md.
--
-- Conventions:
--   - `id` is the CommonGrants UUID v5 derived from the source identifier.
--   - `source_id` is the raw WA PortalID; UNIQUE so the ETL can use it as the
--     upsert lookup key.
--   - Financial amounts stored as integer cents to avoid float drift.
--   - `raw_json` holds the fully-serialized CommonGrants Opportunity so the
--     service layer doesn't need to reconstruct it from the columns.
--   - FTS5 lives in a virtual table and is kept in sync via triggers below.

CREATE TABLE opportunities (
  id                            TEXT PRIMARY KEY,
  source_id                     TEXT UNIQUE NOT NULL,
  title                         TEXT NOT NULL,
  status                        TEXT NOT NULL,
  close_date                    TEXT,
  post_date                     TEXT,
  min_award_amount_cents        INTEGER,
  max_award_amount_cents        INTEGER,
  total_amount_available_cents  INTEGER,
  search_text                   TEXT NOT NULL DEFAULT '',
  content_hash                  TEXT NOT NULL,
  last_modified_at              TEXT NOT NULL,
  raw_json                      TEXT NOT NULL,
  created_at                    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_opportunities_source_id ON opportunities(source_id);
CREATE INDEX idx_opportunities_status ON opportunities(status);
CREATE INDEX idx_opportunities_close_date ON opportunities(close_date);

CREATE TABLE sync_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at        TEXT NOT NULL,
  completed_at      TEXT,
  records_fetched   INTEGER,
  records_inserted  INTEGER,
  records_updated   INTEGER,
  records_skipped   INTEGER,
  error_message     TEXT
);

-- Single-row table holding the incremental-sync high-watermark: the maximum
-- source `LastUpdated` value ingested so far. The ETL passes it to the source
-- client so a steady-state sync fetches only the changed delta instead of
-- re-streaming the whole dataset. The CHECK pins it to exactly one row.
CREATE TABLE sync_state (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  watermark   TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO sync_state (id, watermark) VALUES (1, NULL);

-- External-content FTS5 table over `opportunities`. Storage overhead is
-- kept down; search queries JOIN the FTS matches back to the main table.
CREATE VIRTUAL TABLE opportunities_fts USING fts5(
  title,
  search_text,
  content='opportunities',
  content_rowid='rowid'
);

-- Triggers keep the FTS index in lockstep with the content table.
CREATE TRIGGER opportunities_fts_insert AFTER INSERT ON opportunities BEGIN
  INSERT INTO opportunities_fts(rowid, title, search_text)
    VALUES (new.rowid, new.title, new.search_text);
END;

CREATE TRIGGER opportunities_fts_delete AFTER DELETE ON opportunities BEGIN
  INSERT INTO opportunities_fts(opportunities_fts, rowid, title, search_text)
    VALUES ('delete', old.rowid, old.title, old.search_text);
END;

CREATE TRIGGER opportunities_fts_update AFTER UPDATE ON opportunities BEGIN
  INSERT INTO opportunities_fts(opportunities_fts, rowid, title, search_text)
    VALUES ('delete', old.rowid, old.title, old.search_text);
  INSERT INTO opportunities_fts(rowid, title, search_text)
    VALUES (new.rowid, new.title, new.search_text);
END;
