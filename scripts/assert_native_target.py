#!/usr/bin/env python3
import argparse
import platform
import sys


ARCH_MAP = {
    "x86_64": "x86_64",
    "amd64": "x86_64",
    "aarch64": "aarch64",
    "arm64": "aarch64",
    "armv7l": "armv7",
    "armv7": "armv7",
}

OS_MAP = {
    "linux": "linux",
    "darwin": "darwin",
    "windows": "windows",
}


def target_os(target: str) -> str:
    if "windows" in target:
        return "windows"
    if "apple-darwin" in target:
        return "darwin"
    if "linux" in target:
        return "linux"
    return "unknown"


def target_arch(target: str) -> str:
    return ARCH_MAP.get(target.split("-")[0], target.split("-")[0])


def host_os() -> str:
    return OS_MAP.get(platform.system().lower(), platform.system().lower())


def host_arch() -> str:
    machine = platform.machine().lower()
    return ARCH_MAP.get(machine, machine)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Assert that target triple matches native runner OS/arch"
    )
    parser.add_argument(
        "target", help="Rust target triple, e.g. aarch64-unknown-linux-gnu"
    )
    args = parser.parse_args()

    t_os = target_os(args.target)
    t_arch = target_arch(args.target)
    h_os = host_os()
    h_arch = host_arch()

    errors = []
    if t_os == "unknown":
        errors.append(f"unsupported target OS in triple: {args.target}")
    if t_os != h_os:
        errors.append(f"target OS {t_os} does not match runner OS {h_os}")
    if t_arch != h_arch:
        errors.append(f"target arch {t_arch} does not match runner arch {h_arch}")

    if errors:
        for err in errors:
            print(f"ERROR: {err}", file=sys.stderr)
        return 1

    print(f"OK: native target validation passed ({args.target} on {h_os}/{h_arch})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
