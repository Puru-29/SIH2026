//! Keeps databases working when migration files change line endings.
//!
//! SQLx stores a SHA-384 checksum of each migration file and refuses to start
//! if a file no longer matches. On Windows, git may check the same file out
//! with CRLF or LF line endings (for example after `.gitattributes` changed),
//! which changes the checksum although the SQL is identical.
//!
//! Before migrations run, this updates a stored checksum only when the stored
//! value equals the checksum of the current file with its line endings swapped.
//! Any real change to a migration's content still fails as before.

use sha2::{Digest, Sha384};
use sqlx::{migrate::Migrator, SqlitePool};

/// The checksums of `sql` with LF and with CRLF line endings.
fn line_ending_variants(sql: &str) -> [Vec<u8>; 2] {
    let lf = sql.replace("\r\n", "\n");
    let crlf = lf.replace('\n', "\r\n");
    [
        Sha384::digest(lf.as_bytes()).to_vec(),
        Sha384::digest(crlf.as_bytes()).to_vec(),
    ]
}

/// True when `stored` differs from `current` only because of line endings.
pub fn same_except_line_endings(sql: &str, stored: &[u8], current: &[u8]) -> bool {
    stored != current
        && line_ending_variants(sql)
            .iter()
            .any(|v| v.as_slice() == stored)
}

/// Returns how many stored checksums were updated.
pub async fn align_line_endings(
    pool: &SqlitePool,
    migrator: &Migrator,
) -> Result<u64, sqlx::Error> {
    let has_table: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
    )
    .fetch_one(pool)
    .await?;
    if has_table == 0 {
        return Ok(0);
    }
    let stored: Vec<(i64, Vec<u8>)> =
        sqlx::query_as("SELECT version, checksum FROM _sqlx_migrations")
            .fetch_all(pool)
            .await?;
    let mut fixed = 0;
    for m in migrator.iter() {
        let Some((_, checksum)) = stored.iter().find(|(v, _)| *v == m.version) else {
            continue;
        };
        if same_except_line_endings(&m.sql, checksum, &m.checksum) {
            sqlx::query("UPDATE _sqlx_migrations SET checksum = ? WHERE version = ?")
                .bind(m.checksum.as_ref())
                .bind(m.version)
                .execute(pool)
                .await?;
            tracing::warn!(
                "Migration {} ({}) changed line endings only; stored checksum updated",
                m.version,
                m.description
            );
            fixed += 1;
        }
    }
    Ok(fixed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_endings_only_differences_are_recognised() {
        let lf = "CREATE TABLE a (id INTEGER);\nINSERT INTO a VALUES (1);\n";
        let crlf = lf.replace('\n', "\r\n");
        let lf_sum = Sha384::digest(lf.as_bytes()).to_vec();
        let crlf_sum = Sha384::digest(crlf.as_bytes()).to_vec();
        // File is LF now, the database applied it as CRLF (and the other way round).
        assert!(same_except_line_endings(lf, &crlf_sum, &lf_sum));
        assert!(same_except_line_endings(&crlf, &lf_sum, &crlf_sum));
        // Identical checksums need no change.
        assert!(!same_except_line_endings(lf, &lf_sum, &lf_sum));
        // A real content change is never accepted.
        let edited = Sha384::digest(b"CREATE TABLE a (id TEXT);\n").to_vec();
        assert!(!same_except_line_endings(lf, &edited, &lf_sum));
    }
}
