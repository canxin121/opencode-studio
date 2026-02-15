use std::path::Path;

use git2::{ErrorCode, Repository};

#[derive(Debug, Clone)]
pub enum Git2OpenError {
    NotARepository,
    Other(String),
}

impl Git2OpenError {
    pub fn code(&self) -> &'static str {
        match self {
            Git2OpenError::NotARepository => "not_git_repo",
            Git2OpenError::Other(_) => "git2_error",
        }
    }

    pub fn message(&self) -> String {
        match self {
            Git2OpenError::NotARepository => "Not a git repository".to_string(),
            Git2OpenError::Other(e) => e.clone(),
        }
    }
}

fn map_git2_error(e: git2::Error) -> Git2OpenError {
    if e.code() == ErrorCode::NotFound {
        return Git2OpenError::NotARepository;
    }
    Git2OpenError::Other(e.message().to_string())
}

pub fn open_repo_discover(dir: &Path) -> Result<Repository, Git2OpenError> {
    Repository::discover(dir).map_err(map_git2_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn open_repo_discover_not_repo() {
        let td = tempdir().unwrap();
        match open_repo_discover(td.path()) {
            Ok(_) => panic!("expected not a repository"),
            Err(err) => assert!(matches!(err, Git2OpenError::NotARepository)),
        }
    }
}
