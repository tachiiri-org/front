/**
 * .dev.vars をパースして process.env に注入する
 * 既に設定済みの変数は上書きしない
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const devVarsPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../.dev.vars',
);

if (existsSync(devVarsPath)) {
  const lines = readFileSync(devVarsPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // クォート除去
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}
