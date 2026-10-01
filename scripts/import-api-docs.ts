/**
 * Import ESO API documentation from the official ESOUIDocumentation.txt file.
 * Parses Confluence Wiki markup to extract function signatures, parameters,
 * return values, and events. Merges with existing UESP data in the database.
 *
 * Run with: npx tsx scripts/import-api-docs.ts
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(PROJECT_ROOT, 'data', 'eso_sets.db');
const DOCS_PATH = path.join(PROJECT_ROOT, 'data', 'api', 'ESOUIDocumentation.txt');

const API_VERSION = '101041';

// ===== Category helpers (from api-importer.ts) =====

function categorizeFunction(name: string): { category: string; namespace?: string } {
  if (name.startsWith('EVENT_')) return { category: 'Events', namespace: 'EVENT' };
  if (name.startsWith('SI_')) return { category: 'StringIds', namespace: 'SI' };

  if (name.startsWith('ABILITY_')) return { category: 'Combat', namespace: 'ABILITY' };
  if (name.startsWith('COMBAT_')) return { category: 'Combat', namespace: 'COMBAT' };
  if (name.startsWith('ACTION_')) return { category: 'Combat', namespace: 'ACTION' };
  if (name.startsWith('DAMAGE_')) return { category: 'Combat', namespace: 'DAMAGE' };
  if (name.startsWith('BUFF_')) return { category: 'Combat', namespace: 'BUFF' };

  if (name.startsWith('BAG_')) return { category: 'Inventory', namespace: 'BAG' };
  if (name.startsWith('SLOT_')) return { category: 'Inventory', namespace: 'SLOT' };
  if (name.startsWith('ITEM_')) return { category: 'Items', namespace: 'ITEM' };
  if (name.startsWith('EQUIP_')) return { category: 'Items', namespace: 'EQUIP' };
  if (name.startsWith('ITEMTYPE_')) return { category: 'Items', namespace: 'ITEMTYPE' };
  if (name.startsWith('ENCHANT_')) return { category: 'Items', namespace: 'ENCHANT' };
  if (name.startsWith('TRAIT_')) return { category: 'Items', namespace: 'TRAIT' };

  if (name.startsWith('CRAFTING_')) return { category: 'Crafting', namespace: 'CRAFTING' };
  if (name.startsWith('SMITHING_')) return { category: 'Crafting', namespace: 'SMITHING' };
  if (name.startsWith('PROVISIONER_')) return { category: 'Crafting', namespace: 'PROVISIONER' };

  if (name.startsWith('CT_')) return { category: 'UI', namespace: 'CT' };
  if (name.startsWith('GUI_')) return { category: 'UI', namespace: 'GUI' };
  if (name.startsWith('ANCHOR_')) return { category: 'UI', namespace: 'ANCHOR' };
  if (name.startsWith('TEXT_')) return { category: 'UI', namespace: 'TEXT' };
  if (name.startsWith('KEY_')) return { category: 'UI', namespace: 'KEY' };

  if (name.startsWith('ZO_')) return { category: 'ZOS_Framework', namespace: 'ZO' };

  if (name.startsWith('MAP_')) return { category: 'Map', namespace: 'MAP' };
  if (name.startsWith('ZONE_')) return { category: 'Map', namespace: 'ZONE' };

  if (name.startsWith('GUILD_')) return { category: 'Guild', namespace: 'GUILD' };
  if (name.startsWith('CHAMPION_')) return { category: 'Champion', namespace: 'CHAMPION' };

  if (name.startsWith('HOUSING_')) return { category: 'Housing', namespace: 'HOUSING' };
  if (name.startsWith('FURNITURE_')) return { category: 'Housing', namespace: 'FURNITURE' };

  if (name.startsWith('CAMPAIGN_')) return { category: 'PvP', namespace: 'CAMPAIGN' };
  if (name.startsWith('BATTLEGROUND_')) return { category: 'PvP', namespace: 'BATTLEGROUND' };

  if (name.startsWith('CHAT_')) return { category: 'Social', namespace: 'CHAT' };
  if (name.startsWith('FRIEND_')) return { category: 'Social', namespace: 'FRIEND' };
  if (name.startsWith('MAIL_')) return { category: 'Social', namespace: 'MAIL' };

  if (name.startsWith('QUEST_')) return { category: 'Quest', namespace: 'QUEST' };
  if (name.startsWith('OBJECTIVE_')) return { category: 'Quest', namespace: 'OBJECTIVE' };

  if (name.startsWith('UNIT_')) return { category: 'Character', namespace: 'UNIT' };
  if (name.startsWith('ATTRIBUTE_')) return { category: 'Character', namespace: 'ATTRIBUTE' };
  if (name.startsWith('SKILL_')) return { category: 'Character', namespace: 'SKILL' };
  if (name.startsWith('CLASS_')) return { category: 'Character', namespace: 'CLASS' };
  if (name.startsWith('RACE_')) return { category: 'Character', namespace: 'RACE' };

  if (name.startsWith('COLLECTIBLE_')) return { category: 'Collections', namespace: 'COLLECTIBLE' };
  if (name.startsWith('COLLECTION_')) return { category: 'Collections', namespace: 'COLLECTION' };

  if (name.startsWith('SOUNDS')) return { category: 'Audio', namespace: 'SOUNDS' };
  if (name.startsWith('SCENE_')) return { category: 'Scenes', namespace: 'SCENE' };

  if (/^Get(Unit|Player|Character|Target)/.test(name)) return { category: 'Character' };
  if (/^Get(Item|Slot|Bag|Inventory)/.test(name)) return { category: 'Inventory' };
  if (/^Get(Ability|Buff|Combat|Action)/.test(name)) return { category: 'Combat' };
  if (/^Get(Guild|Heraldry)/.test(name)) return { category: 'Guild' };
  if (/^Get(Map|Zone|Wayshrine)/.test(name)) return { category: 'Map' };
  if (/^Get(Quest|Objective|Journal)/.test(name)) return { category: 'Quest' };
  if (/^Get(Housing|Furniture)/.test(name)) return { category: 'Housing' };
  if (/^Get(Champion|CP)/.test(name)) return { category: 'Champion' };
  if (/^Get(Crafting|Smithing|Alchemy|Enchant|Provision)/.test(name)) return { category: 'Crafting' };
  if (/^Get(Campaign|Battleground|Keep|Siege)/.test(name)) return { category: 'PvP' };
  if (/^Get(Chat|Mail|Friend|Social)/.test(name)) return { category: 'Social' };
  if (/^Get(Collectible|Mount|Outfit|Companion)/.test(name)) return { category: 'Collections' };
  if (/^(Is|Has|Can|Does|Are|Should|Was)/.test(name)) return { category: 'Utility' };
  if (/^(Set|Toggle|Enable|Disable)/.test(name)) return { category: 'Utility' };
  if (/^(Create|Destroy|Add|Remove|Clear|Reset)/.test(name)) return { category: 'Utility' };
  if (/^(Play|Stop)Sound/.test(name)) return { category: 'Audio' };

  return { category: 'Other' };
}

function categorizeByEventName(name: string): { category: string } {
  if (/COMBAT|ABILITY|ACTION_SLOT|POWER_UPDATE/.test(name)) return { category: 'Combat' };
  if (/INVENTORY|ITEM|BAG|SLOT_UPDATE/.test(name)) return { category: 'Inventory' };
  if (/CRAFT|SMITH|ENCHANT|PROVISION|ALCHEMY/.test(name)) return { category: 'Crafting' };
  if (/GUILD/.test(name)) return { category: 'Guild' };
  if (/QUEST|OBJECTIVE|JOURNAL/.test(name)) return { category: 'Quest' };
  if (/MAP|ZONE|WAYSHRINE|FAST_TRAVEL/.test(name)) return { category: 'Map' };
  if (/CAMPAIGN|BATTLEGROUND|KEEP|SIEGE|ALLIANCE/.test(name)) return { category: 'PvP' };
  if (/CHAT|SOCIAL|FRIEND|MAIL|GROUP/.test(name)) return { category: 'Social' };
  if (/CHAMPION/.test(name)) return { category: 'Champion' };
  if (/HOUSING|FURNITURE/.test(name)) return { category: 'Housing' };
  if (/COLLECTIBLE|MOUNT|OUTFIT/.test(name)) return { category: 'Collections' };
  if (/PLAYER|CHARACTER|UNIT|EXPERIENCE|LEVEL/.test(name)) return { category: 'Character' };
  if (/LOOT|REWARD|CROWN/.test(name)) return { category: 'Loot' };
  if (/SCENE|INTERFACE|UI|HUD|RETICLE/.test(name)) return { category: 'UI' };
  if (/SKILL|PROGRESSION/.test(name)) return { category: 'Skills' };
  if (/ADD_ON|ADDON/.test(name)) return { category: 'Addon' };
  if (/TRADING_HOUSE|STORE/.test(name)) return { category: 'Trading' };
  if (/COMPANION/.test(name)) return { category: 'Companion' };
  return { category: 'Other' };
}

// ===== Parsing helpers =====

interface Param {
  name: string;
  type: string;
}

interface ParsedFunction {
  name: string;
  namespace: string | null;
  category: string;
  signature: string;
  parameters: Param[];
  returnValues: Param[];
  isProtected: boolean;
  sourceSection: string;
}

interface ParsedEvent {
  name: string;
  category: string;
  parameters: Param[];
}

/**
 * Clean a type string from the wiki markup format.
 * Examples:
 *   "*integer*"            -> "integer"
 *   "*[Bag|#Bag]*"         -> "Bag"
 *   "*luaindex:nilable*"   -> "luaindex:nilable"
 *   "*[InterfaceColorType|#InterfaceColorType]*" -> "InterfaceColorType"
 *   "*integer:nilable*"    -> "integer:nilable"
 *   "*[DiggingActiveSkills|#DiggingActiveSkills]:nilable*" -> "DiggingActiveSkills:nilable"
 */
