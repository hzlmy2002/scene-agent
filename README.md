# AIsa Web Market

Node/TypeScript stdio MCP for focused website competitive analysis. Five tools call **AIsa REST APIs directly**, with user-supplied Bearer authentication. No dependency on the Python aisa-mcp server, OAuth, or model calls inside tools.

## Install with npx

Requires Node 22 or newer. Run one of these commands in a terminal:

```sh
npx -y @hzlmy2002/web-market@0.1.2 setup --client codex
npx -y @hzlmy2002/web-market@0.1.2 setup --client claude-code
npx -y @hzlmy2002/web-market@0.1.2 setup --client hermes
```

This installs the Skill and registers a version-pinned `npx -y @hzlmy2002/web-market@0.1.2 serve` MCP command. Clearing the npm cache does not invalidate the configured path: npx downloads the pinned release again when necessary. Restart or refresh the client to discover the Skill. If no key is configured, setup prompts for hidden input and saves the key in the selected client’s MCP `env.AISA_API_KEY` setting. This works independently of shell startup files on macOS, Linux, and Windows. Existing saved keys are reused. If `AISA_API_KEY` is already set in the setup environment, setup keeps using environment-based authentication without copying the key; the client must inherit that variable. Non-interactive setup without a saved or environment key exits with instructions. Use `uninstall --client ...` to remove an unchanged managed installation.

When testing the published release from this source repository, first change to another directory (for example, `cd ~`). npm exec/npx can select the current project when its name and version match the requested package, but a source checkout has no installed `aisa-web-market` command link. This results in `sh: aisa-web-market: command not found`. Alternatively, use the local setup command below after building.

## Automatic client detection

Run `npx -y @hzlmy2002/web-market@0.1.2 setup` to install for every detected client. From a built source checkout, use `node dist/cli.js setup`. Detection checks `.codex/`, `.claude/` or `.claude.json`, and `.hermes/` in the user's home directory (or `--home`). These are usage traces, not proof that the executable is still installed. Shared `.agents/` directories alone do not count as detection.

Use `--client` to select a single client or install before its first run. If nothing is detected, setup explains how to proceed without creating client configurations. Custom client configuration roots are not discovered automatically. A newly entered key is requested once and reused for clients needing a key; existing client keys remain in place. Installation results are reported per client; a failure does not undo successful installations, and any failure produces a nonzero exit status. Uninstall still requires `--client`.

Automatic detection is available starting with version 0.1.2. Windows uses the same home-directory markers, but the full workflow has not yet been tested on a Windows machine.

## Local setup

Requires Node 22 or newer.

```sh
npm ci
npm test
npm run build
```

Setup prompts for a missing AIsa API key and stores it as plaintext in the selected client configuration, with restrictive file permissions where supported. It is never printed or copied into Skills or installer state. This is a temporary Bearer authentication flow ahead of OAuth support. Setup does not edit shell profiles or Windows user environment variables. Alternatively, set `AISA_API_KEY` in the environment inherited by your MCP client. Desktop applications may not inherit variables exported in a terminal.

Run one of these from this checkout:

```sh
node dist/cli.js setup --client codex
node dist/cli.js setup --client claude-code
node dist/cli.js setup --client hermes
```

Setup installs the Skill and merges a user-level MCP entry using the absolute Node executable and checkout path. Keep this checkout in place or rerun setup after moving it. Existing settings are preserved semantically; TOML/YAML comments and formatting can change. Unowned existing Skill files are preserved, even if their contents match the bundle. Setup refuses conflicting MCP entries and modified skills. It stages changes in memory, uses atomic writes and rolls back ordinary write failures. It uses a lock against concurrent AIsa installers; close the client's settings editor during setup. This is not a filesystem transaction across process crashes.

| Client | Skill directory | MCP config |
|---|---|---|
| Codex | `~/.agents/skills/aisa-web-market` | `~/.codex/config.toml` |
| Claude Code | `~/.claude/skills/aisa-web-market` | `~/.claude.json` |
| Hermes | `~/.hermes/skills/aisa-web-market` | `~/.hermes/config.yaml` |

Refresh/restart the client after installation if the skill is not visible. Setup follows the actual user's home directory; use `--home /absolute/path` for an isolated profile or testing. Symlinked installation paths are refused to avoid writing outside the selected location. For Hermes custom profiles, pass the matching profile home explicitly; otherwise setup targets `~/.hermes`.

