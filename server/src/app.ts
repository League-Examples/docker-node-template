import path from 'path';
import express from 'express';
import session from 'express-session';
import { PrismaSessionStore } from './services/prisma-session-store';
import passport from 'passport';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { Writable } from 'stream';
import { healthRouter } from './routes/health';
import { integrationsRouter } from './routes/integrations';
import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';
import { chatRouter } from './routes/chat';
import { postcardsRouter } from './routes/postcards';
import { filesRouter } from './routes/files';
import { catalogRouter } from './routes/catalog';
import { projectsRouter } from './routes/projects';
import { impersonateMiddleware } from './middleware/impersonate';
import { mcpTokenAuth } from './middleware/mcpAuth';
import { createMcpHandler } from './mcp/handler';
import { errorHandler } from './middleware/errorHandler';
import { attachServices } from './middleware/services';
import { ServiceRegistry } from './services/service.registry';
import { logBuffer } from './services/logBuffer';
import { prisma } from './services/prisma';

const app = express();

// Trust first proxy (Caddy in production, Vite in dev)
app.set('trust proxy', 1);

// HISTORICAL (sprint 002 ticket 002): tests used to call `request(app)` /
// `request.agent(app)` directly, which makes supertest spin up a brand-new
// ephemeral `http.Server` per call — hundreds of times within a single test
// file's process — and tear it down right after via `server.close()`.
// Node's HTTP keep-alive is on by default, so a socket from a just-closed
// ephemeral server can briefly outlive it; under the very fast, very high
// churn rate the suite produced (many ephemeral loopback listeners bound/
// closed per second), that was a plausible contributor to the suite's
// intermittent cross-request corruption (occasionally observed as "Parse
// Error: Expected HTTP/", "socket hang up", or a response that didn't match
// the request that was sent). Forcing `Connection: close` in test mode
// stopped the application from advertising a socket as reusable, removing
// one plausible source of the reuse window — but applying that alone did
// NOT eliminate the suite's flakiness; the deeper, structural cause was
// supertest creating one ephemeral server per assertion instead of one
// persistent server per file.
//
// RESOLVED (sprint 013 ticket 001): every `tests/server/*.test.ts` file now
// creates and `.listen()`s exactly one `http.Server` per file (see
// `tests/server/helpers/testServer.ts`) and passes that persistent server
// to every `request()`/`request.agent()` call, instead of the bare `app`.
// That removes the per-call ephemeral-server churn entirely, so this
// middleware is now redundant in practice — left in place anyway as
// harmless, defense-in-depth hardening (a test-mode-only response header),
// not because it is still load-bearing.
if (process.env.NODE_ENV === 'test') {
  app.use((_req, res, next) => {
    res.set('Connection', 'close');
    next();
  });
}

app.use(express.json());

// Pino logger: writes to stdout and in-memory ring buffer for the admin log viewer.
const logLevel = process.env.NODE_ENV === 'test' ? 'silent' : (process.env.LOG_LEVEL || 'info');
const bufferStream = new Writable({
  write(chunk, _encoding, callback) {
    logBuffer.ingest(chunk.toString());
    callback();
  },
});
const logger = pino(
  { level: logLevel },
  pino.multistream([
    { stream: process.stdout },
    { stream: bufferStream },
  ]),
);

app.use(pinoHttp({ logger }));

// Session middleware — Prisma-based store works on both SQLite and Postgres.
// Falls back to MemoryStore in test environment.
const sessionConfig: session.SessionOptions = {
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    httpOnly: true,
  },
};

if (process.env.NODE_ENV !== 'test') {
  sessionConfig.store = new PrismaSessionStore(prisma);
}

app.use(session(sessionConfig));

// Passport authentication
passport.serializeUser((user: any, done) => {
  done(null, user.id);
});
passport.deserializeUser(async (id: number, done) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id },
    });
    done(null, user);
  } catch (err) {
    done(err);
  }
});
app.use(passport.initialize());
app.use(passport.session());
app.use(impersonateMiddleware);

// Service registry — provides req.services to all route handlers
const registry = ServiceRegistry.create('API');
app.use(attachServices(registry));

// Routes
app.use('/api', healthRouter);
app.use('/api', integrationsRouter);
app.use('/api', authRouter);
app.use('/api', adminRouter);
app.use('/api', chatRouter);
app.use('/api', postcardsRouter);
app.use('/api', filesRouter);
app.use('/api', catalogRouter);
app.use('/api', projectsRouter);

// MCP endpoint — token-based auth, separate from session auth
app.post('/api/mcp', mcpTokenAuth, createMcpHandler());

app.use(errorHandler);

// In production, serve the built React app from /app/public.
// All non-API routes fall through to index.html for SPA routing.
if (process.env.NODE_ENV === 'production') {
  const publicDir = path.resolve(process.cwd(), 'public');
  app.use(express.static(publicDir));
  app.get('*', (_req: express.Request, res: express.Response) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

export { registry };
export default app;
