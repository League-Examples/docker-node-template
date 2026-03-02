import { Router, Request, Response } from 'express';

export const pike13Router = Router();

const PIKE13_AUTH_DOCS = 'https://developer.pike13.com/docs/authentication';

// Pike 13 API base URL. Can be overridden with PIKE13_API_BASE for
// subdomain-specific businesses (e.g., https://mybusiness.pike13.com/api/v2/desk).
function getBaseUrl(): string {
  return process.env.PIKE13_API_BASE || 'https://pike13.com/api/v2/desk';
}

function getAuthBaseUrl(): string {
  return process.env.PIKE13_API_BASE?.replace('/api/v2/desk', '') || 'https://pike13.com';
}

function hasCredentials(): boolean {
  return !!(process.env.PIKE13_CLIENT_ID && process.env.PIKE13_CLIENT_SECRET);
}

// --- Server-side token cache ---
// Pike 13 tokens don't expire, so we obtain one automatically on first use
// and cache it for the lifetime of the process.
let cachedToken: string | undefined;
let tokenPromise: Promise<string | undefined> | undefined;

// Obtain a token via client_credentials grant (no user interaction).
// Falls back to authorization_code flow if client_credentials isn't supported.
async function acquireToken(): Promise<string | undefined> {
  if (!hasCredentials()) return undefined;

  try {
    const response = await fetch(`${getAuthBaseUrl()}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.PIKE13_CLIENT_ID!,
        client_secret: process.env.PIKE13_CLIENT_SECRET!,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      if (process.env.NODE_ENV !== 'test') {
        console.error('Pike 13 client_credentials grant failed:', response.status, detail);
      }
      return undefined;
    }

    const data: any = await response.json();
    if (data.access_token) {
      if (process.env.NODE_ENV !== 'test') console.log('Pike 13 token acquired via client_credentials');
      return data.access_token;
    }
    return undefined;
  } catch (err: any) {
    if (process.env.NODE_ENV !== 'test') console.error('Pike 13 token acquisition error:', err.message);
    return undefined;
  }
}

// Returns a usable token. Tries env var first, then cached token,
// then automatically acquires one via client_credentials.
async function getToken(): Promise<string | undefined> {
  if (process.env.PIKE13_ACCESS_TOKEN) return process.env.PIKE13_ACCESS_TOKEN;
  if (cachedToken) return cachedToken;

  // Deduplicate concurrent token requests
  if (!tokenPromise) {
    tokenPromise = acquireToken().then(token => {
      cachedToken = token;
      tokenPromise = undefined;
      return token;
    });
  }
  return tokenPromise;
}

// --- Pike 13 OAuth flow (authorization code, fallback) ---
// If client_credentials isn't supported, the developer can click
// "Connect Pike 13" to go through the authorization code flow once.

// GET /api/auth/pike13 — initiate OAuth authorization
pike13Router.get('/auth/pike13', (_req: Request, res: Response) => {
  if (!hasCredentials()) {
    return res.status(501).json({
      error: 'Pike 13 OAuth not configured',
      detail: 'Set PIKE13_CLIENT_ID and PIKE13_CLIENT_SECRET',
      docs: PIKE13_AUTH_DOCS,
    });
  }
  const params = new URLSearchParams({
    client_id: process.env.PIKE13_CLIENT_ID!,
    response_type: 'code',
    redirect_uri: process.env.PIKE13_CALLBACK_URL || '/api/auth/pike13/callback',
  });
  res.redirect(`${getAuthBaseUrl()}/oauth/authorize?${params}`);
});

// GET /api/auth/pike13/callback — exchange code for token, cache server-side
pike13Router.get('/auth/pike13/callback', async (req: Request, res: Response) => {
  const { code } = req.query;
  if (!code || typeof code !== 'string') {
    return res.redirect('/?pike13_error=missing_code');
  }
  if (!hasCredentials()) {
    return res.status(501).json({ error: 'Pike 13 OAuth not configured' });
  }

  try {
    const response = await fetch(`${getAuthBaseUrl()}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.PIKE13_CALLBACK_URL || '/api/auth/pike13/callback',
        client_id: process.env.PIKE13_CLIENT_ID!,
        client_secret: process.env.PIKE13_CLIENT_SECRET!,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error('Pike 13 token exchange failed:', response.status, detail);
      return res.redirect('/?pike13_error=token_exchange_failed');
    }

    const data: any = await response.json();
    cachedToken = data.access_token;
    if (process.env.NODE_ENV !== 'test') console.log('Pike 13 OAuth token obtained via authorization code');
    res.redirect('/');
  } catch (err: any) {
    console.error('Pike 13 token exchange error:', err.message);
    res.redirect('/?pike13_error=token_exchange_error');
  }
});

// GET /api/pike13/events — this week's event occurrences
// Docs: https://developer.pike13.com/docs/event-occurrences
pike13Router.get('/pike13/events', async (_req: Request, res: Response) => {
  const token = await getToken();
  if (!token) {
    return res.status(501).json({
      error: 'Pike 13 not configured',
      detail: 'Set PIKE13_ACCESS_TOKEN or connect via /api/auth/pike13',
      docs: PIKE13_AUTH_DOCS,
    });
  }

  try {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);

    const params = new URLSearchParams({
      from: startOfWeek.toISOString(),
      to: endOfWeek.toISOString(),
    });

    const response = await fetch(
      `${getBaseUrl()}/event_occurrences?${params}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      },
    );

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Pike 13 API error',
        detail: `${response.status} ${response.statusText}`,
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({
      error: 'Failed to reach Pike 13 API',
      detail: err.message,
    });
  }
});

// GET /api/pike13/people — first page of people
// Docs: https://developer.pike13.com/docs/people
pike13Router.get('/pike13/people', async (_req: Request, res: Response) => {
  const token = await getToken();
  if (!token) {
    return res.status(501).json({
      error: 'Pike 13 not configured',
      detail: 'Set PIKE13_ACCESS_TOKEN or connect via /api/auth/pike13',
      docs: PIKE13_AUTH_DOCS,
    });
  }

  try {
    const response = await fetch(`${getBaseUrl()}/people`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Pike 13 API error',
        detail: `${response.status} ${response.statusText}`,
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({
      error: 'Failed to reach Pike 13 API',
      detail: err.message,
    });
  }
});
