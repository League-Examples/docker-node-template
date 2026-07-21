import request from 'supertest';
import express from 'express';
import type { Server } from 'http';
import {
  ServiceError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
} from '../../server/src/errors';
import { errorHandler } from '../../server/src/middleware/errorHandler';
import { startTestServer, stopTestServer } from './helpers/testServer';

// --- Unit tests for error classes ---

describe('ServiceError hierarchy', () => {
  it('ServiceError has correct statusCode and message', () => {
    const err = new ServiceError('test error', 418);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ServiceError);
    expect(err.statusCode).toBe(418);
    expect(err.message).toBe('test error');
    expect(err.name).toBe('ServiceError');
  });

  it('NotFoundError defaults to 404', () => {
    const err = new NotFoundError();
    expect(err).toBeInstanceOf(ServiceError);
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Not found');
    expect(err.name).toBe('NotFoundError');
  });

  it('NotFoundError accepts custom message', () => {
    const err = new NotFoundError('User 42 not found');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('User 42 not found');
  });

  it('ValidationError defaults to 400', () => {
    const err = new ValidationError('Invalid input');
    expect(err).toBeInstanceOf(ServiceError);
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Invalid input');
    expect(err.name).toBe('ValidationError');
  });

  it('UnauthorizedError defaults to 401', () => {
    const err = new UnauthorizedError();
    expect(err).toBeInstanceOf(ServiceError);
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Not authenticated');
    expect(err.name).toBe('UnauthorizedError');
  });

  it('ForbiddenError defaults to 403', () => {
    const err = new ForbiddenError();
    expect(err).toBeInstanceOf(ServiceError);
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe('Insufficient permissions');
    expect(err.name).toBe('ForbiddenError');
  });

  it('ConflictError defaults to 409', () => {
    const err = new ConflictError('Already exists');
    expect(err).toBeInstanceOf(ServiceError);
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe('Already exists');
    expect(err.name).toBe('ConflictError');
  });
});

// --- Integration tests for error handler middleware ---

// This describe's `app` is a small, fixture-only Express app (never the
// real `server/src/app.ts`) whose one route rethrows whatever error the
// currently-running test wants to exercise -- previously a fresh
// `createTestApp(errorToThrow)` instance (and thus, via supertest's
// per-call ephemeral-server wrap, a fresh `http.Server`) per test. Sprint
// 013-001: one persistent server is created once for this describe block,
// wrapping a route that reads the error to throw from a mutable variable
// (`errorToThrow`) set by each test immediately before its request --
// same assertions, same per-test error, no per-test ephemeral server.
describe('Error handler middleware', () => {
  let errorToThrow: Error;
  let server: Server;

  beforeAll(async () => {
    const fixtureApp = express();
    fixtureApp.get('/test', () => {
      throw errorToThrow;
    });
    fixtureApp.use(errorHandler);
    server = await startTestServer(fixtureApp);
  });

  afterAll(async () => {
    await stopTestServer(server);
  });

  it('returns 404 for NotFoundError', async () => {
    errorToThrow = new NotFoundError('Item not found');
    const res = await request(server).get('/test');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Item not found' });
  });

  it('returns 400 for ValidationError', async () => {
    errorToThrow = new ValidationError('Bad input');
    const res = await request(server).get('/test');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Bad input' });
  });

  it('returns 401 for UnauthorizedError', async () => {
    errorToThrow = new UnauthorizedError();
    const res = await request(server).get('/test');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Not authenticated' });
  });

  it('returns 403 for ForbiddenError', async () => {
    errorToThrow = new ForbiddenError();
    const res = await request(server).get('/test');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Insufficient permissions' });
  });

  it('returns 409 for ConflictError', async () => {
    errorToThrow = new ConflictError('Duplicate entry');
    const res = await request(server).get('/test');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Duplicate entry' });
  });

  it('returns 500 with generic message for unknown errors', async () => {
    errorToThrow = new Error('secret internal details');
    const res = await request(server).get('/test');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    // Must NOT leak the original error message
    expect(res.body.error).not.toContain('secret');
  });
});

// --- Test that health endpoint includes version ---

describe('Health endpoint version', () => {
  let server: Server;

  beforeAll(async () => {
    const app = (await import('../../server/src/app')).default;
    server = await startTestServer(app);
  });

  afterAll(async () => {
    await stopTestServer(server);
  });

  it('GET /api/health includes version field', async () => {
    const res = await request(server).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('version');
    expect(typeof res.body.version).toBe('string');
  });
});
