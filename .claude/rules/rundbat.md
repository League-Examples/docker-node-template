# rundbat — Deployment Expert MCP Server

When working on tasks that involve any of the following, use the **rundbat
MCP tools** instead of running Docker or dotconfig commands directly:

- Setting up a database (local or remote)
- Getting a database connection string
- Starting or stopping database containers
- Managing deployment environments (dev, staging, production)
- Storing or retrieving secrets and environment variables
- Checking system prerequisites (Docker, dotconfig, Node.js)

rundbat handles Docker container lifecycle, dotconfig integration, port
allocation, health checks, and stale state recovery automatically.

**Key tools:**
- `discover_system` — check what's installed
- `init_project` — set up rundbat for a new project
- `create_environment` — provision a database environment
- `get_environment_config` — get connection string (auto-restarts containers)
- `set_secret` — store encrypted secrets
- `health_check` — verify database connectivity
