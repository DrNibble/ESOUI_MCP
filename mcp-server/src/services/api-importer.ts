/**
 * Auto-imports ESO API data from UESP on first server start.
 * Data is cached in SQLite - subsequent starts skip the import.
 * Uses native fetch with browser-like headers.
 */

import { db } from '../database/db.js';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const UESP_BASE = 'https://esoapi.uesp.net/current';
const GLOBAL_FUNCS_URL = `${UESP_BASE}/globalfuncs.txt`;
const GLOBALS_URL = `${UESP_BASE}/globals.txt`;

/**
 * Fetch a URL using native fetch with browser-like headers.
 * Falls back to a retry on transient errors.
 */
async function fetchWithCloudflareBypass(url: string): Promise<string> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/plain, text/html, */*',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(60000) });

    if (response.ok) {
      const text = await response.text();
      // Check if we got Cloudflare challenge HTML instead of actual content
      if (text.includes('challenge-platform') || text.includes('Just a moment')) {
        console.error(`Cloudflare challenge detected for ${url}`);
        throw new Error(`Cloudflare challenge at ${url} — cannot bypass without a browser engine`);
      }
      return text;
    }

    throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
  } catch {
    // Retry once with a delay
    console.error(`First fetch failed for ${url}, retrying...`);
    await new Promise(r => setTimeout(r, 3000));

    const retryResponse = await fetch(url, { headers, signal: AbortSignal.timeout(60000) });
    if (retryResponse.ok) {
      const text = await retryResponse.text();
      if (text.includes('challenge-platform') || text.includes('Just a moment')) {
        throw new Error(`Cloudflare challenge at ${url} — cannot bypass without a browser engine`);
      }
      return text;
    }
    throw new Error(`HTTP ${retryResponse.status} ${retryResponse.statusText} for ${url}`);
  }
}

// Category mapping based on function name prefixes
function categorizeFunction(name: string): { category: string; namespace?: string } {
  // Event constants
  if (name.startsWith('EVENT_')) return { category: 'Events', namespace: 'EVENT' };

  // String IDs
  if (name.startsWith('SI_')) return { category: 'StringIds', namespace: 'SI' };

  // Ability/Combat
  if (name.startsWith('ABILITY_')) return { category: 'Combat', namespace: 'ABILITY' };
  if (name.startsWith('COMBAT_')) return { category: 'Combat', namespace: 'COMBAT' };
  if (name.startsWith('ACTION_')) return { category: 'Combat', namespace: 'ACTION' };
  if (name.startsWith('DAMAGE_')) return { category: 'Combat', namespace: 'DAMAGE' };
  if (name.startsWith('BUFF_')) return { category: 'Combat', namespace: 'BUFF' };

  // Inventory / Items
  if (name.startsWith('BAG_')) return { category: 'Inventory', namespace: 'BAG' };
  if (name.startsWith('SLOT_')) return { category: 'Inventory', namespace: 'SLOT' };
  if (name.startsWith('ITEM_')) return { category: 'Items', namespace: 'ITEM' };
  if (name.startsWith('EQUIP_')) return { category: 'Items', namespace: 'EQUIP' };
  if (name.startsWith('ITEMTYPE_')) return { category: 'Items', namespace: 'ITEMTYPE' };
  if (name.startsWith('ENCHANT_')) return { category: 'Items', namespace: 'ENCHANT' };
  if (name.startsWith('TRAIT_')) return { category: 'Items', namespace: 'TRAIT' };

  // Crafting
  if (name.startsWith('CRAFTING_')) return { category: 'Crafting', namespace: 'CRAFTING' };
  if (name.startsWith('SMITHING_')) return { category: 'Crafting', namespace: 'SMITHING' };
  if (name.startsWith('PROVISIONER_')) return { category: 'Crafting', namespace: 'PROVISIONER' };

  // UI
  if (name.startsWith('CT_')) return { category: 'UI', namespace: 'CT' };
  if (name.startsWith('GUI_')) return { category: 'UI', namespace: 'GUI' };
  if (name.startsWith('ANCHOR_')) return { category: 'UI', namespace: 'ANCHOR' };
  if (name.startsWith('TEXT_')) return { category: 'UI', namespace: 'TEXT' };
  if (name.startsWith('KEY_')) return { category: 'UI', namespace: 'KEY' };

  // ZOS UI Framework
  if (name.startsWith('ZO_')) return { category: 'ZOS_Framework', namespace: 'ZO' };

  // Map / Navigation
  if (name.startsWith('MAP_')) return { category: 'Map', namespace: 'MAP' };
  if (name.startsWith('ZONE_')) return { category: 'Map', namespace: 'ZONE' };

  // Guild
  if (name.startsWith('GUILD_')) return { category: 'Guild', namespace: 'GUILD' };

  // Champion
  if (name.startsWith('CHAMPION_')) return { category: 'Champion', namespace: 'CHAMPION' };

  // Housing
  if (name.startsWith('HOUSING_')) return { category: 'Housing', namespace: 'HOUSING' };
  if (name.startsWith('FURNITURE_')) return { category: 'Housing', namespace: 'FURNITURE' };

  // PvP / Campaigns
  if (name.startsWith('CAMPAIGN_')) return { category: 'PvP', namespace: 'CAMPAIGN' };
  if (name.startsWith('BATTLEGROUND_')) return { category: 'PvP', namespace: 'BATTLEGROUND' };

  // Social
  if (name.startsWith('CHAT_')) return { category: 'Social', namespace: 'CHAT' };
  if (name.startsWith('FRIEND_')) return { category: 'Social', namespace: 'FRIEND' };
  if (name.startsWith('MAIL_')) return { category: 'Social', namespace: 'MAIL' };

  // Quest
  if (name.startsWith('QUEST_')) return { category: 'Quest', namespace: 'QUEST' };
  if (name.startsWith('OBJECTIVE_')) return { category: 'Quest', namespace: 'OBJECTIVE' };

  // Character / Unit
  if (name.startsWith('UNIT_')) return { category: 'Character', namespace: 'UNIT' };
  if (name.startsWith('ATTRIBUTE_')) return { category: 'Character', namespace: 'ATTRIBUTE' };
  if (name.startsWith('SKILL_')) return { category: 'Character', namespace: 'SKILL' };
  if (name.startsWith('CLASS_')) return { category: 'Character', namespace: 'CLASS' };
  if (name.startsWith('RACE_')) return { category: 'Character', namespace: 'RACE' };

  // Collectibles / Collections
  if (name.startsWith('COLLECTIBLE_')) return { category: 'Collections', namespace: 'COLLECTIBLE' };
  if (name.startsWith('COLLECTION_')) return { category: 'Collections', namespace: 'COLLECTION' };

  // Sound / Audio
  if (name.startsWith('SOUNDS')) return { category: 'Audio', namespace: 'SOUNDS' };

  // Scene
  if (name.startsWith('SCENE_')) return { category: 'Scenes', namespace: 'SCENE' };

  // Function-style categorization
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

/**
 * UESP globalfuncs.txt actual format:
 *   FunctionName(param1, param2) = 'address'
 *   \tsource/file.lua:123 -- function(param1, param2)
 *   \tsource/file2.lua:456 -- function(param1, param2)
 *
 * Lines starting with a letter are function definitions.
 * Indented lines below are source file references.
 */

