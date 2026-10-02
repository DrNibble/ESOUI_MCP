#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ToolModule } from './types/tool-types.js';
import { db } from './database/db.js';

// Import tool modules
import { setsModule } from './tools/sets.js';
import { charactersModule } from './tools/characters.js';
import { apiReferenceModule } from './tools/api-reference.js';
import { addonScaffoldModule } from './tools/addon-scaffold.js';
import { codeGenerationModule } from './tools/code-generation.js';
import { savedVarsToolsModule } from './tools/savedvars-tools.js';
import { addonAnalysisModule } from './tools/addon-analysis.js';
import { esoDataModule } from './tools/eso-data.js';
import { addonRulesModule } from './tools/addon-rules.js';
import { updaterModule } from './tools/updater.js';

// Import auto-import service
import { ensureApiDataLoaded } from './services/api-importer.js';

// Import HTTP/SSE transport
import { startHttpSseServer } from './transport/http-sse.js';

const server = new Server(
  {
    name: 'eso-addon-dev-assistant',
    version: '3.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register all tool modules
const modules: ToolModule[] = [
  setsModule,
  charactersModule,
  apiReferenceModule,
  addonScaffoldModule,
  codeGenerationModule,
  savedVarsToolsModule,
  addonAnalysisModule,
  esoDataModule,
  addonRulesModule,
  updaterModule,
];

// Build lookup map: tool name -> module handler
const toolHandlerMap = new Map<string, ToolModule['handler']>();
for (const mod of modules) {
  for (const def of mod.definitions) {
    toolHandlerMap.set(def.name, mod.handler);
  }
}

// List all tools from all modules
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = modules.flatMap((mod) => mod.definitions);
  return { tools };
});

// Route tool calls to the correct module
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const handler = toolHandlerMap.get(name);
  if (!handler) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    return await handler(name, args);
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// Parse CLI arguments
function parseArgs(): { http: boolean; port: number; host: string; mode: 'sse' | 'streamable' } {
  const args = process.argv.slice(2);
  const http = args.includes('--http') || args.includes('-H') || process.env.MCP_TRANSPORT === 'http';
  const portIdx = args.indexOf('--port');
  const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : parseInt(process.env.MCP_PORT || '3000', 10);
  const hostIdx = args.indexOf('--host');
  const host = hostIdx !== -1 ? args[hostIdx + 1] : (process.env.MCP_HOST || '0.0.0.0');
  const modeIdx = args.indexOf('--mode');
  const mode = (modeIdx !== -1 ? args[modeIdx + 1] : (process.env.MCP_MODE || 'sse')) as 'sse' | 'streamable';

  return { http, port, host, mode };
}

async function main() {
  // Auto-import API data on first start
  try {
    await ensureApiDataLoaded();
  } catch (error) {
    console.error('Warning: API data auto-import failed:', error instanceof Error ? error.message : error);
    console.error('Server will start without API reference data. You can try restarting later.');
  }

  const { http, port, host, mode } = parseArgs();

  if (http) {
    // HTTP/SSE mode
    startHttpSseServer(server, { port, host, mode });
  } else {
    // Default: stdio mode
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('ESO Addon Development Assistant MCP server running on stdio');
    console.error(`Registered ${toolHandlerMap.size} tools from ${modules.length} modules`);
  }
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});

// Graceful shutdown - ensure DB is properly closed (for stdio mode)
function shutdown() {
  console.error('Shutting down ESO MCP server...');
  try {
    db.close();
  } catch { /* ignore */ }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
