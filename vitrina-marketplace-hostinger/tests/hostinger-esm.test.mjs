import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'server.js');
const code = readFileSync(file, 'utf8');
test('A inicialização assíncrona não usa await no escopo principal', () => {
  assert.doesNotMatch(code, /^await (createSchema|bootstrapAdmin)\(\);/m);
  assert.doesNotMatch(code, /^if\(process\.env\.DB_AUTO_SCHEMA[^\n]*\)await createSchema\(\);/m);
  assert.match(code, /async function iniciarAplicacao\(\)/);
  assert.match(code, /iniciarAplicacao\(\)\.catch/);
  assert.match(code, /server\.listen\(PORT, HOST,/);
});
