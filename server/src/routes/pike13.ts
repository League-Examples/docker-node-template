import { Router, Request, Response } from 'express';

export const pike13Router = Router();

const PIKE13_DOCS = 'https://developer.pike13.com/docs/get_started';

// Pike 13 API base URL. Can be overridden with PIKE13_API_BASE for
// subdomain-specific businesses (e.g., https://mybusiness.pike13.com/api/v2/desk).
function getBaseUrl(): string {
  return process.env.PIKE13_API_BASE || 'https://pike13.com/api/v2/desk';
}

function getToken(): string | undefined {
  return process.env.PIKE13_ACCESS_TOKEN;
}

// GET /api/pike13/events — this week's event occurrences
// Docs: https://developer.pike13.com/docs/event-occurrences
pike13Router.get('/pike13/events', async (_req: Request, res: Response) => {
  const token = getToken();
  if (!token) {
    return res.status(501).json({
      error: 'Pike 13 not configured',
      detail: 'Set PIKE13_ACCESS_TOKEN in your environment',
      docs: PIKE13_DOCS,
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
  const token = getToken();
  if (!token) {
    return res.status(501).json({
      error: 'Pike 13 not configured',
      detail: 'Set PIKE13_ACCESS_TOKEN in your environment',
      docs: PIKE13_DOCS,
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
