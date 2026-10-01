import { z } from 'zod';
import { execSync } from 'child_process';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, writeFileSync } from 'fs';
import { db } from '../database/db.js';
import type { ToolModule, ToolResult } from '../types/tool-types.js';
import { jsonResult, errorResult } from '../types/tool-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = join(PROJECT_ROOT, 'scripts');
const DATA_DIR = join(PROJECT_ROOT, 'data');

// ===== SCHEMAS =====

const UpdateDatabaseSchema = z.object({
  source: z.enum([
    'sets',
    'set_bonuses',
    'api_docs',
    'api_uesp',
    'all',
    'status',
  ]).describe('What to update: sets (LibSets re-import), set_bonuses (scrape eso-hub.com), api_docs (GitHub ESOUIDocumentation), api_uesp (UESP functions/events/constants), all (everything), status (show current data status)'),
});

// ===== TOOL DEFINITIONS =====

const definitions = [
  {
    name: 'update_database',
    description:
      'Update the MCP server database with fresh data. Use after an ESO patch to get new sets, API changes, etc. Options: "status" (check what data is loaded and when), "sets" (re-import sets from LibSets - requires updated LibSets addon), "set_bonuses" (scrape set bonus descriptions from eso-hub.com via Cheerio), "api_docs" (re-download official API documentation from GitHub esoui/esoui), "api_uesp" (re-fetch functions/events/constants from UESP), "all" (update everything). NOTE: set_bonuses uses Cheerio for HTML parsing and takes several minutes for 700+ sets. api_docs and api_uesp require internet access.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        source: {
          type: 'string',
          enum: ['sets', 'set_bonuses', 'api_docs', 'api_uesp', 'all', 'status'],
          description: 'What to update',
        },
      },
      required: ['source'],
    },
  },
];

// ===== HELPERS =====

function getStatus(): Record<string, any> {
  const funcCount = db.getApiFunctionCount();
  const eventCount = db.getApiEventCount();
  const constantCount = db.getApiConstantCount();

  const setsCount = (db as any).db.prepare('SELECT COUNT(*) as c FROM sets').get() as any;
  const bonusCount = (db as any).db.prepare('SELECT COUNT(*) as c FROM set_bonuses').get() as any;
  const setsWithBonuses = (db as any).db.prepare('SELECT COUNT(DISTINCT set_id) as c FROM set_bonuses').get() as any;
  const zoneCount = (db as any).db.prepare('SELECT COUNT(*) as c FROM zones').get() as any;
  const locationCount = (db as any).db.prepare('SELECT COUNT(*) as c FROM set_locations').get() as any;
  const wsCount = (db as any).db.prepare('SELECT COUNT(*) as c FROM wayshrines').get() as any;
  const eventsWithParams = (db as any).db.prepare("SELECT COUNT(*) as c FROM api_events WHERE parameters IS NOT NULL AND parameters != 'null' AND parameters != '[]'").get() as any;

  // Get import metadata
  const meta: Record<string, string | null> = {};
  for (const key of ['sets_import_date', 'sets_source', 'api_data_import_date', 'api_data_version', 'api_docs_import_date', 'api_docs_version']) {
    meta[key] = db.getImportMetadata(key);
  }

  return {
    database: {
      sets: setsCount.c,
      set_bonuses: bonusCount.c,
      sets_with_bonuses: setsWithBonuses.c,
      zones: zoneCount.c,
      wayshrines: wsCount.c,
      set_locations: locationCount.c,
      api_functions: funcCount,
      api_events: eventCount,
      events_with_parameters: eventsWithParams.c,
      api_constants: constantCount,
    },
    import_history: meta,
    update_sources: {
      sets: 'LibSets addon (addon_Libs/LibSets/) - update the addon first, then run update',
      set_bonuses: 'eso-hub.com (scraped via Cheerio)',
      api_docs: 'GitHub esoui/esoui ESOUIDocumentation.txt (official ZOS docs)',
      api_uesp: 'UESP esoapi.uesp.net (community-maintained API dump)',
    },
    how_to_update_after_patch: [
      '1. Update LibSets addon to latest version (esoui.com/downloads/info2241)',
      '2. Copy updated LibSets to addon_Libs/LibSets/ in the project',
      '3. Run update_database({source: "sets"}) to re-import sets',
      '4. Run update_database({source: "set_bonuses"}) to scrape new set bonuses',
      '5. Run update_database({source: "api_docs"}) to get updated API documentation',
      '6. Run update_database({source: "api_uesp"}) to refresh UESP data (may lag behind patches)',
    ],
  };
}

// Allowlist of scripts that can be executed - prevents arbitrary script execution
const ALLOWED_SCRIPTS = ['import-all-sets.ts', 'scrape-set-bonuses.ts', 'import-api-docs.ts'];

