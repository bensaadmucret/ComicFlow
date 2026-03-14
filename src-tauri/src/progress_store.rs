use std::path::Path;

use anyhow::{Context, Result};
use chrono::Utc;
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ProgressRecord {
    pub id: String,
    pub label: String,
    pub source: String,
    pub location: String,
    pub last_index: usize,
    pub total_pages: usize,
    pub cover_path: Option<String>,
    pub updated_at: i64,
}

pub struct ProgressStore {
    conn: Mutex<Connection>,
}

impl ProgressStore {
    pub fn new(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).with_context(|| "Impossible de créer le dossier progress store")?;
        }

        let conn = Connection::open(path).with_context(|| "Impossible d'ouvrir la base de progression")?;
        conn.execute(
            "CREATE TABLE IF NOT EXISTS progress (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                source TEXT NOT NULL,
                location TEXT NOT NULL,
                last_index INTEGER NOT NULL,
                total_pages INTEGER NOT NULL,
                cover_path TEXT,
                updated_at INTEGER NOT NULL
            )",
            [],
        )?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn save(&self, input: ProgressInput) -> Result<()> {
        let now = Utc::now().timestamp();
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO progress (id, label, source, location, last_index, total_pages, cover_path, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(id) DO UPDATE SET
                label = excluded.label,
                source = excluded.source,
                location = excluded.location,
                last_index = excluded.last_index,
                total_pages = excluded.total_pages,
                cover_path = excluded.cover_path,
                updated_at = excluded.updated_at",
            params![
                input.id,
                input.label,
                input.source,
                input.location,
                input.last_index as i64,
                input.total_pages as i64,
                input.cover_path,
                now,
            ],
        )?;
        Ok(())
    }

    pub fn get(&self, id: &str) -> Result<Option<ProgressRecord>> {
        let conn = self.conn.lock();
        let record = conn
            .query_row(
                "SELECT id, label, source, location, last_index, total_pages, cover_path, updated_at FROM progress WHERE id = ?1",
                [id],
                |row| {
                    Ok(ProgressRecord {
                        id: row.get(0)?,
                        label: row.get(1)?,
                        source: row.get(2)?,
                        location: row.get(3)?,
                        last_index: row.get::<_, i64>(4)? as usize,
                        total_pages: row.get::<_, i64>(5)? as usize,
                        cover_path: row.get(6)?,
                        updated_at: row.get(7)?,
                    })
                },
            )
            .optional()?;
        Ok(record)
    }

    pub fn list(&self) -> Result<Vec<ProgressRecord>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, label, source, location, last_index, total_pages, cover_path, updated_at
            FROM progress ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ProgressRecord {
                id: row.get(0)?,
                label: row.get(1)?,
                source: row.get(2)?,
                location: row.get(3)?,
                last_index: row.get::<_, i64>(4)? as usize,
                total_pages: row.get::<_, i64>(5)? as usize,
                cover_path: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?;

        let mut records = Vec::new();
        for row in rows {
            records.push(row?);
        }
        Ok(records)
    }

    pub fn clear(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM progress WHERE id = ?1", [id])?;
        Ok(())
    }
}

pub struct ProgressInput {
    pub id: String,
    pub label: String,
    pub source: String,
    pub location: String,
    pub last_index: usize,
    pub total_pages: usize,
    pub cover_path: Option<String>,
}