function cleanType(raw: string): string {
  // Remove surrounding *...*
  let t = raw.replace(/^\*/, '').replace(/\*$/, '');
  // Handle [TypeName|#TypeName]:nilable patterns
  const linkMatch = t.match(/^\[([^\]|]+)\|[^\]]*\](.*)$/);
  if (linkMatch) {
    t = linkMatch[1] + linkMatch[2];
  }
  return t.trim();
}

/**
 * Clean a parameter name from wiki markup: _paramName_ -> paramName
 */
function cleanParamName(raw: string): string {
  return raw.replace(/^_/, '').replace(/_$/, '').trim();
}

/**
 * Parse a parameter list string like:
 *   "*type* _name_, *type2* _name2_"
 * into an array of {name, type}.
 *
 * This needs to handle nested brackets like *[Foo|#Foo]* and commas inside them.
 */
function parseParamList(paramStr: string): Param[] {
  if (!paramStr || !paramStr.trim()) return [];

  const params: Param[] = [];

  // Tokenize: split by commas that are NOT inside brackets
  const tokens: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of paramStr) {
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      tokens.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) tokens.push(current.trim());

  for (const token of tokens) {
    // Match: *type* _name_
    // The type may contain brackets: *[Foo|#Foo]*
    // It may also have :nilable after the closing *
    const m = token.match(/^(\*[^*]*\*(?::[\w]+)?)\s+(_[^_]+_)$/);
    if (m) {
      params.push({
        type: cleanType(m[1]),
        name: cleanParamName(m[2]),
      });
    } else {
      // Try alternate: *type:nilable* _name_ where nilable is inside the asterisks
      const m2 = token.match(/^(\*[^*]+\*)\s+(_[^_]+_)$/);
      if (m2) {
        params.push({
          type: cleanType(m2[1]),
          name: cleanParamName(m2[2]),
        });
      } else {
        // Fallback: just use the whole token as a name with unknown type
        const cleaned = token.replace(/^\*[^*]*\*\s*/, '').replace(/^_/, '').replace(/_$/, '').trim();
        if (cleaned) {
          params.push({ type: 'unknown', name: cleaned });
        }
      }
    }
  }

  return params;
}

