# Security

## Threat model

OpenCode Studio runs locally and exposes powerful capabilities via its HTTP API and UI:

- Filesystem read/write (scoped to a selected workspace directory)
- Git operations
- Terminal sessions (PTY)
- Proxy/bridge access to an OpenCode server

OpenCode Studio is **not** a sandbox.

If you need isolation, run it in a VM/container and only expose it to trusted clients.

## Running safely

- Prefer binding to localhost.
- If you must expose Studio over the network, enable `OPENCODE_STUDIO_UI_PASSWORD` and put it behind a trusted reverse proxy with TLS.

## Reporting security issues

Please do not open a public issue with exploit details.

- Use this repository's GitHub Security Advisory flow (Security -> "Report a vulnerability") if available.
