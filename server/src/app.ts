import express from 'express';
import session from 'express-session';
import pgSimple from 'connect-pg-simple';
import passport from 'passport';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { Writable } from 'stream';
import { healthRouter } from './routes/health';
import { counterRouter } from './routes/counter';
import { integrationsRouter } from './routes/integrations';
import { authRouter } from './routes/auth';
import { pike13Router } from './routes/pike13';
import { githubRouter } from './routes/github';
import { adminRouter } from './routes/admin';
import { errorHandler } from './middleware/errorHandler';
import { logBuffer } from './services/logBuffer';

const app = express();

// Trust first proxy (Caddy in production, Vite in dev)
app.set('trust proxy', 1);

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

// Session middleware — PostgreSQL store for persistence across restarts.
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

if (process.env.NODE_ENV !== 'test' && process.env.DATABASE_URL) {
  const PgStore = pgSimple(session);
  sessionConfig.store = new PgStore({
    conString: process.env.DATABASE_URL,
    // Table created by Prisma migration, not auto-created here.
  });
}

app.use(session(sessionConfig));

// Passport authentication
passport.serializeUser((user: Express.User, done) => {
  done(null, user);
});
passport.deserializeUser((user: Express.User, done) => {
  done(null, user);
});
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use('/api', healthRouter);
app.use('/api', counterRouter);
app.use('/api', integrationsRouter);
app.use('/api', authRouter);
app.use('/api', pike13Router);
app.use('/api', githubRouter);
app.use('/api', adminRouter);

app.use(errorHandler);

// In production, serve the built React app from /app/public.
// All non-API routes fall through to index.html for SPA routing.
if (process.env.NODE_ENV === 'production') {
  const path = require('path');
  const publicDir = path.resolve(__dirname, '../public');
  app.use(express.static(publicDir));
  app.get('*', (_req: express.Request, res: express.Response) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

export default app;
