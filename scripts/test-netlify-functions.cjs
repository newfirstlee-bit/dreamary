const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { assertModernEntry, checkDirectory } = require('./check-netlify-functions.cjs');

test('Netlify guard rejects the helper and Lambda handler shapes that triggered the 4KB limit', () => {
  for (const source of [
    'export const corsHeaders = {};',
    'export function getFirebaseAdminServices() {}',
    'export const handler = async () => ({ statusCode: 200 });',
    'exports.handler = async () => ({});',
    'export default () => new Response(); export const handler = () => ({});',
  ]) assert.throws(() => assertModernEntry(source, 'fixture.ts'), /modern default export/);
});
test('Netlify guard supports modern functions and shared handler default exports', () => {
  for (const source of [
    'export default async function reqHandler(req: Request) { return new Response(); }',
    'export default async function handler(req: Request) { return new Response(); }',
    'export default async (req: Request) => new Response();',
    'import handler from "../shared/handler"; export default handler;',
    'export { handler as default } from "../shared/handler";',
  ]) assert.doesNotThrow(() => assertModernEntry(source, 'fixture.ts'));
});
test('All application function entries pass and helper files stay outside deployment discovery', () => {
  const fs = require('node:fs');
  const directory = path.join(__dirname, '../netlify/functions');
  assert.ok(checkDirectory(directory) > 0);
  for (const name of ['cors.ts', 'push-shared.mts']) {
    assert.equal(fs.existsSync(path.join(directory, name)), false);
    assert.equal(fs.existsSync(path.join(directory, '../shared', name)), true);
  }
});
