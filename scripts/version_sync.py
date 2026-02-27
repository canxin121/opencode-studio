#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

SEMVER_PATTERN = (
    r"(0|[1-9][0-9]*)"
    r"\.(0|[1-9][0-9]*)"
    r"\.(0|[1-9][0-9]*)"
    r"(-[0-9A-Za-z.-]+)?"
    r"(\+[0-9A-Za-z.-]+)?"
)
SEMVER_RE = re.compile(rf"^{SEMVER_PATTERN}$")
TAG_RE = re.compile(rf"^v{SEMVER_PATTERN}$")

REPO_ROOT = Path(__file__).resolve().parents[1]

TOML_PACKAGE_VERSION_FILES = [
    Path("server/Cargo.toml"),
    Path("desktop/src-tauri/Cargo.toml"),
    Path("desktop/src-tauri-cef/Cargo.toml"),
]

JSON_VERSION_FILES = [
    Path("web/package.json"),
    Path("desktop/src-tauri/tauri.conf.json"),
    Path("desktop/src-tauri/tauri.conf.full.json"),
    Path("desktop/src-tauri-cef/tauri.conf.json"),
    Path("desktop/src-tauri-cef/tauri.conf.full.json"),
]

PACKAGE_LOCK_FILE = Path("web/package-lock.json")

LOCK_PACKAGE_VERSION_FILES = [
    (Path("Cargo.lock"), "opencode-studio"),
    (Path("desktop/src-tauri/Cargo.lock"), "opencode-studio-desktop"),
    (Path("desktop/src-tauri-cef/Cargo.lock"), "opencode-studio-desktop"),
]


class VersionSyncError(RuntimeError):
    pass


def repo_path(relative_path: Path) -> Path:
    return REPO_ROOT / relative_path


def normalize_version(raw: str) -> str:
    candidate = raw.strip()
    if candidate.startswith("v"):
        candidate = candidate[1:]
    if not SEMVER_RE.fullmatch(candidate):
        raise VersionSyncError(
            f"Invalid version '{raw}'. Expected semver like 0.1.0 or 0.1.0-beta.1"
        )
    return candidate


