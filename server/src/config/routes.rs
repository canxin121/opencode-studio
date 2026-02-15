#![allow(unused_imports)]

mod json_io;
mod opencode;
mod settings;
mod utils;

pub use opencode::{
    OpencodeConfigPaths, OpencodeConfigQuery, OpencodeConfigResponse, config_opencode_get,
    config_opencode_put, config_reload_post,
};
pub use settings::{config_settings_get, config_settings_put};

// Internal helper for SSE snapshots / structured responses.
pub(crate) use settings::format_settings_response;