/**
 * Fetch and import global functions from UESP
 */
async function importGlobalFunctions(): Promise<number> {
  console.error('Fetching ESO API functions from UESP...');

  const text = await fetchWithCloudflareBypass(GLOBAL_FUNCS_URL);
  const lines = text.split('\n');

  let importedCount = 0;

  // Parse format: "FunctionName(params) = 'address'" on non-indented lines
  // Indented lines below are source references: "\tsource/file.lua:123 -- function(...)"
  let currentFunc: { name: string; signature: string; params: string; sourceFiles: string[] } | null = null;

  db.transaction(() => {
    for (const line of lines) {
      // Function definition line: starts with a letter, contains (...)
      const funcMatch = line.match(/^([A-Za-z_]\w*)\(([^)]*)\)\s*=/);
      if (funcMatch) {
        // Save previous function
        if (currentFunc) {
          saveParsedFunction(currentFunc);
          importedCount++;
        }

        currentFunc = {
          name: funcMatch[1],
          signature: `${funcMatch[1]}(${funcMatch[2]})`,
          params: funcMatch[2],
          sourceFiles: [],
        };
        continue;
      }

      // Source reference line (indented with tab)
      if (line.startsWith('\t') && currentFunc) {
        const sourceMatch = line.trim().match(/^(\S+\.lua:\d+)/);
        if (sourceMatch && currentFunc.sourceFiles.length < 3) {
          currentFunc.sourceFiles.push(sourceMatch[1]);
        }
      }
    }

    // Save last function
    if (currentFunc) {
      saveParsedFunction(currentFunc);
      importedCount++;
    }
  });

  function saveParsedFunction(func: { name: string; signature: string; params: string; sourceFiles: string[] }) {
    const { category, namespace } = categorizeFunction(func.name);

    // Parse parameter names from signature
    const parameters: Array<{ name: string }> = [];
    if (func.params.trim()) {
      const paramNames = func.params.split(',').map(p => p.trim()).filter(Boolean);
      for (const p of paramNames) {
        parameters.push({ name: p });
      }
    }

    db.insertApiFunction({
      name: func.name,
      namespace: namespace || null,
      category,
      signature: func.signature,
      parameters: JSON.stringify(parameters),
      return_values: '[]',
      description: null,
      source_file: func.sourceFiles[0] || null,
      is_protected: false,
      api_version: '101047',
    });
  }

  return importedCount;
}