/**
 * Parse a function definition line from the documentation.
 * Handles formats:
 *   * FunctionName(*type* _param_, *type2* _param2_)
 *   * FunctionName *protected* (*type* _param_)
 *   * FunctionName *private* (*type* _param_)
 *   * FunctionName *protected-attributes* (*type* _param_)
 *   * FunctionName()
 *
 * Returns null if the line is not a function definition.
 */
function parseFunctionLine(line: string): {
  name: string;
  params: Param[];
  isProtected: boolean;
} | null {
  const trimmed = line.trim();

  // Must start with "* " followed by an identifier
  if (!trimmed.startsWith('* ')) return null;
  const rest = trimmed.slice(2);

  // Match function name, optional access modifier, and parenthesized parameter list
  // Name is a PascalCase/camelCase identifier (starts with letter, may contain digits)
  const funcMatch = rest.match(
    /^([A-Za-z_]\w*)\s*(?:\*(protected(?:-attributes)?|private)\*\s*)?\(([^)]*)\)\s*$/
  );
  if (!funcMatch) return null;

  const name = funcMatch[1];
  const accessMod = funcMatch[2] || '';
  const paramsRaw = funcMatch[3];

  const isProtected = accessMod.includes('protected') || accessMod === 'private';
  const params = parseParamList(paramsRaw);

  return { name, params, isProtected };
}

