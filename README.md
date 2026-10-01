# ESO Addon Development Assistant — MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![MCP Protocol](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io/)

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for **Elder Scrolls Online addon development**. Gives AI assistants deep, up-to-date knowledge of the ESO API, equipment sets, addon rules, and code generation — across 42 tools in 10 modules.

Works with **Claude Desktop, Claude Code, Cursor, VS Code Copilot, Windsurf, Cline**, and any MCP-compatible client.

---

## Features

### 42 Tools across 10 Modules

| Module | Tools | What it does |
|--------|------:|--------------|
| **API Reference** | 6 | Search 9,303 typed API functions, 1,051 events, 497K constants, UI controls |
| **Set Database** | 7 | Search 704 equipment sets with bonuses, locations, drop mechanics |
| **Character Import** | 4 | Import characters from ESO SavedVariables |
| **Code Generation** | 7 | Generate event handlers, settings panels, slash commands, UI XML, SavedVars, classes, snippets |
| **Addon Scaffolding** | 5 | Create manifests, boilerplate projects, single files, upload validation, changelogs |
| **Analysis & Debugging** | 4 | Analyze code quality, validate manifests, parse error logs, inspect SavedVars |
| **ESO Game Data** | 5 | Search zones, skills, patch notes, combined API search, source browsing |
| **Addon Rules** | 3 | 14 rule topics, 31 MUST NOT rules from official ESOUI guidelines |
| **Self-Update** | 1 | Refresh all data after ESO patches (UESP, GitHub, eso-hub.com, LibSets) |

### Database

| Data | Count | Source |
|------|------:|--------|
| API Functions (with typed parameters) | 9,303 | UESP (esoapi.uesp.net) |
| Events | 1,051 (586 with full param definitions) | UESP + ESOUI GitHub |
| Constants & Enums | 497,405 | UESP |
| Equipment Sets | 704 | LibSets by Baertram |
| Set Bonus Descriptions | 2,361 across 704 sets | eso-hub.com |
| Zones | 175 | LibSets |
| Wayshrines | 567 | LibSets |
| Set Drop Locations | 1,318 (with zone names + drop mechanics) | LibSets |
| UI Control Types | 13 | Built-in definitions |
| Addon Rule Topics | 14 | ESOUI community guidelines |
| MUST NOT Rules | 31 | Official ESOUI guidelines |

### Security

- **Path validation** — File access restricted to allowed directories only
- **FTS injection protection** — Search queries sanitized before SQLite FTS5
- **Input validation** — All tool inputs validated with Zod schemas
- **Script allowlist** — Script paths are hardcoded, never from user input
- **Identifier validation** — Generated code uses regex-validated identifiers to prevent Lua injection
- **Graceful shutdown** — SIGINT/SIGTERM handlers ensure database integrity

### Self-Updating

After every ESO patch, a single `update_database` call pulls fresh data from UESP, GitHub, eso-hub.com, and LibSets — no manual steps required.

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- An MCP-compatible AI client

### Installation

```bash
git clone https://github.com/Virus250188/ESOUI_MCP.git
cd ESOUI_MCP/mcp-server
npm install
npm run build
```

### First Run — Automatic Data Import

On first start, the server automatically downloads ESO API data from UESP (~30 seconds):

```bash
npm start
```

Then import the full set database:

```bash
cd ..
npx tsx scripts/import-all-sets.ts    # Import 704 sets from LibSets
npx tsx scripts/import-api-docs.ts     # Import official API docs from GitHub
npx tsx scripts/scrape-set-bonuses.ts  # Scrape set bonus descriptions (uses Cheerio)
```

### Connect to Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "eso-addon-dev": {
      "command": "node",
      "args": ["/path/to/ESO_MCP/mcp-server/dist/index.js"]
    }
  }
}
```

### Connect to Cursor / VS Code / Other MCP Clients

Configure the MCP server command: `node /path/to/ESO_MCP/mcp-server/dist/index.js`

### HTTP/SSE Mode

The server can also run over HTTP using SSE (Server-Sent Events) or Streamable HTTP transport, enabling remote connections:

```bash
# SSE mode (default)
node dist/index.js --http --port 3000

# Streamable HTTP mode
node dist/index.js --http --mode streamable --port 3000

# Bind to localhost only
node dist/index.js --http --host 127.0.0.1 --port 8080
```

Environment variables are also supported:

```bash
MCP_TRANSPORT=http MCP_PORT=3000 MCP_MODE=sse node dist/index.js
```

Endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/sse` | GET | Establish SSE connection (SSE mode) |
| `/sse` | POST | Send messages to server (SSE mode) |
| `/mcp` | GET/POST/DELETE | Streamable HTTP (Streamable mode) |
| `/health` | GET | Health check |

Connect from an MCP client using the SSE URL: `http://localhost:3000/sse`

---

## Tool Overview

### API Reference (6 tools)

| Tool | Description |
|------|-------------|
| `search_api_functions` | Search 9,303 ESO API functions with typed signatures |
| `get_function_details` | Full details: params, returns, related functions |
| `search_events` | Search 1,051 events with parameter definitions |
| `search_constants` | Search 497K constants/enums by name or group |
| `get_ui_control_info` | UI control types with methods, properties, events |
| `search_source_code` | ESO UI source code search guidance |

### Set Database (7 tools)

| Tool | Description |
|------|-------------|
| `search_sets` | Search equipment sets by name, type, DLC, or armor weight |
| `get_set_details` | Full set details including bonus descriptions and locations |
| `update_character_context` | Store character info for personalized build recommendations |
| `recommend_builds` | Build recommendations based on class, role, and preferences |
| `compare_sets` | Compare 2–4 sets side-by-side |
| `get_farming_guide` | Detailed farming guide with locations and requirements |
| `get_set_by_category` | Browse sets by curated categories (beginner, endgame, PvP, etc.) |