def read_file(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_file(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")


def split_line_ending(line: str) -> tuple[str, str]:
    if line.endswith("\r\n"):
        return line[:-2], "\r\n"
    if line.endswith("\n"):
        return line[:-1], "\n"
    if line.endswith("\r"):
        return line[:-1], "\r"
    return line, ""


def read_toml_package_version(path: Path) -> str:
    lines = read_file(path).splitlines()
    in_package = False

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            in_package = stripped == "[package]"
            continue
        if not in_package:
            continue
        match = re.match(r'^\s*version\s*=\s*"([^"]+)"', line)
        if match:
            return match.group(1)

    raise VersionSyncError(f"Cannot find [package] version in {path}")


def write_toml_package_version(path: Path, new_version: str) -> bool:
    lines = read_file(path).splitlines(keepends=True)
    in_package = False

    for idx, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            in_package = stripped == "[package]"
            continue
        if not in_package:
            continue

        line_body, line_ending = split_line_ending(line)
        match = re.match(r'^(\s*version\s*=\s*")([^"]+)(".*)$', line_body)
        if not match:
            continue

        if match.group(2) == new_version:
            return False

        lines[idx] = f"{match.group(1)}{new_version}{match.group(3)}{line_ending}"
        write_file(path, "".join(lines))
        return True

    raise VersionSyncError(f"Cannot update [package] version in {path}")


def read_json_version(path: Path) -> str:
    data = json.loads(read_file(path))
    version = str(data.get("version", "")).strip()
    if not version:
        raise VersionSyncError(f"Cannot find JSON version field in {path}")
    return version


def write_json_version(path: Path, new_version: str) -> bool:
    data = json.loads(read_file(path))
    if data.get("version") == new_version:
        return False

    data["version"] = new_version
    write_file(path, json.dumps(data, indent=2, ensure_ascii=True) + "\n")
    return True


def read_package_lock_version(path: Path) -> str:
    data = json.loads(read_file(path))
    top_level = str(data.get("version", "")).strip()
    root_package = str(data.get("packages", {}).get("", {}).get("version", "")).strip()

    if not top_level:
        raise VersionSyncError(f"Cannot find top-level version in {path}")
    if not root_package:
        raise VersionSyncError(f"Cannot find packages[''].version in {path}")
    if top_level != root_package:
        raise VersionSyncError(
            f"package-lock internal mismatch in {path}: top-level={top_level}, packages['']={root_package}"
        )

    return top_level


def write_package_lock_version(path: Path, new_version: str) -> bool:
    data = json.loads(read_file(path))
    changed = False

    if data.get("version") != new_version:
        data["version"] = new_version
        changed = True

    packages = data.get("packages")
    if (
        not isinstance(packages, dict)
        or "" not in packages
        or not isinstance(packages[""], dict)
    ):
        raise VersionSyncError(f"Cannot find packages[''] object in {path}")

    if packages[""].get("version") != new_version:
        packages[""]["version"] = new_version
        changed = True

    if changed:
        write_file(path, json.dumps(data, indent=2, ensure_ascii=True) + "\n")

    return changed


def read_lock_package_version(path: Path, package_name: str) -> str:
    lines = read_file(path).splitlines()
    idx = 0

    while idx < len(lines):
        if lines[idx].strip() != "[[package]]":
            idx += 1
            continue

        end = idx + 1
        matched_name: str | None = None
        matched_version: str | None = None
        has_source = False

        while end < len(lines) and lines[end].strip() != "[[package]]":
            stripped = lines[end].strip()
            name_match = re.match(r'^name\s*=\s*"([^"]+)"$', stripped)
            if name_match:
                matched_name = name_match.group(1)
            version_match = re.match(r'^version\s*=\s*"([^"]+)"$', stripped)
            if version_match:
                matched_version = version_match.group(1)
            if stripped.startswith("source = "):
                has_source = True
            end += 1

        if matched_name == package_name and not has_source:
            if matched_version is None:
                raise VersionSyncError(
                    f"Missing lockfile version for {package_name} in {path}"
                )
            return matched_version

        idx = end

    raise VersionSyncError(f"Cannot find lockfile package '{package_name}' in {path}")


def write_lock_package_version(path: Path, package_name: str, new_version: str) -> bool:
    lines = read_file(path).splitlines(keepends=True)
    idx = 0

    while idx < len(lines):
        if lines[idx].strip() != "[[package]]":
            idx += 1
            continue

        end = idx + 1
        matched_name: str | None = None
        version_idx: int | None = None
        has_source = False

        while end < len(lines) and lines[end].strip() != "[[package]]":
            stripped = lines[end].strip()
            name_match = re.match(r'^name\s*=\s*"([^"]+)"$', stripped)
            if name_match:
                matched_name = name_match.group(1)

            if re.match(r'^version\s*=\s*"[^"]+"$', stripped):
                version_idx = end

            if stripped.startswith("source = "):
                has_source = True

            end += 1

        if matched_name == package_name and not has_source:
            if version_idx is None:
                raise VersionSyncError(
                    f"Missing lockfile version for {package_name} in {path}"
                )

            version_line_body, version_line_ending = split_line_ending(
                lines[version_idx]
            )
            match = re.match(
                r'^(\s*version\s*=\s*")([^"]+)(".*)$',
                version_line_body,
            )
            if not match:
                raise VersionSyncError(
                    f"Unexpected lockfile version format at {path}:{version_idx + 1}"
                )

            if match.group(2) == new_version:
                return False

            lines[version_idx] = (
                f"{match.group(1)}{new_version}{match.group(3)}{version_line_ending}"
            )
            write_file(path, "".join(lines))
            return True

        idx = end

    raise VersionSyncError(f"Cannot update lockfile package '{package_name}' in {path}")


def collect_versions() -> dict[str, str]:
    versions: dict[str, str] = {}

    for rel_path in TOML_PACKAGE_VERSION_FILES:
        version = read_toml_package_version(repo_path(rel_path))
        versions[str(rel_path)] = version

    for rel_path in JSON_VERSION_FILES:
        version = read_json_version(repo_path(rel_path))
        versions[str(rel_path)] = version

    package_lock_version = read_package_lock_version(repo_path(PACKAGE_LOCK_FILE))
    versions[str(PACKAGE_LOCK_FILE)] = package_lock_version

    for rel_path, package_name in LOCK_PACKAGE_VERSION_FILES:
        version = read_lock_package_version(repo_path(rel_path), package_name)
        versions[str(rel_path)] = version

    for file_path, version in versions.items():
        if not SEMVER_RE.fullmatch(version):
            raise VersionSyncError(f"Invalid semver in {file_path}: '{version}'")

    return versions


def ensure_consistent(versions: dict[str, str]) -> str:
    grouped: dict[str, list[str]] = {}
    for file_path, version in versions.items():
        grouped.setdefault(version, []).append(file_path)

    if len(grouped) == 1:
        return next(iter(grouped))

    lines = ["Version mismatch detected across files:"]
    for version in sorted(grouped):
        lines.append(f"  {version}:")
        for file_path in sorted(grouped[version]):
            lines.append(f"    - {file_path}")
    raise VersionSyncError("\n".join(lines))


def run_check(expected_tag: str | None) -> str:
    versions = collect_versions()
    version = ensure_consistent(versions)

    if expected_tag is not None:
        tag = expected_tag.strip()
        if not TAG_RE.fullmatch(tag):
            raise VersionSyncError(
                f"Invalid tag '{tag}'. Expected format vMAJOR.MINOR.PATCH with optional prerelease/build"
            )
        expected = f"v{version}"
        if tag != expected:
            raise VersionSyncError(
                f"Tag/version mismatch: tag is '{tag}', but files are '{version}' (expected tag '{expected}')"
            )

    return version


def run_set(version_input: str, expected_tag: str | None) -> tuple[str, list[str]]:
    new_version = normalize_version(version_input)
    changed_files: list[str] = []

    for rel_path in TOML_PACKAGE_VERSION_FILES:
        if write_toml_package_version(repo_path(rel_path), new_version):
            changed_files.append(str(rel_path))

    for rel_path in JSON_VERSION_FILES:
        if write_json_version(repo_path(rel_path), new_version):
            changed_files.append(str(rel_path))

    if write_package_lock_version(repo_path(PACKAGE_LOCK_FILE), new_version):
        changed_files.append(str(PACKAGE_LOCK_FILE))

    for rel_path, package_name in LOCK_PACKAGE_VERSION_FILES:
        if write_lock_package_version(repo_path(rel_path), package_name, new_version):
            changed_files.append(str(rel_path))

    verified = run_check(expected_tag)
    return verified, changed_files


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Sync and validate project version across server/web/desktop manifests.",
    )
    subcommands = parser.add_subparsers(dest="command", required=True)

    check_parser = subcommands.add_parser("check", help="Check version consistency")
    check_parser.add_argument(
        "--tag",
        help="Expected git tag (example: v0.1.0)",
    )

    set_parser = subcommands.add_parser("set", help="Set all versions in one command")
    set_parser.add_argument("version", help="Semver value (example: 0.1.0 or v0.1.0)")
    set_parser.add_argument(
        "--tag",
        help="Optional expected git tag to validate after update (example: v0.1.0)",
    )

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        if args.command == "check":
            version = run_check(args.tag)
            print(f"Version check OK: {version}")
            if args.tag:
                print(f"Tag check OK: {args.tag}")
            return 0

        if args.command == "set":
            version, changed_files = run_set(args.version, args.tag)
            print(f"Version updated to: {version}")
            if changed_files:
                print("Updated files:")
                for file_path in changed_files:
                    print(f"  - {file_path}")
            else:
                print("No files changed.")
            if args.tag:
                print(f"Tag check OK: {args.tag}")
            return 0

        parser.print_help()
        return 2
    except VersionSyncError as err:
        print(f"Version sync failed: {err}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