/**
 * Fetch and import globals (constants, events, etc.) from UESP
 */
async function importGlobals(): Promise<{ events: number; constants: number }> {
  console.error('Fetching ESO globals from UESP...');

  const text = await fetchWithCloudflareBypass(GLOBALS_URL);
  const lines = text.split('\n');

  let eventCount = 0;
  let constantCount = 0;

  db.transaction(() => {
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Parse global entries - format varies:
      // EVENT_NAME = number
      // CONSTANT_NAME = value
      // objectName.property = value
      const assignMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
      if (!assignMatch) continue;

      const name = assignMatch[1];
      const value = assignMatch[2].trim();

      // Events
      if (name.startsWith('EVENT_')) {
        const { category } = categorizeByEventName(name);
        db.insertApiEvent({
          name,
          category,
          parameters: null,
          description: null,
          source_file: null,
          api_version: '101047',
        });
        eventCount++;
        continue;
      }

      // Skip SI_ strings (too many, not useful for addon dev)
      if (name.startsWith('SI_')) continue;

      // Constants
      const { category, namespace } = categorizeFunction(name);
      const valueType = /^\d+$/.test(value) ? 'number' :
                        /^true|false$/.test(value) ? 'boolean' : 'string';

      // Determine group name (first part before underscore pattern)
      const groupMatch = name.match(/^([A-Z]+(?:_[A-Z]+)?)/);
      const groupName = groupMatch ? groupMatch[1] : undefined;

      db.insertApiConstant({
        name,
        group_name: groupName || namespace || null,
        value,
        value_type: valueType,
        description: null,
      });
      constantCount++;
    }
  });

  return { events: eventCount, constants: constantCount };
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

/**
 * Import some well-known UI control types
 */