function runScript(scriptName: string, timeout: number = 300000): string {
  if (!ALLOWED_SCRIPTS.includes(scriptName)) {
    throw new Error(`Script not allowed: ${scriptName}. Allowed: ${ALLOWED_SCRIPTS.join(', ')}`);
  }
  const scriptPath = join(SCRIPTS_DIR, scriptName);
  // Verify resolved path is still inside SCRIPTS_DIR
  const resolved = resolve(scriptPath);
  if (!resolved.startsWith(resolve(SCRIPTS_DIR))) {
    throw new Error(`Script path escapes scripts directory: ${scriptName}`);
  }
  if (!existsSync(scriptPath)) {
    throw new Error(`Script not found: ${scriptPath}`);
  }

  try {
    const result = execSync(`npx tsx "${scriptPath}"`, {
      cwd: PROJECT_ROOT,
      timeout,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result;
  } catch (error: any) {
    const stderr = error.stderr || '';
    const stdout = error.stdout || '';
    throw new Error(`Script failed: ${stderr || stdout || error.message}`);
  }
}

async function updateApiDocs(): Promise<{ functions: number; events: number }> {
  // Download fresh ESOUIDocumentation.txt from GitHub
  // IMPORTANT: Use 'live' branch, NOT 'master'! Master is outdated (API 101041), live is current.
  const url = 'https://raw.githubusercontent.com/esoui/esoui/live/ESOUIDocumentation.txt';
  const docPath = join(DATA_DIR, 'api', 'ESOUIDocumentation.txt');

  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) {
    throw new Error(`Failed to fetch API docs: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  if (text.length < 10000) {
    throw new Error('Downloaded API docs seem too small - possible error page');
  }

  // Save to disk
  writeFileSync(docPath, text, 'utf-8');

  // Run import script
  const output = runScript('import-api-docs.ts', 120000);

  // Parse results from output
  const funcMatch = output.match(/Functions inserted:\s*(\d+)/);
  const eventMatch = output.match(/Events updated:\s*(\d+)/);

  return {
    functions: funcMatch ? parseInt(funcMatch[1]) : 0,
    events: eventMatch ? parseInt(eventMatch[1]) : 0,
  };
}

async function updateUesp(): Promise<{ functions: number; events: number; constants: number }> {
  // Save current metadata for rollback on failure
  const savedMeta: Record<string, string | null> = {};
  for (const key of ['api_data_imported', 'api_data_source', 'api_data_version', 'api_data_import_date', 'api_functions_count', 'api_events_count', 'api_constants_count']) {
    savedMeta[key] = db.getImportMetadata(key);
  }

  try {
    // Reset the import flag so api-importer runs again
    if (savedMeta['api_data_imported']) {
      (db as any).db.prepare("DELETE FROM import_metadata WHERE key LIKE 'api_data%'").run();
    }

    // Import using the api-importer service
    const { ensureApiDataLoaded } = await import('../services/api-importer.js');
    await ensureApiDataLoaded();

    return {
      functions: db.getApiFunctionCount(),
      events: db.getApiEventCount(),
      constants: db.getApiConstantCount(),
    };
  } catch (error) {
    // Rollback metadata on failure so server doesn't retry every startup
    for (const [key, value] of Object.entries(savedMeta)) {
      if (value) db.setImportMetadata(key, value);
    }
    throw error;
  }
}

// ===== HANDLER =====

async function handler(name: string, args: unknown): Promise<ToolResult> {
  switch (name) {
    case 'update_database': {
      const params = UpdateDatabaseSchema.parse(args);

      if (params.source === 'status') {
        return jsonResult(getStatus());
      }

      const results: Record<string, any> = {};
      const errors: string[] = [];

      // Sets from LibSets
      if (params.source === 'sets' || params.source === 'all') {
        try {
          const output = runScript('import-all-sets.ts', 120000);
          const countMatch = output.match(/Total sets imported:\s*(\d+)/);
          results.sets = {
            success: true,
            sets_imported: countMatch ? parseInt(countMatch[1]) : 'unknown',
            output: output.split('\n').filter(l => l.includes('===')).join('; '),
          };
        } catch (e: any) {
          errors.push(`Sets import failed: ${e.message}`);
          results.sets = { success: false, error: e.message };
        }
      }

      // Set bonuses from eso-hub.com
      if (params.source === 'set_bonuses' || params.source === 'all') {
        try {
          const output = runScript('scrape-set-bonuses.ts', 600000); // 10 min timeout
          const countMatch = output.match(/Sets scraped this run:\s*(\d+)/);
          results.set_bonuses = {
            success: true,
            sets_scraped: countMatch ? parseInt(countMatch[1]) : 'unknown',
            note: 'Scraped from eso-hub.com via Cheerio',
          };
        } catch (e: any) {
          errors.push(`Set bonuses scrape failed: ${e.message}`);
          results.set_bonuses = { success: false, error: e.message };
        }
      }

      // API docs from GitHub
      if (params.source === 'api_docs' || params.source === 'all') {
        try {
          const docResults = await updateApiDocs();
          results.api_docs = {
            success: true,
            ...docResults,
            source: 'GitHub esoui/esoui ESOUIDocumentation.txt',
          };
        } catch (e: any) {
          errors.push(`API docs update failed: ${e.message}`);
          results.api_docs = { success: false, error: e.message };
        }
      }

      // UESP data
      if (params.source === 'api_uesp' || params.source === 'all') {
        try {
          const uespResults = await updateUesp();
          results.api_uesp = {
            success: true,
            ...uespResults,
            source: 'UESP esoapi.uesp.net',
          };
        } catch (e: any) {
          errors.push(`UESP update failed: ${e.message}`);
          results.api_uesp = { success: false, error: e.message };
        }
      }

      // Update metadata timestamp
      db.setImportMetadata('last_full_update', new Date().toISOString());

      // Get fresh status after updates
      const status = getStatus();

      return jsonResult({
        update_results: results,
        errors: errors.length > 0 ? errors : undefined,
        current_status: status.database,
      });
    }

    default:
      return errorResult(`Unknown updater tool: ${name}`);
  }
}

export const updaterModule: ToolModule = { definitions, handler };
