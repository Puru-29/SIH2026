//! Authentication: argon2 PIN hashing, random bearer-token sessions, and the
//! `AuthUser` extractor.
//!
//! The client sends `Authorization: Bearer <token>`. Only a SHA-256 hash of the
//! token is stored. The user's id, role and status always come from the
//! database, never from anything the client sends.

use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use async_trait::async_trait;
use axum::{
    extract::{FromRef, FromRequestParts},
    http::{header, request::Parts},
};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

use crate::errors::AppError;

/// Sessions last 30 days from sign-in.
pub const SESSION_DAYS: i64 = 30;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuthUser {
    pub user_id: i64,
    pub role: String,
    pub status: String,
    pub name: String,
}

/// Salted argon2id hash of a PIN (PHC string format).
pub fn hash_pin(pin: &str) -> String {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(pin.as_bytes(), &salt)
        .expect("argon2 hashing with default params cannot fail")
        .to_string()
}

fn legacy_sha256(pin: &str) -> String {
    format!("{:x}", Sha256::digest(pin.as_bytes()))
}

/// Checks a PIN against a stored hash. Returns `(matches, needs_rehash)`;
/// old unsalted SHA-256 hashes still verify but should be replaced.
pub fn verify_pin(pin: &str, stored: &str) -> (bool, bool) {
    if stored.starts_with("$argon2") {
        let ok = PasswordHash::new(stored)
            .map(|h| {
                Argon2::default()
                    .verify_password(pin.as_bytes(), &h)
                    .is_ok()
            })
            .unwrap_or(false);
        return (ok, false);
    }
    let is_legacy = stored.len() == 64 && stored.chars().all(|c| c.is_ascii_hexdigit());
    let ok = is_legacy && constant_time_eq(legacy_sha256(pin).as_bytes(), stored.as_bytes());
    (ok, ok)
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// A new random bearer token (256 bits, hex).
pub fn new_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn token_hash(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

/// Creates a session for `user_id` and returns the bearer token.
pub async fn create_session(pool: &SqlitePool, user_id: i64) -> Result<String, AppError> {
    let token = new_token();
    sqlx::query(
        "INSERT INTO sessions (user_id, token_hash, expires_at)
         VALUES (?, ?, datetime('now', ?))",
    )
    .bind(user_id)
    .bind(token_hash(&token))
    .bind(format!("+{SESSION_DAYS} days"))
    .execute(pool)
    .await?;
    // Housekeeping: drop this user's expired sessions.
    sqlx::query("DELETE FROM sessions WHERE user_id = ? AND expires_at <= datetime('now')")
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(token)
}

pub async fn delete_session(pool: &SqlitePool, token: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM sessions WHERE token_hash = ?")
        .bind(token_hash(token))
        .execute(pool)
        .await?;
    Ok(())
}

pub fn bearer_token(parts: &Parts) -> Option<String> {
    let value = parts.headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let token = value
        .strip_prefix("Bearer ")
        .or_else(|| value.strip_prefix("bearer "))?
        .trim();
    (!token.is_empty()).then(|| token.to_string())
}

#[async_trait]
impl<S> FromRequestParts<S> for AuthUser
where
    SqlitePool: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let token = bearer_token(parts)
            .ok_or_else(|| AppError::Unauthorized("Please sign in to continue.".to_string()))?;
        let pool = SqlitePool::from_ref(state);
        let row: Option<(i64, i64, String, String, String)> = sqlx::query_as(
            "SELECT s.id, u.id, u.role, u.status, u.name
             FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = ? AND s.expires_at > datetime('now')",
        )
        .bind(token_hash(&token))
        .fetch_optional(&pool)
        .await?;
        let (session_id, user_id, role, status, name) = row.ok_or_else(|| {
            AppError::Unauthorized("Your session has ended. Please sign in again.".to_string())
        })?;
        if status == "suspended" {
            return Err(AppError::Forbidden(
                "This account is suspended. Contact the AgriSense administrator.".to_string(),
            ));
        }
        // Record activity at most once an hour to avoid a write per request.
        sqlx::query(
            "UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP
             WHERE id = ? AND last_seen_at < datetime('now', '-1 hour')",
        )
        .bind(session_id)
        .execute(&pool)
        .await?;
        Ok(AuthUser {
            user_id,
            role,
            status,
            name,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argon2_round_trip() {
        let h = hash_pin("1234");
        assert!(h.starts_with("$argon2"));
        assert_eq!(verify_pin("1234", &h), (true, false));
        assert_eq!(verify_pin("9999", &h), (false, false));
        // Salted: the same PIN hashes differently each time.
        assert_ne!(h, hash_pin("1234"));
    }

    #[test]
    fn legacy_sha256_verifies_and_asks_for_rehash() {
        let legacy = legacy_sha256("4321");
        assert_eq!(verify_pin("4321", &legacy), (true, true));
        assert_eq!(verify_pin("0000", &legacy), (false, false));
        assert_eq!(verify_pin("4321", "not-a-hash"), (false, false));
    }

    #[test]
    fn tokens_are_random_and_hashed() {
        let a = new_token();
        assert_eq!(a.len(), 64);
        assert_ne!(a, new_token());
        assert_eq!(token_hash(&a).len(), 64);
        assert_ne!(token_hash(&a), a);
    }
}