function importUIControls(): void {
  const controls = [
    { control_type: 'CT_TOPLEVELCONTROL', xml_element: 'TopLevelControl', parent_type: null, description: 'Top-level container for addon windows', methods: JSON.stringify(['SetHidden', 'SetAlpha', 'SetDimensions', 'SetAnchor', 'ClearAnchors', 'SetMovable', 'SetMouseEnabled', 'SetClampedToScreen', 'SetDrawLayer', 'SetDrawLevel', 'SetDrawTier', 'GetWidth', 'GetHeight', 'GetLeft', 'GetTop', 'SetResizeHandleSize']), properties: JSON.stringify(['hidden', 'alpha', 'movable', 'mouseEnabled', 'clampedToScreen']), events: JSON.stringify(['OnMoveStop', 'OnResizeStart', 'OnResizeStop', 'OnShow', 'OnHide', 'OnMouseEnter', 'OnMouseExit', 'OnMouseDown', 'OnMouseUp']) },
    { control_type: 'CT_CONTROL', xml_element: 'Control', parent_type: null, description: 'Base control type - all other controls inherit from this', methods: JSON.stringify(['SetHidden', 'SetAlpha', 'SetDimensions', 'SetAnchor', 'ClearAnchors', 'SetParent', 'GetParent', 'GetName', 'GetWidth', 'GetHeight', 'SetWidth', 'SetHeight', 'IsHidden', 'SetMouseEnabled', 'SetDrawLayer', 'SetDrawLevel']), properties: JSON.stringify(['hidden', 'alpha', 'mouseEnabled', 'inheritAlpha']), events: JSON.stringify(['OnShow', 'OnHide', 'OnMouseEnter', 'OnMouseExit', 'OnUpdate', 'OnEffectivelyShown', 'OnEffectivelyHidden']) },
    { control_type: 'CT_LABEL', xml_element: 'Label', parent_type: 'CT_CONTROL', description: 'Text display control', methods: JSON.stringify(['SetText', 'GetText', 'SetFont', 'SetColor', 'SetHorizontalAlignment', 'SetVerticalAlignment', 'SetWrapMode', 'SetMaxLineCount', 'SetLineSpacing', 'SetModifyTextType', 'SetStyleColor', 'GetTextWidth', 'GetTextHeight', 'GetNumLines']), properties: JSON.stringify(['text', 'font', 'color', 'horizontalAlignment', 'verticalAlignment', 'wrapMode']), events: JSON.stringify(['OnTextChanged', 'OnLinkMouseUp', 'OnLinkClicked']) },
    { control_type: 'CT_BUTTON', xml_element: 'Button', parent_type: 'CT_CONTROL', description: 'Clickable button control', methods: JSON.stringify(['SetText', 'GetText', 'SetFont', 'SetNormalTexture', 'SetPressedTexture', 'SetMouseOverTexture', 'SetDisabledTexture', 'SetClickSound', 'SetState', 'GetState', 'SetEnabled', 'SetNormalFontColor', 'SetMouseOverFontColor', 'SetDisabledFontColor']), properties: JSON.stringify(['text', 'font', 'normalColor', 'state', 'enabled']), events: JSON.stringify(['OnClicked', 'OnMouseEnter', 'OnMouseExit', 'OnMouseDown', 'OnMouseUp']) },
    { control_type: 'CT_EDITBOX', xml_element: 'EditBox', parent_type: 'CT_CONTROL', description: 'Text input field', methods: JSON.stringify(['SetText', 'GetText', 'SetFont', 'SetColor', 'SetMaxInputChars', 'SetMultiLine', 'SetEditEnabled', 'SelectAll', 'TakeFocus', 'LoseFocus', 'HasFocus', 'InsertText', 'SetCursorPosition', 'GetCursorPosition']), properties: JSON.stringify(['text', 'font', 'maxInputChars', 'multiLine', 'editEnabled']), events: JSON.stringify(['OnTextChanged', 'OnEnter', 'OnEscape', 'OnFocusGained', 'OnFocusLost', 'OnMouseDoubleClick']) },
    { control_type: 'CT_TEXTURE', xml_element: 'Texture', parent_type: 'CT_CONTROL', description: 'Image/texture display control', methods: JSON.stringify(['SetTexture', 'GetTextureFileName', 'SetTextureCoords', 'SetColor', 'SetVertexColors', 'SetDesaturation', 'SetBlendMode', 'SetTextureRotation', 'SetPixelRoundingEnabled']), properties: JSON.stringify(['textureFile', 'color', 'desaturation', 'blendMode']), events: JSON.stringify([]) },
    { control_type: 'CT_BACKDROP', xml_element: 'Backdrop', parent_type: 'CT_CONTROL', description: 'Background/border container', methods: JSON.stringify(['SetCenterColor', 'SetEdgeColor', 'SetCenterTexture', 'SetEdgeTexture', 'SetInsets', 'SetIntegralWrapping']), properties: JSON.stringify(['centerColor', 'edgeColor']), events: JSON.stringify([]) },
    { control_type: 'CT_SCROLL', xml_element: 'Scroll', parent_type: 'CT_CONTROL', description: 'Scrollable container', methods: JSON.stringify(['SetScrollExtents', 'GetScrollExtents', 'SetVerticalScroll', 'SetHorizontalScroll', 'GetVerticalScroll', 'GetHorizontalScroll', 'SetFadeGradient']), properties: JSON.stringify(['scrollExtents']), events: JSON.stringify(['OnScrollOffsetChanged', 'OnScrollExtentsChanged']) },
    { control_type: 'CT_SLIDER', xml_element: 'Slider', parent_type: 'CT_CONTROL', description: 'Value slider control', methods: JSON.stringify(['SetMinMax', 'SetValue', 'GetValue', 'SetValueStep', 'SetOrientation', 'GetMinMax', 'SetEnabled', 'SetThumbTexture', 'SetBackgroundMiddleTexture']), properties: JSON.stringify(['min', 'max', 'value', 'step', 'orientation']), events: JSON.stringify(['OnValueChanged', 'OnSliderReleased']) },
    { control_type: 'CT_STATUSBAR', xml_element: 'StatusBar', parent_type: 'CT_CONTROL', description: 'Progress/health bar control', methods: JSON.stringify(['SetMinMax', 'SetValue', 'GetValue', 'SetColor', 'SetGradientColors', 'SetBarAlignment', 'EnableLeadingEdge', 'GetMinMax']), properties: JSON.stringify(['min', 'max', 'value', 'color']), events: JSON.stringify(['OnValueChanged']) },
    { control_type: 'CT_COOLDOWN', xml_element: 'Cooldown', parent_type: 'CT_CONTROL', description: 'Cooldown animation overlay', methods: JSON.stringify(['StartCooldown', 'ResetCooldown', 'SetTexture', 'SetFillColor', 'SetDesaturation', 'SetPercentCompleteFixed', 'GetPercentCompleteFixed']), properties: JSON.stringify(['fillColor', 'desaturation']), events: JSON.stringify(['OnCooldownComplete']) },
    { control_type: 'CT_TOOLTIP', xml_element: 'Tooltip', parent_type: 'CT_TOPLEVELCONTROL', description: 'Tooltip popup control', methods: JSON.stringify(['SetOwner', 'ClearLines', 'AddLine', 'AddHeaderLine', 'AddVerticalPadding', 'SetFont', 'GetOwner', 'SetHidden']), properties: JSON.stringify(['font']), events: JSON.stringify([]) },
    { control_type: 'CT_MAPDISPLAY', xml_element: 'MapDisplay', parent_type: 'CT_CONTROL', description: 'Map rendering control', methods: JSON.stringify(['SetZoom', 'GetZoom', 'SetPanAndZoom', 'GetCurrentNormalizedZoom', 'SetMapId']), properties: JSON.stringify([]), events: JSON.stringify(['OnZoomChanged']) },
  ];

  db.transaction(() => {
    for (const ctrl of controls) {
      db.insertUiControl(ctrl);
    }
  });
}