/**
 * Parse a return line like:
 *   ** _Returns:_ *type* _name_, *type2* _name2_
 */
function parseReturnLine(line: string): Param[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('** _Returns:_')) return null;

  const retPart = trimmed.slice('** _Returns:_'.length).trim();
  return parseParamList(retPart);
}

// ===== Section splitter =====

interface Section {
  name: string;
  startLine: number;
  endLine: number;
}

function findSections(lines: string[]): Section[] {
  const sections: Section[] = [];
  const sectionHeaders = [
    'VM Functions',
    'Global Variables',
    'Game API',
    'Object API',
    'Events',
    'UI XML Layout',
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const header of sectionHeaders) {
      if (lines[i].trim() === `h2. ${header}`) {
        sections.push({ name: header, startLine: i, endLine: lines.length - 1 });
      }
    }
  }

  // Fix endLine for each section to be one before the next section starts
  for (let i = 0; i < sections.length - 1; i++) {
    sections[i].endLine = sections[i + 1].startLine - 1;
  }

  return sections;
}

// ===== Main parsing logic =====

function parseFunctionsFromSection(
  lines: string[],
  startLine: number,
  endLine: number,
  sourceSection: string,
  useH3Namespaces: boolean, // true for Object API
): ParsedFunction[] {
  const functions: ParsedFunction[] = [];
  let currentNamespace: string | null = null;

  let i = startLine + 1; // skip the h2. header line
  while (i <= endLine) {
    const line = lines[i];

    // Check for h3. header (Object API section uses h3 for object names)
    if (useH3Namespaces) {
      const h3Match = line.match(/^h3\.\s+(\S+)/);
      if (h3Match) {
        currentNamespace = h3Match[1];
        i++;
        continue;
      }
    }

    // Skip non-function lines (h4, h5, inheritance description lines, blank lines)
    if (
      line.startsWith('h2.') ||
      line.startsWith('h4.') ||
      line.startsWith('h5.')
    ) {
      i++;
      continue;
    }

    // Skip lines that are object inheritance descriptions (no asterisk prefix)
    if (!line.startsWith('*')) {
      i++;
      continue;
    }

    // Skip return-only lines at top level (shouldn't happen but be safe)
    if (line.trim().startsWith('** _Returns:_')) {
      i++;
      continue;
    }

    // Try to parse as a function definition
    const parsed = parseFunctionLine(line);
    if (!parsed) {
      i++;
      continue;
    }

    // Check if the next non-blank line is a return line
    let returnValues: Param[] = [];
    let nextIdx = i + 1;
    while (nextIdx <= endLine && lines[nextIdx].trim() === '') {
      nextIdx++;
    }
    if (nextIdx <= endLine) {
      const retResult = parseReturnLine(lines[nextIdx]);
      if (retResult !== null) {
        returnValues = retResult;
        i = nextIdx + 1;
      } else {
        i++;
      }
    } else {
      i++;
    }

    // Build the signature
    const paramSig = parsed.params.map(p => `${p.type} ${p.name}`).join(', ');
    const signature = `${parsed.name}(${paramSig})`;

    // Determine namespace and category
    let ns = currentNamespace;
    const catResult = categorizeFunction(parsed.name);
    if (!ns && catResult.namespace) {
      ns = catResult.namespace;
    }

    functions.push({
      name: parsed.name,
      namespace: ns,
      category: catResult.category,
      signature,
      parameters: parsed.params,
      returnValues,
      isProtected: parsed.isProtected,
      sourceSection,
    });
  }

  return functions;
}

