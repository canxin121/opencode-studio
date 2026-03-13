#!/usr/bin/env python3
"""Regression guard for platform/arch -> target triple mapping.

This validates the mapping logic used by install/update flows across:
- scripts/install.sh
- scripts/install-service.sh
- scripts/install.ps1
- scripts/install-service.ps1
- scripts/test-unix-service-flow.sh
- scripts/test-windows-service-flow.ps1

The goal is to catch accidental drift in supported OS/arch combinations,
expected target triples, and unsupported-combo rejection behavior.
"""

from __future__ import annotations

import pathlib
import re
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]


def read_text(relpath: str) -> str:
    return (ROOT / relpath).read_text(encoding="utf-8")


def die(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    raise SystemExit(1)


def extract_bash_case_arms(source: str, *, func_name: str) -> dict[str, str]:
    # Capture: <func>() { case "${OS}/${ARCH}" in ... esac }
    m = re.search(
        rf"{re.escape(func_name)}\(\)\s*\{{\s*case\s+\"\$\{{OS\}}/\$\{{ARCH\}}\"\s+in(?P<body>.*?)\n\s*esac\s*\}}",
        source,
        flags=re.DOTALL,
    )
    if not m:
        die(f"Failed to find {func_name}() case table")

    body = m.group("body")
    arms: dict[str, str] = {}
    for arm in re.finditer(
        r"^\s*(?P<label>[^\n]+?)\)\s*\n(?P<arm_body>.*?)(?=^\s*;;\s*$)",
        body,
        flags=re.MULTILINE | re.DOTALL,
    ):
        label = arm.group("label").strip()
        arm_body = arm.group("arm_body")
        patterns = [p.strip() for p in label.split("|") if p.strip()]
        for pat in patterns:
            if pat in arms:
                die(f"Duplicate case pattern {pat} in {func_name}()")
            arms[pat] = arm_body
    if not arms:
        die(f"No case arms parsed for {func_name}()")
    return arms


def assert_contains(haystack: str, needle: str, *, context: str) -> None:
    if needle not in haystack:
        die(f"Missing {needle!r} in {context}")


def validate_unix_install_mapping(relpath: str) -> None:
    src = read_text(relpath)
    arms = extract_bash_case_arms(src, func_name="backend_target_candidates")

    expected = {
        "linux/x86_64": {"x86_64-unknown-linux-gnu", "x86_64-unknown-linux-musl"},
        "linux/aarch64": {"aarch64-unknown-linux-gnu", "aarch64-unknown-linux-musl"},
        "linux/arm64": {"aarch64-unknown-linux-gnu", "aarch64-unknown-linux-musl"},
        "linux/armv7l": {
            "armv7-unknown-linux-gnueabihf",
            "armv7-unknown-linux-musleabihf",
        },
        "linux/armv7": {
            "armv7-unknown-linux-gnueabihf",
            "armv7-unknown-linux-musleabihf",
        },
        "linux/i686": {"i686-unknown-linux-gnu", "i686-unknown-linux-musl"},
        "linux/i386": {"i686-unknown-linux-gnu", "i686-unknown-linux-musl"},
        "darwin/x86_64": {"x86_64-apple-darwin"},
        "darwin/arm64": {"aarch64-apple-darwin"},
        "darwin/aarch64": {"aarch64-apple-darwin"},
    }

    for pattern, targets in expected.items():
        if pattern not in arms:
            die(f"Missing case arm {pattern} in {relpath}")
        for target in sorted(targets):
            assert_contains(arms[pattern], target, context=f"{relpath}:{pattern}")

    # Unsupported combinations should exit non-zero.
    if "*" not in arms:
        die(f"Missing fallback (*) case arm in {relpath}")
    assert_contains(arms["*"], "exit 1", context=f"{relpath}:fallback")


def validate_windows_install_mapping(relpath: str) -> None:
    src = read_text(relpath)

    # Keep this intentionally simple: we want a stable regression guard, not a full PS parser.
    assert_contains(src, "function Get-TargetCandidates", context=relpath)
    assert_contains(
        src,
        '"Arm64" { return @("aarch64-pc-windows-msvc", "x86_64-pc-windows-msvc") }',
        context=relpath,
    )
    assert_contains(
        src,
        '"X64" { return @("x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc") }',
        context=relpath,
    )
    assert_contains(src, "Unsupported Windows architecture", context=relpath)


def validate_unix_service_flow_mapping(relpath: str) -> None:
    src = read_text(relpath)
    assert_contains(src, "detect_backend_target_triple()", context=relpath)

    expected = [
        "x86_64-unknown-linux-gnu",
        "aarch64-unknown-linux-gnu",
        "armv7-unknown-linux-gnueabihf",
        "i686-unknown-linux-gnu",
        "x86_64-apple-darwin",
        "aarch64-apple-darwin",
    ]
    for target in expected:
        assert_contains(src, target, context=relpath)


def validate_windows_service_flow_mapping(relpath: str) -> None:
    src = read_text(relpath)
    assert_contains(src, "function Get-BackendTargetTriple", context=relpath)
    assert_contains(src, "x86_64-pc-windows-msvc", context=relpath)
    assert_contains(src, "aarch64-pc-windows-msvc", context=relpath)
    assert_contains(src, "Unsupported Windows architecture", context=relpath)


def main() -> int:
    validate_unix_install_mapping("scripts/install.sh")
    validate_unix_install_mapping("scripts/install-service.sh")
    validate_windows_install_mapping("scripts/install.ps1")
    validate_windows_install_mapping("scripts/install-service.ps1")
    validate_unix_service_flow_mapping("scripts/test-unix-service-flow.sh")
    validate_windows_service_flow_mapping("scripts/test-windows-service-flow.ps1")

    print("OK: platform/arch mapping validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