### Character Import (4 tools)

| Tool | Description |
|------|-------------|
| `import_character_from_game` | Import all characters from ESO SavedVariables |
| `list_my_characters` | List all previously imported characters |
| `sync_character` | Re-sync a character to update gear data |
| `get_character_details` | Detailed character info including equipped sets |

### Code Generation (7 tools)

| Tool | Description |
|------|-------------|
| `generate_event_handler` | Lua event handler with correct parameter signatures from DB |
| `generate_settings_panel` | Complete LibAddonMenu-2.0 settings panel |
| `generate_slash_command` | Slash commands with subcommand routing |
| `generate_ui_xml` | ESO XML for 8 control types (TopLevelControl, Button, Label, etc.) |
| `generate_savedvariables_code` | ZO_SavedVars with defaults and helpers |
| `generate_class_code` | OOP-style Lua class with constructor, methods, and inheritance |
| `generate_utility_snippet` | Common utility snippets (timers, iterators, color helpers, etc.) |

### Addon Scaffolding (5 tools)

| Tool | Description |
|------|-------------|
| `create_addon_manifest` | Generate a valid `.txt` manifest file |
| `create_addon_boilerplate` | Complete addon file set (manifest + Lua + settings + XML + keybindings) |
| `create_addon_file` | Generate a single file using templates |
| `prepare_addon_upload` | Validate against ESOUI upload rules (manifest, ZIP, hidden files, etc.) |
| `manage_changelog` | Create or update addon changelog without overwriting ESOUI-managed entries |

### Analysis & Debugging (4 tools)

| Tool | Description |
|------|-------------|
| `analyze_addon_code` | Detect global pollution, missing unregister, performance issues |
| `validate_addon_manifest` | Check manifest format, APIVersion, dependencies |
| `parse_addon_error_log` | Diagnose ESO Lua errors with fix suggestions |
| `analyze_savedvariables` | File structure, size, nesting depth, issues |

### ESO Game Data (5 tools)

| Tool | Description |
|------|-------------|
| `search_zones` | Search zones by name and type, with associated sets |
| `search_skills` | Search skills (links to external resources) |
| `get_patch_notes_summary` | Current API version info, stats, and patch note links |
| `fetch_api_docs` | Combined search across functions, events, AND constants |
| `fetch_esoui_source` | Direct URLs to ESO UI source files and directory guide |

### Addon Rules (3 tools)

| Tool | Description |
|------|-------------|
| `get_addon_rules` | 14 rule topics: restrictions, capabilities, lua_version, console_addons, dev_tools, and more |
| `generate_localization` | SafeAddString or separate language files (EN/DE/FR) |
| `generate_hook_code` | ZO_PreHook, SecurePostHook, function overrides |

### Self-Update (1 tool)

| Tool | Description |
|------|-------------|
| `update_database` | Refresh data after ESO patches from UESP, GitHub, eso-hub.com, or LibSets |

### Updating After an ESO Patch

```
1. update_database({source: "api_uesp"})      → Fresh API data from UESP
2. update_database({source: "api_docs"})      → API docs from GitHub
3. update_database({source: "set_bonuses"})   → New/updated sets from eso-hub.com
4. update_database({source: "sets"})          → Re-import from LibSets (update addon first)
5. update_database({source: "status"})        → Verify what's loaded
```

---

## Data Sources & Credits

| Source | License | What it provides |
|--------|---------|-----------------|
| [LibSets](https://www.esoui.com/downloads/info2241) by **Baertram** | Unlicense / Public Domain | Set data, zones, wayshrines, drop locations |
| [UESP](https://esoapi.uesp.net/) | Open | API functions, events, constants |
| [eso-hub.com](https://eso-hub.com/en/sets) | — | Set bonus descriptions |
| [ESOUI Community Guidelines](https://www.esoui.com/forums/showthread.php?t=9867) | — | Addon development rules (31 MUST NOT rules) |

---

## Documentation

Full per-module documentation lives in the [`docs/`](docs/) folder:

| Doc | Module | Coverage |
|-----|--------|----------|
| [00-overview.md](docs/00-overview.md) | All | Navigation hub, workflows, architecture |
| [01-api-reference.md](docs/01-api-reference.md) | API Reference | Functions, events, constants, UI controls |
| [02-set-database.md](docs/02-set-database.md) | Set Database | Sets, builds, farming, comparisons |
| [03-character-import.md](docs/03-character-import.md) | Characters | Import, sync, gear view |
| [04-code-generation.md](docs/04-code-generation.md) | Code Generation | Event handlers, settings, UI XML, classes, snippets |
| [05-addon-scaffold.md](docs/05-addon-scaffold.md) | Scaffolding | Manifests, boilerplate, upload, changelogs |
| [06-analysis-debugging.md](docs/06-analysis-debugging.md) | Analysis | Code review, errors, SavedVars |
| [07-eso-data.md](docs/07-eso-data.md) | ESO Data | Zones, skills, patch notes |
| [08-addon-rules.md](docs/08-addon-rules.md) | Addon Rules | Guidelines, localization, hooks |
| [09-updater.md](docs/09-updater.md) | Self-Update | Post-patch update workflow |

---

## Contributing

Bug reports and pull requests are welcome. For large changes, open an issue first to discuss the approach.

When adding or modifying tools, update the matching doc in `docs/` and bump the tool count in `mcp-server/src/index.ts`.

## License

MIT
