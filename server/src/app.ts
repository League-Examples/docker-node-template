import express from 'express';
import session from 'express-session';
import passport from 'passport';
import pinoHttp from 'pino-http';
import { healthRouter } from './routes/health';
import { counterRouter } from './routes/counter';
import { integrationsRouter } from './routes/integrations';
import { authRouter } from './routes/auth';
import { pike13Router } from './routes/pike13';
import { errorHandler } from './middleware/errorHandler';

const app = express();

// Trust first proxy (Caddy in production, Vite in dev)
app.set('trust proxy', 1);

app.use(express.json());
app.use(pinoHttp({
  level: process.env.LOG_LEVEL || 'info',
  // Suppress request logs during tests
  ...(process.env.NODE_ENV === 'test' ? { level: 'silent' } : {}),
}));

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    httpOnly: true,
  },
}));

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
