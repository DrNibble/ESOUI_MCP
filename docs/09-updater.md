# Self-Update Tool

The Updater module provides 1 tool for keeping the MCP server database up to date with the latest ESO data. After an ESO patch, use this tool to refresh sets, API documentation, and other game data.

---

## update_database

**Description:** Update the MCP server database with fresh data from multiple sources. Use after an ESO patch to get new sets, API changes, and other updated information.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| source | string | Yes | What to update. One of: `"status"`, `"sets"`, `"set_bonuses"`, `"api_docs"`, `"api_uesp"`, `"all"` |

**Source options explained:**

| Source | What it does | Data source | Duration | Requirements |
|--------|-------------|-------------|----------|--------------|
| `status` | Show current data status, counts, and import history | Local database | Instant | None |
| `sets` | Re-import sets from LibSets addon | `addon_Libs/LibSets/` in project | ~30 seconds | Updated LibSets addon files |
| `set_bonuses` | Scrape set bonus descriptions | eso-hub.com via Cheerio | Several minutes (700+ sets) | Cheerio (included in dependencies) |
| `api_docs` | Download official API documentation | GitHub `esoui/esoui` `ESOUIDocumentation.txt` | ~30 seconds | Internet access |
| `api_uesp` | Fetch functions, events, constants | UESP `esoapi.uesp.net` | ~1-2 minutes | Internet access |
| `all` | Run all of the above in sequence | All sources | 5-15 minutes | All requirements above |

---

### Check Current Status

The most common starting point. Shows what data is loaded, when it was imported, and database statistics.

**Example Usage:**

```json
{
  "tool": "update_database",
  "arguments": {
    "source": "status"
  }
}
```

**Example Response:**

```json
{
  "database": {
    "sets": 669,
    "set_bonuses": 2847,
    "sets_with_bonuses": 665,
    "zones": 142,
    "wayshrines": 0,
    "set_locations": 1205,
    "api_functions": 6842,
    "api_events": 1025,
    "events_with_parameters": 586,
    "api_constants": 12543
  },
  "import_history": {
    "sets_import_date": "2025-05-10T14:30:00Z",
    "sets_source": "LibSets",
    "api_data_import_date": "2025-05-10T14:35:00Z",
    "api_data_version": "101048",
    "api_docs_import_date": "2025-05-10T14:40:00Z",
    "api_docs_version": "101048"
  },
  "update_sources": {
    "sets": "LibSets addon (addon_Libs/LibSets/) - update the addon first, then run update",
    "set_bonuses": "eso-hub.com (scraped via Cheerio)",
    "api_docs": "GitHub esoui/esoui ESOUIDocumentation.txt (official ZOS docs)",
    "api_uesp": "UESP esoapi.uesp.net (community-maintained API dump)"
  },
  "how_to_update_after_patch": [
    "1. Update LibSets addon to latest version (esoui.com/downloads/info2241)",
    "2. Copy updated LibSets to addon_Libs/LibSets/ in the project",
    "3. Run update_database({source: \"sets\"}) to re-import sets",
    "4. Run update_database({source: \"set_bonuses\"}) to scrape new set bonuses",
    "5. Run update_database({source: \"api_docs\"}) to get updated API documentation",
    "6. Run update_database({source: \"api_uesp\"}) to refresh UESP data (may lag behind patches)"
  ]
}
```

---

### Update Sets from LibSets

Re-imports set data from the LibSets addon files stored in the project.

**Example Usage:**

```json
{
  "tool": "update_database",
  "arguments": {
    "source": "sets"
  }
}
```

**Example Response:**

```json
{
  "update_results": {
    "sets": {
      "success": true,
      "sets_imported": 672,
      "output": "=== Starting sets import ===; === Import complete ==="
    }
  },
  "current_status": {
    "sets": 672,
    "set_bonuses": 2847,
    "api_functions": 6842,
    "api_events": 1025,
    "api_constants": 12543
  }
}
```

**Prerequisites:**

