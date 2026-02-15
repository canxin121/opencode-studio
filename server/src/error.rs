use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use thiserror::Error;

pub type ApiResult<T> = Result<T, AppError>;

#[derive(Debug, Serialize)]
struct ErrorBody {
    error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    locked: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    restarting: Option<bool>,
}

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{message}")]
    BadRequest { message: String },

    #[error("{message}")]
    Forbidden { message: String },

    #[error("{message}")]
    NotFound { message: String },

    #[error("{message}")]
    PayloadTooLarge { message: String },

    #[error("{message}")]
    TooManyRequests { message: String },

    #[error("{message}")]
    BadGateway { message: String },

    #[error("{message}")]
    ServiceUnavailable { message: String, restarting: bool },

    #[error("{message}")]
    Internal { message: String },
}

impl AppError {
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::BadRequest {
            message: message.into(),
        }
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::Forbidden {
            message: message.into(),
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::NotFound {
            message: message.into(),
        }
    }

    pub fn payload_too_large(message: impl Into<String>) -> Self {
        Self::PayloadTooLarge {
            message: message.into(),
        }
    }

    pub fn too_many_requests(message: impl Into<String>) -> Self {
        Self::TooManyRequests {
            message: message.into(),
        }
    }

    pub fn bad_gateway(message: impl Into<String>) -> Self {
        Self::BadGateway {
            message: message.into(),
        }
    }

    pub fn service_unavailable(message: impl Into<String>) -> Self {
        Self::ServiceUnavailable {
            message: message.into(),
            restarting: false,
        }
    }

    pub fn service_restarting(message: impl Into<String>) -> Self {
        Self::ServiceUnavailable {
            message: message.into(),
            restarting: true,
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::Internal {
            message: message.into(),
        }
    }

    fn status_code(&self) -> StatusCode {
        match self {
            Self::BadRequest { .. } => StatusCode::BAD_REQUEST,
            Self::Forbidden { .. } => StatusCode::FORBIDDEN,
            Self::NotFound { .. } => StatusCode::NOT_FOUND,
            Self::PayloadTooLarge { .. } => StatusCode::PAYLOAD_TOO_LARGE,
            Self::TooManyRequests { .. } => StatusCode::TOO_MANY_REQUESTS,
            Self::BadGateway { .. } => StatusCode::BAD_GATEWAY,
            Self::ServiceUnavailable { .. } => StatusCode::SERVICE_UNAVAILABLE,
            Self::Internal { .. } => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn body(&self) -> ErrorBody {
        match self {
            Self::BadRequest { message }
            | Self::Forbidden { message }
            | Self::NotFound { message }
            | Self::PayloadTooLarge { message }
            | Self::TooManyRequests { message }
            | Self::BadGateway { message }
            | Self::Internal { message } => ErrorBody {
                error: message.clone(),
                locked: None,
                restarting: None,
            },
            Self::ServiceUnavailable {
                message,
                restarting,
            } => ErrorBody {
                error: message.clone(),
                locked: None,
                // Keep response shape stable: only include when true.
                restarting: if *restarting { Some(true) } else { None },
            },
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status_code();
        let body = self.body();
        (status, Json(body)).into_response()
    }
}