To use MCP-only configuration, set `command` to your Node executable and `args` to the absolute path to `dist/cli.js`, followed by `serve`. Pass `AISA_API_KEY` through the client environment. To install the skill during server startup, add `--install-skills --client codex` (or another supported client). This is an explicit opt-in, runs idempotently, and writes status only to stderr; the first session may require a refresh for skill discovery.

```sh
node dist/cli.js status
node dist/cli.js uninstall --client codex
```

Uninstall removes only matching owned files and the matching MCP entry. It preserves other tools and settings. A modified owned file stops uninstall for review. It may leave empty directories. To update, rebuild this checkout and rerun setup.

## Tools

| Tool | Behavior |
|---|---|
| `AIsa_similar_sites` | One seed; explicit supported end month; exact 3-month window; up to 20 candidates |
| `AIsa_traffic_engagement` | 1–5 domains, explicit 1–12 monthly buckets, visits and engagement; aligned missing cells and growth |
| `AIsa_geography` | Latest worldwide snapshot, up to 10 countries per domain, 1–5 domains |
| `AIsa_website_keywords` | Single-domain keyword sample, explicit month, up to 20 rows |
| `AIsa_keyword_gap` | Target and 1–3 competitors, matching scope, deterministic sample classifications |

Country is `us` or `ww` in this release. Keyword filtering by organic/paid or branded/nonbranded is not exposed by the pinned API contract. `competition` is not relabeled as difficulty. No search volume is invented. Domain URLs are normalized; duplicate, IP, local and invalid hosts are rejected.

Every tool supports optional `max_price_usd`, a **total tool-call ceiling**, divided downward across planned requests and passed as `X-AISA-Max-Price-USD`. This relies on AIsa gateway enforcement. It is not a local price estimate or a conversation-wide budget. No automatic retries; timed-out requests may already have been billed. Up to three requests run concurrently, each with a 20-second timeout and 2 MB response cap; a tool invocation has a 60-second deadline. No persistent data cache is used.

Dates are explicit for traffic, keywords and Similar Sites. The public API does not expose a universally verified availability endpoint for these datasets, so this release does not guess the latest published month or perform additional billed probing. Geography uses the server's latest available snapshot and reports its scope. A later release can add availability discovery once a stable public contract exists.

Example user requests:

- “Compare a.com and b.com traffic, worldwide, April–June 2026.”
- “Compare target.com and rival.com keyword samples for June 2026 in the US.”
- “Find sites similar to a.com for the supported window ending July 2026.”

## Plugin bundles

```sh
npm run plugins
```

Generates `plugins/{codex,claude-code,hermes}/aisa-web-market/`, each with the same skills and a self-contained JS runtime (Node still required). No npm download is needed when starting a generated plugin. Packaging itself does not install anything into your clients or publish a marketplace entry.

- Codex: `.codex-plugin/plugin.json` plus `.mcp.json`; distribute using the client's local/plugin marketplace workflow.
- Claude Code: `.claude-plugin/plugin.json` plus `.mcp.json`; local test with `claude --plugin-dir /absolute/path/to/plugins/claude-code/aisa-web-market`.
- Hermes: Agent Plugins v1 `plugin.json` plus `mcp.json`; requires a version supporting portable packages. Enable after installing through Hermes. Configure AISA_API_KEY in the Hermes process environment.

Prefer either plugin installation or direct setup for a client, to avoid duplicate skills and tools. Plugin host discovery has not been tested in interactive Codex/Claude/Hermes sessions. The bundled runtime is tested over real stdio, and setup configuration is tested in isolated profiles.

## Development and release

`npm test` exercises API contracts, calculations, failures, installer preservation and real stdio protocol exchange without network calls or credits. `npm pack` creates an installable npm archive. The scoped package is configured for public npm publication. npm-installed setup registers a pinned npx command; setup from a source checkout registers its local Node entry. Plugin bundles remain a separate distribution option.

`docs/contract.md` records the endpoint mapping and limits. `docs/upstream-snapshot.json` captures only the required operation definitions and examples from the supplied docs checkout. Run `node scripts/check-contract.mjs /path/to/docs/openapi/similarweb.json` to detect drift in those operations. Live API verification requires an explicitly selected funded account and month; no production calls are made by the test suite.

## Live verification

The five tools and all four underlying API paths were exercised with an authorized test account on 2026-09-05 (9 requests). See [the report](docs/live-verification-2026-09-05.md). `estk.me` returned provider Data not found for July 2026 traffic/geography; wikipedia.org succeeded. The exact no-data signature now returns empty success with an explanatory warning. The captured responses also run offline in regression tests. This does not guarantee every domain or month has data.