/**
 * Main entry point - check if data exists, import if not
 */
export async function ensureApiDataLoaded(): Promise<void> {
  const imported = db.getImportMetadata('api_data_imported');

  if (imported) {
    const funcCount = db.getApiFunctionCount();
    const eventCount = db.getApiEventCount();
    console.error(`API data already loaded: ${funcCount} functions, ${eventCount} events`);
    return;
  }

  // Try loading from our own bundled JSON first (fastest, no network needed)
  const bundledJsonPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'api', 'eso-api-reference.json');
  if (existsSync(bundledJsonPath)) {
    console.error('Loading API data from bundled eso-api-reference.json...');
    try {
      const jsonData = JSON.parse(readFileSync(bundledJsonPath, 'utf-8'));
      let funcCount = 0;
      let eventCount = 0;

      db.transaction(() => {
        for (const func of jsonData.functions || []) {
          db.insertApiFunction({
            name: func.name,
            namespace: func.namespace || null,
            category: func.category || null,
            signature: func.signature || null,
            parameters: func.parameters || null,
            return_values: func.return_values || null,
            description: func.description || null,
            source_file: func.source_file || null,
            is_protected: func.is_protected || false,
            api_version: func.api_version || null,
          });
          funcCount++;
        }
        for (const evt of jsonData.events || []) {
          db.insertApiEvent({
            name: evt.name,
            category: evt.category || null,
            parameters: evt.parameters || null,
            description: evt.description || null,
            source_file: evt.source_file || null,
            api_version: evt.api_version || null,
          });
          eventCount++;
        }
      });

      importUIControls();

      db.setImportMetadata('api_data_imported', 'true');
      db.setImportMetadata('api_data_source', 'bundled eso-api-reference.json');
      db.setImportMetadata('api_data_import_date', new Date().toISOString());
      db.setImportMetadata('api_functions_count', String(funcCount));
      db.setImportMetadata('api_events_count', String(eventCount));

      console.error(`Loaded ${funcCount} functions, ${eventCount} events from bundled data`);
      return;
    } catch (e) {
      console.error('Bundled JSON load failed, falling back to UESP...', e instanceof Error ? e.message : e);
    }
  }

  console.error('First start detected - importing ESO API data from UESP...');
  console.error('This may take a minute. Subsequent starts will be instant.');

  try {
    // Import functions from UESP
    const funcCount = await importGlobalFunctions();
    console.error(`Imported ${funcCount} API functions`);

    // Import globals (events + constants)
    const { events, constants } = await importGlobals();
    console.error(`Imported ${events} events and ${constants} constants`);

    // Import UI controls (built-in data)
    importUIControls();
    console.error('Imported UI control definitions');

    // Mark as imported
    db.setImportMetadata('api_data_imported', 'true');
    db.setImportMetadata('api_data_source', 'UESP esoapi.uesp.net');
    db.setImportMetadata('api_data_version', '101047');
    db.setImportMetadata('api_data_import_date', new Date().toISOString());
    db.setImportMetadata('api_functions_count', String(funcCount));
    db.setImportMetadata('api_events_count', String(events));
    db.setImportMetadata('api_constants_count', String(constants));

    console.error('API data import complete!');
  } catch (error) {
    console.error('API data import failed:', error instanceof Error ? error.message : error);
    throw error;
  }
}
