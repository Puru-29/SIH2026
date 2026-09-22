use async_trait::async_trait;
use axum::{extract::FromRequestParts, http::request::Parts};
use serde::{Deserialize, Serialize};

use crate::errors::AppError;

// Reads X-User-Id and trusts it. Good enough for the demo; replace with JWT later.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuthUser {
    pub user_id: i64,
}

// async_trait is still required here on axum 0.7 (E0195 without it).
#[async_trait]
impl<S> FromRequestParts<S> for AuthUser
where
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        match parts.headers.get("X-User-Id") {
            Some(value) => match value.to_str().ok().and_then(|s| s.parse::<i64>().ok()) {
                Some(id) => Ok(AuthUser { user_id: id }),
                None => Err(AppError::Unauthorized(
                    "X-User-Id header must be a valid integer".to_string(),
                )),
            },
            None => Err(AppError::Unauthorized(
                "Missing X-User-Id header. Include the authenticated user's ID in every request."
                    .to_string(),
            )),
        }
    }
}
