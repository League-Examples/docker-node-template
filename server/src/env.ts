import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Load .env from project root when running locally (not in Docker).
// In Docker, env vars are set by compose/entrypoint.
//
// This module MUST be imported before any module that reads process.env
// at load time (e.g., auth.ts registers OAuth strategies based on env vars).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  // override: true makes the project .env authoritative over any
  // already-exported shell env var (e.g. a stale OPENAI_API_KEY in
  // ~/.zshenv shadowing the correct project key). Skip override in the
  // test suite: tests/server/setup.ts and global-setup.ts deliberately
  // set process.env values (NODE_ENV, DATABASE_URL) before this module
  // loads, and those must win over whatever's in .env.
  dotenv.config({ path: envPath, override: process.env.NODE_ENV !== 'test' });
}
