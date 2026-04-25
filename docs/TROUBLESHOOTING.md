# Troubleshooting

## Cursor cannot reach `http://localhost:...`

Cursor’s cloud backend calls your override base URL. It cannot see your loopback interface. Use a **public HTTPS URL**: `cursor-claude start --tunnel`, your own reverse tunnel, or a remote deploy. See the README section on tunnels and [DEPLOYMENT.md](../DEPLOYMENT.md).

## `Port ... is in use` / second `start --detach` fails

Another process (often a previous `cursor-claude start`) is bound to that port. Stop it, use `--port` with a free port, or omit `--no-auto-port` so the CLI can pick the next free port.

If you use `--detach`, check `cursor-claude status` and the PID file under your config directory; stop the old process if it is still running.

## `status` says authenticated but requests return 401

- Ensure the client sends the **same** API key the proxy expects. Run `cursor-claude status` and compare to the IDE setting.
- If you set `API_KEY` in the environment for `start`, the same value must be used by clients for that run.

## Unexpected Redis / remote credential store

If `REDIS_URL` or Upstash variables are set (shell or a `.env` in your **current working directory**), the CLI uses them instead of the local `auth.json`. Unset them or run from a directory without that `.env` if you want file-backed storage.

## OAuth / login errors

- Complete the browser flow; paste the full authorization code when prompted.
- Use `cursor-claude login --force` to clear a bad session and re-authenticate.
- Corporate proxies or blockers can interfere with the token exchange; try another network if the error persists.

## ngrok / tunnel issues

- Install the ngrok CLI and run `ngrok config add-authtoken <token>`.
- Free ngrok allows one tunnel at a time; reuse an existing agent URL or stop the other tunnel first.

## Still stuck?

Open an issue with your **redacted** command line, OS, Node version, and the error message (no API keys or tokens).
