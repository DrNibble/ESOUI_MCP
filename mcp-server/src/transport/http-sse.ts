/**
 * HTTP/SSE Transport for the ESO MCP Server.
 *
 * Exposes the MCP server over HTTP using the SSE (Server-Sent Events) transport
 * from the MCP SDK. This allows remote clients to connect to the server via
 * an HTTP endpoint instead of stdio.
 *
 * Usage:
 *   node dist/index.js --http              # default port 3000, host 0.0.0.0
 *   node dist/index.js --http --port 8080  # custom port
 *   node dist/index.js --http --host 127.0.0.1 --port 9000
 *
 * Endpoints:
 *   GET  /sse          - Establish SSE connection
 *   POST /sse          - Send messages to the server (same path as SSE endpoint)
 *
 * Also supports Streamable HTTP transport:
 *   GET  /mcp          - SSE stream (Streamable HTTP)
 *   POST /mcp          - JSON-RPC request (Streamable HTTP)
 *   DELETE /mcp        - Close session
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { db } from '../database/db.js';

export interface HttpSseOptions {
  port?: number;
  host?: string;
  mode?: 'sse' | 'streamable';
}

export function startHttpSseServer(
  server: Server,
  options: HttpSseOptions = {}
): void {
  const port = options.port ?? 3000;
  const host = options.host ?? '0.0.0.0';
  const mode = options.mode ?? 'sse';

  // Session management for SSE transport
  const sseSessions = new Map<string, SSEServerTransport>();
  // Session management for Streamable HTTP transport
  const streamableSessions = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${host}:${port}`);
    const pathname = url.pathname;

    // Health check endpoint
    if (pathname === '/health' || pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        server: 'eso-addon-dev-assistant',
        transport: mode,
      }));
      return;
    }

    if (mode === 'sse') {
      await handleSseRequest(server, req, res, sseSessions);
    } else {
      await handleStreamableRequest(server, req, res, streamableSessions);
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    console.error('Shutting down HTTP/SSE server...');
    // Close all SSE sessions
    for (const [sessionId, transport] of sseSessions) {
      transport.close().catch(() => {});
      sseSessions.delete(sessionId);
    }
    // Close all Streamable HTTP sessions
    for (const [sessionId, transport] of streamableSessions) {
      transport.close().catch(() => {});
      streamableSessions.delete(sessionId);
    }
    try {
      db.close();
    } catch { /* ignore */ }
    httpServer.close(() => {
      process.exit(0);
    });
    // Force exit after 2 seconds if close hangs
    setTimeout(() => process.exit(0), 2000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  httpServer.listen(port, host, () => {
    console.error(`ESO MCP server (HTTP/${mode.toUpperCase()}) listening on http://${host}:${port}`);
    if (mode === 'sse') {
      console.error(`  SSE endpoint:  http://${host}:${port}/sse`);
    } else {
      console.error(`  MCP endpoint:  http://${host}:${port}/mcp`);
    }
    console.error(`  Health check:  http://${host}:${port}/health`);
  });
}

// ---- SSE Transport Handler ----

async function handleSseRequest(
  server: Server,
  req: IncomingMessage,
  res: ServerResponse,
  sessions: Map<string, SSEServerTransport>
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/sse') {
    // Establish new SSE connection
    const sessionId = randomUUID();
    const transport = new SSEServerTransport('/sse', res);
    sessions.set(sessionId, transport);

    transport.onclose = () => {
      sessions.delete(sessionId);
      console.error(`SSE session ${sessionId} closed`);
    };

    try {
      await server.connect(transport);
      console.error(`SSE session ${sessionId} established`);
    } catch (err) {
      console.error(`Failed to connect SSE session ${sessionId}:`, err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal server error');
      }
      sessions.delete(sessionId);
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/sse') {
    // Handle incoming message from client
    const sessionId = url.searchParams.get('sessionId');

    if (sessionId && sessions.has(sessionId)) {
      const transport = sessions.get(sessionId)!;
      await transport.handlePostMessage(req, res);
    } else {
      // Try all sessions if no sessionId specified (backward compat)
      // Or find the session by looking at the transport
      let handled = false;
      for (const transport of sessions.values()) {
        try {
          await transport.handlePostMessage(req, res);
          handled = true;
          break;
        } catch {
          // continue to next session
        }
      }
      if (!handled && !res.headersSent) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('No valid session found');
      }
    }
    return;
  }

  // Unknown route
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

// ---- Streamable HTTP Transport Handler ----

async function handleStreamableRequest(
  server: Server,
  req: IncomingMessage,
  res: ServerResponse,
  sessions: Map<string, StreamableHTTPServerTransport>
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;

  if (pathname !== '/mcp') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  // Check for session ID in headers
  const sessionIdHeader = req.headers['mcp-session-id'] as string | undefined;

  if (req.method === 'POST') {
    // Handle JSON-RPC request
    if (sessionIdHeader && sessions.has(sessionIdHeader)) {
      // Existing session
      const transport = sessions.get(sessionIdHeader)!;
      await transport.handleRequest(req, res);
    } else {
      // New session - check if this is an initialize request
      let body = '';
      for await (const chunk of req) {
        body += chunk;
      }

      try {
        const parsed = JSON.parse(body);
        if (parsed.method === 'initialize') {
          // Create new transport for new session
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
          });

          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid) {
              sessions.delete(sid);
              console.error(`Streamable HTTP session ${sid} closed`);
            }
          };

          await server.connect(transport);

          // Get the session ID from the transport
          const newSessionId = transport.sessionId;
          if (newSessionId) {
            sessions.set(newSessionId, transport);
            console.error(`Streamable HTTP session ${newSessionId} established`);
          }

          // Handle the request
          await transport.handleRequest(req, res, parsed);
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Missing or invalid session ID' },
            id: parsed.id ?? null,
          }));
        }
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32700, message: 'Parse error' },
          id: null,
        }));
      }
    }
    return;
  }

  if (req.method === 'GET') {
    // SSE stream for server-to-client messages
    if (sessionIdHeader && sessions.has(sessionIdHeader)) {
      const transport = sessions.get(sessionIdHeader)!;
      await transport.handleRequest(req, res);
    } else {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing or invalid session ID');
    }
    return;
  }

  if (req.method === 'DELETE') {
    // Close session
    if (sessionIdHeader && sessions.has(sessionIdHeader)) {
      const transport = sessions.get(sessionIdHeader)!;
      await transport.close();
      sessions.delete(sessionIdHeader);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Session closed');
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Session not found');
    }
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain' });
  res.end('Method not allowed');
}