function parseEventsFromSection(
  lines: string[],
  startLine: number,
  endLine: number,
): ParsedEvent[] {
  const events: ParsedEvent[] = [];

  for (let i = startLine + 1; i <= endLine; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('* EVENT_')) continue;

    // Strip leading "* "
    const rest = line.slice(2);

    // Two formats:
    //   EVENT_NAME (*type* _param_, ...)
    //   EVENT_NAME
    const matchWithParams = rest.match(/^(EVENT_\w+)\s+\((.+)\)\s*$/);
    const matchNoParams = rest.match(/^(EVENT_\w+)\s*$/);

    let name: string;
    let params: Param[] = [];

    if (matchWithParams) {
      name = matchWithParams[1];
      params = parseParamList(matchWithParams[2]);
    } else if (matchNoParams) {
      name = matchNoParams[1];
    } else {
      // Fallback: try to extract event name
      const fallback = rest.match(/^(EVENT_\w+)/);
      if (fallback) {
        name = fallback[1];
        // Try to extract params from what remains
        const remainder = rest.slice(name.length).trim();
        if (remainder.startsWith('(') && remainder.endsWith(')')) {
          params = parseParamList(remainder.slice(1, -1));
        }
      } else {
        continue;
      }
    }

    const { category } = categorizeByEventName(name);
    events.push({ name, category, parameters: params });
  }

  return events;
}

// ===== Database operations =====

