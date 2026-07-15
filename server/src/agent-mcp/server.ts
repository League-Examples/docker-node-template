import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerFsTools, type FsToolsOptions } from './fsTools';

/**
 * The Workspace MCP Server (architecture-001 §Module 4 / D5): a second,
 * separate `McpServer` instance from `server/src/mcp/server.ts`'s
 * existing `/api/mcp` dev-tooling endpoint (`get_version`, `list_users`).
 *
 * This instance is **never** mounted on any HTTP route or Express
 * transport -- it is constructed and connected in-process only, handed
 * directly to the Agent Runtime's turn controller (ticket 005) via an
 * in-memory MCP transport. It is the only writer path for agent-
 * initiated filesystem or catalog changes (D9).
 *
 * Ticket 002 (this ticket) registers the filesystem tool family
 * (`read_file`, `move_file`, `create_directory`, `stat`). Ticket 003
 * adds the catalog tool family on the same instance. No generic shell/
 * exec tool is ever registered here or on the dev-tooling server --
 * matching spec §9's explicit "not running full Unix commands"
 * constraint (see Security Considerations, "No shell, ever").
 */
export function createWorkspaceMcpServer(options: FsToolsOptions = {}): McpServer {
  const workspaceMcpServer = new McpServer({
    name: 'flyerbot-workspace-mcp',
    version: '0.1.0',
  });

  registerFsTools(workspaceMcpServer, options);

  return workspaceMcpServer;
}