1. Download the latest LibSets addon from [esoui.com/downloads/info2241](https://www.esoui.com/downloads/info2241).
2. Copy the updated LibSets files to `addon_Libs/LibSets/` in the project directory.
3. Then run `update_database` with `source: "sets"`.

---

### Update Set Bonuses from eso-hub.com

Scrapes set bonus descriptions from eso-hub.com using a headless browser. This provides the "2 items: Adds 1096 Maximum Magicka" type text that is not available from LibSets alone.

**Example Usage:**

```json
{
  "tool": "update_database",
  "arguments": {
    "source": "set_bonuses"
  }
}
```

**Example Response:**

```json
{
  "update_results": {
    "set_bonuses": {
      "success": true,
      "sets_scraped": 669,
      "note": "Scraped from eso-hub.com via Cheerio"
    }
  },
  "current_status": {
    "sets": 669,
    "set_bonuses": 2890,
    "api_functions": 6842,
    "api_events": 1025,
    "api_constants": 12543
  }
}
```

**Prerequisites:**

- Cheerio is used for HTML parsing (included in dependencies)
- Internet access required.
- This operation takes several minutes for 700+ sets.

---

### Update API Documentation from GitHub

Downloads the official `ESOUIDocumentation.txt` from the esoui GitHub repository and imports function signatures and event parameter definitions.

**Example Usage:**

```json
{
  "tool": "update_database",
  "arguments": {
    "source": "api_docs"
  }
}
```

**Example Response:**

```json
{
  "update_results": {
    "api_docs": {
      "success": true,
      "functions": 6842,
      "events": 586,
      "source": "GitHub esoui/esoui ESOUIDocumentation.txt"
    }
  },
  "current_status": {
    "api_functions": 6842,
    "api_events": 1025,
    "api_constants": 12543
  }
}
```

**Prerequisites:**

- Internet access required.

---

### Update UESP Data

Fetches the latest functions, events, and constants from the UESP API dump. UESP provides a comprehensive community-maintained API reference that may include data not in the official documentation.

**Example Usage:**

```json
{
  "tool": "update_database",
  "arguments": {
    "source": "api_uesp"
  }
}
```

**Example Response:**

```json
{
  "update_results": {
    "api_uesp": {
      "success": true,
      "functions": 6842,
      "events": 1025,
      "constants": 12543,
      "source": "UESP esoapi.uesp.net"
    }
  },
  "current_status": {
    "api_functions": 6842,
    "api_events": 1025,
    "api_constants": 12543
  }
}
```

**Prerequisites:**

- Internet access required.
- UESP data may lag behind ESO patches by a few days.

---

### Update Everything

Runs all update sources in sequence. This is the most thorough option after a major ESO patch.

**Example Usage:**

```json
{
  "tool": "update_database",
  "arguments": {
    "source": "all"
  }
}
```

**Example Response:**

```json
{
  "update_results": {
    "sets": { "success": true, "sets_imported": 672 },
    "set_bonuses": { "success": true, "sets_scraped": 669 },
    "api_docs": { "success": true, "functions": 6842, "events": 586 },
    "api_uesp": { "success": true, "functions": 6842, "events": 1025, "constants": 12543 }
  },
  "current_status": {
    "sets": 672,
    "set_bonuses": 2890,
    "api_functions": 6842,
    "api_events": 1025,
    "api_constants": 12543
  }
}
```

**Tips:**

- Individual source updates can fail without affecting others. Check the `errors` field in the response.
- Failed updates do not corrupt existing data -- they simply leave the old data in place.
- The `current_status` in the response always reflects the state after all updates complete (or fail).
- After a major ESO patch, follow this order: `sets` first (requires manual LibSets update), then `api_docs`, then `api_uesp`, and finally `set_bonuses`.

---

## Post-Patch Update Workflow

Follow these steps after a new ESO patch:

1. **Check status**: `update_database({ source: "status" })` to see current data state.
2. **Update LibSets**: Download latest LibSets from esoui.com and copy to `addon_Libs/LibSets/`.
3. **Import sets**: `update_database({ source: "sets" })`.
4. **Update API docs**: `update_database({ source: "api_docs" })`.
5. **Update UESP data**: `update_database({ source: "api_uesp" })` (wait a few days after patch for UESP to update).
6. **Scrape set bonuses**: `update_database({ source: "set_bonuses" })` (wait for eso-hub.com to update).
7. **Verify**: `update_database({ source: "status" })` to confirm new counts.
