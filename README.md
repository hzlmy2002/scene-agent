# AIsa Web Market

Node/TypeScript stdio MCP for focused website competitive analysis. Five tools call **AIsa REST APIs directly**, with user-supplied Bearer authentication. No dependency on the Python aisa-mcp server, OAuth, or model calls inside tools.

## Local setup

Requires Node 22 or newer.

```sh
npm ci
npm test
npm run build
```

Set `AISA_API_KEY` in the environment of the process launching your MCP client. It is an AIsa API key; never put it in a Skill or commit it. Desktop clients started outside your shell may need the variable configured explicitly in their MCP settings. The installer does not read or persist the key.

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

`npm test` exercises API contracts, calculations, failures, installer preservation and real stdio protocol exchange without network calls or credits. `npm pack` creates an installable npm archive. The `@aisa/web-market` name is provisional and has not been published or registry ownership verified. Until published, use the checkout, a local tarball installed to a stable directory, or a generated plugin. Avoid registering an ephemeral npx-cache path through `setup` for long-term use.

`docs/contract.md` records the endpoint mapping and limits. `docs/upstream-snapshot.json` captures only the required operation definitions and examples from the supplied docs checkout. Run `node scripts/check-contract.mjs /path/to/docs/openapi/similarweb.json` to detect drift in those operations. Live API verification requires an explicitly selected funded account and month; no production calls are made by the test suite.

## Live verification

The five tools and all four underlying API paths were exercised with an authorized test account on 2026-09-05 (9 requests). See [the report](docs/live-verification-2026-09-05.md). `estk.me` returned provider Data not found for July 2026 traffic/geography; wikipedia.org succeeded. The exact no-data signature now returns empty success with an explanatory warning. The captured responses also run offline in regression tests. This does not guarantee every domain or month has data.
