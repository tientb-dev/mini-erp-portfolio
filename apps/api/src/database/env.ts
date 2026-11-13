import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

// Loads the repo-root .env once; real environment variables take precedence.
// Assigned manually (not process.loadEnvFile) so it also works inside Jest's sandboxed process.env.
try {
  const vars = parseEnv(readFileSync(resolve(__dirname, '../../../../.env'), 'utf8'));
  for (const [key, value] of Object.entries(vars)) process.env[key] ??= value;
} catch {
  // No .env file: rely on the process environment.
}

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