function importToDatabase(
  dbPath: string,
  functions: ParsedFunction[],
  events: ParsedEvent[],
): { functionsUpdated: number; functionsInserted: number; eventsUpdated: number; eventsInserted: number } {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Ensure schema is up to date (the schema.sql uses CREATE IF NOT EXISTS)
  const schemaPath = path.join(PROJECT_ROOT, 'mcp-server', 'src', 'database', 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
  }

  let functionsUpdated = 0;
  let functionsInserted = 0;
  let eventsUpdated = 0;
  let eventsInserted = 0;

  // Prepared statements for functions
  const checkFuncExists = db.prepare(`SELECT id, parameters, return_values, source_file FROM api_functions WHERE name = ?`);
  const updateFunc = db.prepare(`
    UPDATE api_functions
    SET namespace = COALESCE(?, namespace),
        category = COALESCE(?, category),
        signature = ?,
        parameters = ?,
        return_values = ?,
        is_protected = ?,
        source_file = COALESCE(source_file, ?)
    WHERE name = ?
  `);
  const insertFunc = db.prepare(`
    INSERT OR IGNORE INTO api_functions (name, namespace, category, signature, parameters, return_values, description, source_file, is_protected, api_version)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
  `);

  // For FTS sync on update, we need to handle the triggers.
  // The schema only has INSERT and DELETE triggers for FTS, not UPDATE.
  // We need to delete the old FTS entry and re-insert after update.
  const deleteFtsEntry = db.prepare(`DELETE FROM api_functions_fts WHERE rowid = ?`);
  const insertFtsEntry = db.prepare(`
    INSERT INTO api_functions_fts(rowid, name, namespace, category, description, signature)
    SELECT id, name, namespace, category, description, signature FROM api_functions WHERE id = ?
  `);

  // Prepared statements for events
  const checkEventExists = db.prepare(`SELECT id, parameters FROM api_events WHERE name = ?`);
  const updateEvent = db.prepare(`
    UPDATE api_events
    SET category = COALESCE(?, category),
        parameters = ?
    WHERE name = ?
  `);
  const insertEvent = db.prepare(`
    INSERT OR IGNORE INTO api_events (name, category, parameters, description, source_file, api_version)
    VALUES (?, ?, ?, NULL, ?, ?)
  `);

  // FTS sync for events
  const deleteEventFtsEntry = db.prepare(`DELETE FROM api_events_fts WHERE rowid = ?`);
  const insertEventFtsEntry = db.prepare(`
    INSERT INTO api_events_fts(rowid, name, category, description)
    SELECT id, name, category, description FROM api_events WHERE id = ?
  `);

  const importAll = db.transaction(() => {
    // Import functions
    for (const func of functions) {
      const paramsJson = JSON.stringify(func.parameters);
      const returnsJson = JSON.stringify(func.returnValues);
      const existing = checkFuncExists.get(func.name) as any;

      if (existing) {
        // Update existing entry with richer data from official docs
        // The official docs have typed parameters; UESP only has names
        updateFunc.run(
          func.namespace,
          func.category,
          func.signature,
          paramsJson,
          returnsJson,
          func.isProtected ? 1 : 0,
          `ESOUIDocumentation.txt:${func.sourceSection}`,
          func.name,
        );
        // Sync FTS
        deleteFtsEntry.run(existing.id);
        insertFtsEntry.run(existing.id);
        functionsUpdated++;
      } else {
        const result = insertFunc.run(
          func.name,
          func.namespace,
          func.category,
          func.signature,
          paramsJson,
          returnsJson,
          `ESOUIDocumentation.txt:${func.sourceSection}`,
          func.isProtected ? 1 : 0,
          API_VERSION,
        );
        if (result.changes > 0) {
          functionsInserted++;
        }
      }
    }

    // Import events
    for (const evt of events) {
      const paramsJson = evt.parameters.length > 0 ? JSON.stringify(evt.parameters) : null;
      const existing = checkEventExists.get(evt.name) as any;

      if (existing) {
        // Update existing event with parameter info (UESP import didn't have params)
        if (paramsJson) {
          updateEvent.run(evt.category, paramsJson, evt.name);
          // Sync FTS
          deleteEventFtsEntry.run(existing.id);
          insertEventFtsEntry.run(existing.id);
          eventsUpdated++;
        }
      } else {
        const result = insertEvent.run(
          evt.name,
          evt.category,
          paramsJson,
          'ESOUIDocumentation.txt',
          API_VERSION,
        );
        if (result.changes > 0) {
          eventsInserted++;
        }
      }
    }
  });

  importAll();

  // Update import metadata
  const setMeta = db.prepare(`
    INSERT OR REPLACE INTO import_metadata (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `);

  const funcCount = (db.prepare(`SELECT COUNT(*) as count FROM api_functions`).get() as any).count;
  const eventCount = (db.prepare(`SELECT COUNT(*) as count FROM api_events`).get() as any).count;

  setMeta.run('api_docs_imported', 'true');
  setMeta.run('api_docs_source', 'ESOUIDocumentation.txt');
  setMeta.run('api_docs_version', API_VERSION);
  setMeta.run('api_docs_import_date', new Date().toISOString());
  setMeta.run('api_functions_count', String(funcCount));
  setMeta.run('api_events_count', String(eventCount));
  setMeta.run('api_docs_functions_updated', String(functionsUpdated));
  setMeta.run('api_docs_functions_inserted', String(functionsInserted));
  setMeta.run('api_docs_events_updated', String(eventsUpdated));
  setMeta.run('api_docs_events_inserted', String(eventsInserted));

  db.close();

  return { functionsUpdated, functionsInserted, eventsUpdated, eventsInserted };
}

// ===== Main =====

