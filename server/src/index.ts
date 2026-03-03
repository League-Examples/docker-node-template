import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load .env from project root when running locally (not in Docker).
// In Docker, env vars are set by compose/entrypoint.
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

import app from './app';
import { initConfigCache } from './services/config';

const port = parseInt(process.env.PORT || '3000', 10);

initConfigCache().then(() => {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
});

export default app;
