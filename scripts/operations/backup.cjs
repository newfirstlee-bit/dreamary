// Encrypted logical Firestore backup (top-level Dreamary schema). Not a
// point-in-time snapshot or Firebase Auth / ImgBB image binary backup.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { createGzip, createGunzip } = require('node:zlib');
const { createInterface } = require('node:readline');
const { Timestamp, GeoPoint, DocumentReference } = require('firebase-admin/firestore');
const { database, args } = require('./database.cjs');
const magic = Buffer.from('DRMBKP01');
function encode(value) {
  if (value instanceof Timestamp) return ['timestamp', [value.seconds, value.nanoseconds]];
  if (value instanceof Date) return ['timestamp', [Math.floor(value.getTime() / 1000), value.getMilliseconds() * 1000000]];
  if (value instanceof GeoPoint) return ['point', [value.latitude, value.longitude]];
  if (value instanceof DocumentReference) return ['ref', value.path];
  if (Buffer.isBuffer(value)) return ['bytes', value.toString('base64')];
  if (Array.isArray(value)) return ['array', value.map(encode)];
  if (value && typeof value === 'object') return ['map', Object.entries(value).map(([k,v]) => [k, encode(v)])];
  if (typeof value === 'number' && !Number.isFinite(value)) return ['number', String(value)];
  return ['value', value];
}
function decode([type, value], db) {
  switch (type) {
    case 'timestamp': return new Timestamp(...value);
    case 'point': return new GeoPoint(...value);
    case 'ref': return db.doc(value);
    case 'bytes': return Buffer.from(value, 'base64');
    case 'array': return value.map(v => decode(v, db));
    case 'map': return Object.fromEntries(value.map(([k,v]) => [k, decode(v, db)]));
    case 'number': return Number(value);
    case 'value': return value;
    default: throw new Error('Invalid backup value');
  }
}
function passphraseKey(passphrase, salt) {
  if (typeof passphrase !== 'string' || passphrase.length < 20) throw new Error('BACKUP_PASSPHRASE must contain at least 20 characters');
  return crypto.scryptSync(passphrase, salt, 32);
}
async function exportBackup(db, file, passphrase, max = 100000) {
  if (!Number.isInteger(max) || max < 1 || max > 1000000) throw new Error('Invalid document ceiling');
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', passphraseKey(passphrase, salt), iv);
  const header = Buffer.concat([magic, salt, iv]); cipher.setAAD(header);
  // Exclusive creation prevents accidentally replacing the previous good copy.
  const output = fs.createWriteStream(file, { flags: 'wx', mode: 0o600 });
  let created = false, count = 0;
  output.once('open', () => { created = true; });
  async function* records() {
    yield JSON.stringify({ format: 1, project: db.projectId, startedAt: Date.now() }) + '\n';
    for (const collection of await db.listCollections()) {
      let cursor;
      for (;;) {
        let query = collection.orderBy('__name__').limit(20);
        if (cursor) query = query.startAfter(cursor);
        const page = await query.get();
        for (const doc of page.docs) {
          if (++count > max) throw new Error('Document ceiling reached');
          if ((await doc.ref.listCollections()).length) throw new Error('Nested collections require a new backup schema');
          yield JSON.stringify({ path: doc.ref.path, data: encode(doc.data()) }) + '\n';
        }
        if (page.size < 20) break;
        cursor = page.docs.at(-1);
      }
    }
    yield JSON.stringify({ complete: true, documents: count }) + '\n';
  }
  try {
    output.write(header);
    await pipeline(Readable.from(records()), createGzip(), cipher, output);
    await fsp.appendFile(file, cipher.getAuthTag());
    return { documents: count };
  } catch (error) { if (created) await fsp.rm(file, { force: true }); throw error; }
}
async function restoreDemo(db, file, passphrase) {
  if (!db.projectId.startsWith('demo-') || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('Restore is restricted to a local demo emulator');
  const input = await fsp.open(file, 'r');
  const temp = await fsp.mkdtemp(require('node:path').join(require('node:os').tmpdir(), 'dreamary-restore-'));
  const plaintext = require('node:path').join(temp, 'verified.jsonl');
  try {
    const { size } = await input.stat(); if (size < 52) throw new Error('Invalid backup');
    const header = Buffer.alloc(36), tag = Buffer.alloc(16);
    await input.read(header, 0, 36, 0); await input.read(tag, 0, 16, size - 16);
    if (!header.subarray(0, 8).equals(magic)) throw new Error('Invalid format');
    const decipher = crypto.createDecipheriv('aes-256-gcm', passphraseKey(passphrase, header.subarray(8,24)), header.subarray(24));
    decipher.setAAD(header); decipher.setAuthTag(tag);
    // Verify the entire GCM tag before performing even the first database write.
    await pipeline(fs.createReadStream(file, { start: 36, end: size - 17 }), decipher, createGunzip(), fs.createWriteStream(plaintext, { flags: 'wx', mode: 0o600 }));
    let count = 0, complete = false, expected = 0;
    for await (const line of createInterface({ input: fs.createReadStream(plaintext), crlfDelay: Infinity })) {
      const record = JSON.parse(line);
      if (record.path) {
        if (!/^[^/]+\/[^/]+$/.test(record.path)) throw new Error('Unsupported path');
        await db.doc(record.path).set(decode(record.data, db)); count++;
      } else if (record.complete) { complete = true; expected = record.documents; }
    }
    if (!complete || count !== expected) throw new Error('Incomplete backup');
    return { documents: count };
  } finally { await input.close(); await fsp.rm(temp, { recursive: true, force: true }); }
}
module.exports = { encode, decode, exportBackup, restoreDemo };
if (require.main === module) {
  const options = args();
  const action = options.action === 'export' ? exportBackup : options.action === 'restore-demo' ? restoreDemo : null;
  if (!action || !options.file) throw new Error('Use --action export|restore-demo --project ID --file FILE');
  action(database(options.project), options.file, process.env.BACKUP_PASSPHRASE, Number(options['max-docs']))
    .then(result => console.log(JSON.stringify(result))).catch(() => { console.error('Backup/restore failed; check project, file, passphrase, schema and credentials.'); process.exitCode = 1; });
}