async function main() {
  console.log('=== ESO API Documentation Importer ===');

  // Download ESOUIDocumentation.txt from GitHub if missing or stale
  const GITHUB_URL = 'https://raw.githubusercontent.com/esoui/esoui/live/ESOUIDocumentation.txt';
  if (!fs.existsSync(DOCS_PATH)) {
    console.log(`Documentation file not found. Downloading from GitHub...`);
    console.log(`  URL: ${GITHUB_URL}`);
    try {
      const response = await fetch(GITHUB_URL, {
        signal: AbortSignal.timeout(60000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/plain, */*',
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const text = await response.text();
      if (text.length < 10000) {
        throw new Error('Downloaded file seems too small - possible error page');
      }
      fs.mkdirSync(path.dirname(DOCS_PATH), { recursive: true });
      fs.writeFileSync(DOCS_PATH, text, 'utf-8');
      console.log(`  Downloaded ${text.length} bytes to ${DOCS_PATH}`);
    } catch (err: any) {
      console.error(`ERROR: Failed to download documentation: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.log(`Source: ${DOCS_PATH}`);
  }

  console.log(`Database: ${DB_PATH}`);
  console.log();

  const text = fs.readFileSync(DOCS_PATH, 'utf-8');
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''));
  console.log(`Read ${lines.length} lines from ESOUIDocumentation.txt`);

  // Find sections
  const sections = findSections(lines);
  console.log(`Found ${sections.length} sections:`);
  for (const s of sections) {
    console.log(`  ${s.name}: lines ${s.startLine + 1}-${s.endLine + 1}`);
  }
  console.log();

  const vmSection = sections.find(s => s.name === 'VM Functions');
  const gameApiSection = sections.find(s => s.name === 'Game API');
  const objectApiSection = sections.find(s => s.name === 'Object API');
  const eventsSection = sections.find(s => s.name === 'Events');

  if (!vmSection || !gameApiSection || !objectApiSection || !eventsSection) {
    console.error('ERROR: Could not find all required sections');
    process.exit(1);
  }

  // Parse functions from VM Functions, Game API, and Object API sections
  console.log('Parsing VM Functions...');
  const vmFunctions = parseFunctionsFromSection(
    lines, vmSection.startLine, vmSection.endLine, 'VM Functions', false
  );
  console.log(`  Found ${vmFunctions.length} functions`);

  console.log('Parsing Game API...');
  const gameApiFunctions = parseFunctionsFromSection(
    lines, gameApiSection.startLine, gameApiSection.endLine, 'Game API', false
  );
  console.log(`  Found ${gameApiFunctions.length} functions`);

  console.log('Parsing Object API...');
  const objectApiFunctions = parseFunctionsFromSection(
    lines, objectApiSection.startLine, objectApiSection.endLine, 'Object API', true
  );
  console.log(`  Found ${objectApiFunctions.length} functions`);

  const allFunctions = [...vmFunctions, ...gameApiFunctions, ...objectApiFunctions];

  // Deduplicate by name (keep last occurrence, which has richer namespace info)
  const funcMap = new Map<string, ParsedFunction>();
  for (const f of allFunctions) {
    funcMap.set(f.name, f);
  }
  const uniqueFunctions = Array.from(funcMap.values());

  console.log(`Total unique functions: ${uniqueFunctions.length}`);
  console.log(`  Protected: ${uniqueFunctions.filter(f => f.isProtected).length}`);
  console.log(`  With parameters: ${uniqueFunctions.filter(f => f.parameters.length > 0).length}`);
  console.log(`  With return values: ${uniqueFunctions.filter(f => f.returnValues.length > 0).length}`);
  console.log();

  // Parse events
  console.log('Parsing Events...');
  const events = parseEventsFromSection(
    lines, eventsSection.startLine, eventsSection.endLine
  );
  console.log(`  Found ${events.length} events`);
  console.log(`  With parameters: ${events.filter(e => e.parameters.length > 0).length}`);
  console.log();

  // Import to database
  console.log('Importing to database...');
  const result = importToDatabase(DB_PATH, uniqueFunctions, events);

  console.log();
  console.log('=== Import Complete ===');
  console.log(`Functions updated: ${result.functionsUpdated}`);
  console.log(`Functions inserted (new): ${result.functionsInserted}`);
  console.log(`Events updated (added params): ${result.eventsUpdated}`);
  console.log(`Events inserted (new): ${result.eventsInserted}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
