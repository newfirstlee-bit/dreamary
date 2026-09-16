// Encrypted logical Firestore backup (top-level Dreamary schema). Not a
// point-in-time snapshot or Firebase Auth / ImgBB image binary backup.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { createGzip, createGunzip } = require('node:zlib');
const { StringDecoder } = require('node:string_decoder');
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
function failure(code) { return Object.assign(new Error(code), { code }); }
async function planBackup(db, max) {
  const collections = await db.listCollections();
  let documents = 0;
  for (const collection of collections) {
    // Count index entries, not document bodies. Stop as soon as the ceiling is exceeded.
    documents += (await collection.limit(max - documents + 1).count().get()).data().count;
    if (documents > max) throw failure('BACKUP_LIMIT');
  }
  return { collections, documents };
}
function safeFailure(error) {
  const descriptions = {
    BACKUP_LIMIT: '문서 수가 백업 상한을 초과했습니다. 개수와 읽기 예산을 확인한 뒤 --max-docs를 조정하세요.',
    BACKUP_NESTED: '하위 컬렉션이 있어 현재 백업 형식으로 완료할 수 없습니다.',
    RESTORE_MISMATCH: '임시 DB에 복원한 값이 백업과 일치하지 않습니다. 아래 진단 분류를 확인하세요.',
    RESTORE_INCOMPLETE: '복원한 문서 수가 백업의 완료 기록과 다릅니다.',
    RESTORE_PATH: '지원하지 않는 문서 경로 형식입니다.',
    3: '복원 문서 또는 요청 형식이 임시 DB에서 거부됐습니다.',
    9: '임시 DB 요청의 사전 조건이 충족되지 않았습니다.',
    EEXIST: '같은 이름의 파일이 이미 있습니다. 기존 백업을 보존하고 새 파일명을 사용하세요.',
    EACCES: '백업 폴더의 파일 접근 권한을 확인하세요.',
    ENOSPC: '로컬 저장 공간이 부족합니다.',
    ENOENT: '백업 파일 또는 폴더가 없습니다.',
    4: 'Firebase 요청 시간이 초과됐습니다. 네트워크를 확인하세요.',
    7: 'Firebase 서비스 계정의 조회 권한이 부족합니다.',
    8: 'Firebase 사용량 한도가 초과됐습니다. 한도 확인 전 반복 실행하지 마세요.',
    14: 'Firebase에 연결하지 못했습니다. 네트워크를 확인하세요.',
    16: 'Firebase 서비스 계정 인증에 실패했습니다.',
  };
  const code = String(error?.code);
  return Object.hasOwn(descriptions, code) ? `[${code}] ${descriptions[code]}` : '[BACKUP_UNKNOWN] 설정·암호문구·파일 형식 또는 인증을 확인해야 합니다.';
}
async function exportBackup(db, file, passphrase, max = 100000, progress = () => {}) {
  if (!Number.isInteger(max) || max < 1 || max > 1000000) throw new Error('Invalid document ceiling');
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', passphraseKey(passphrase, salt), iv);
  // Check the path before any billable reads. Exclusive creation below still protects races.
  try { await fsp.lstat(file); throw failure('EEXIST'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const plan = await planBackup(db, max);
  progress({ phase: 'planned', documents: 0, estimatedDocuments: plan.documents });
  const header = Buffer.concat([magic, salt, iv]); cipher.setAAD(header);
  // Exclusive creation prevents accidentally replacing the previous good copy.
  const output = fs.createWriteStream(file, { flags: 'wx', mode: 0o600 });
  let created = false, count = 0;
  output.once('open', () => { created = true; });
  async function* records() {
    yield JSON.stringify({ format: 1, project: db.projectId, startedAt: Date.now() }) + '\n';
    for (const collection of plan.collections) {
      let cursor;
      for (;;) {
        let query = collection.orderBy('__name__').limit(Math.min(20, max - count + 1));
        if (cursor) query = query.startAfter(cursor);
        const page = await query.get();
        if (count + page.size > max) throw failure('BACKUP_LIMIT');
        // One bounded page at a time, including the metadata-only child checks.
        const children = await Promise.all(page.docs.map(doc => doc.ref.listCollections()));
        if (children.some(list => list.length)) throw failure('BACKUP_NESTED');
        for (const doc of page.docs) {
          count++;
          yield JSON.stringify({ path: doc.ref.path, data: encode(doc.data()) }) + '\n';
        }
        progress({ phase: 'exporting', documents: count, estimatedDocuments: plan.documents });
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
async function* jsonRecords(source) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  for await (const chunk of source) {
    pending += decoder.write(chunk);
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      yield JSON.parse(line);
    }
  }
  pending += decoder.end();
  if (pending) yield JSON.parse(pending);
}
async function verifyBackup(file, passphrase, expectedProject) {
  const input = await fsp.open(file, 'r');
  try {
    const { size } = await input.stat();
    if (size < 52) throw new Error('Invalid backup');
    const header = Buffer.alloc(36), tag = Buffer.alloc(16);
    await input.read(header, 0, 36, 0); await input.read(tag, 0, 16, size - 16);
    if (!header.subarray(0, 8).equals(magic)) throw new Error('Invalid format');
    const decipher = crypto.createDecipheriv('aes-256-gcm', passphraseKey(passphrase, header.subarray(8,24)), header.subarray(24));
    decipher.setAAD(header); decipher.setAuthTag(tag);
    let count = 0, started = false, complete = false;
    const paths = new Set();
    // Verification never writes decoded data to disk or to a database.
    await pipeline(input.createReadStream({ start: 36, end: size - 17, autoClose: false }), decipher, createGunzip(), async source => {
      for await (const record of jsonRecords(source)) {
        if (!started) {
          if (record.format !== 1 || record.project !== expectedProject) throw new Error('Invalid project or format');
          started = true;
        } else if (complete) throw new Error('Unexpected trailing record');
        else if (record.path) {
          if (!/^[^/]+\/[^/]+$/.test(record.path) || paths.has(record.path)) throw new Error('Invalid path');
          decode(record.data, { doc: path => ({ path }) });
          paths.add(record.path); count++;
        } else if (record.complete === true && record.documents === count) complete = true;
        else throw new Error('Incomplete backup');
      }
    });
    if (!started || !complete) throw new Error('Incomplete backup');
    return { documents: count, verified: true };
  } finally { await input.close(); }
}
function normalizedEncoded([type, value]) {
  if (type === 'map') return [type, value.map(([key, child]) => [key, normalizedEncoded(child)]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)];
  if (type === 'array') return [type, value.map(normalizedEncoded)];
  return [type, value];
}
function mismatchKind(expected, actual) {
  if (!Array.isArray(expected) || !Array.isArray(actual)) return 'invalid-encoding';
  if (expected[0] !== actual[0]) return 'value-type';
  const [type, value] = expected;
  if (type === 'map') {
    const other = new Map(actual[1]);
    if (value.length !== other.size || value.some(([key]) => !other.has(key))) return 'map-keys';
    for (const [key, child] of value) {
      if (JSON.stringify(normalizedEncoded(child)) !== JSON.stringify(normalizedEncoded(other.get(key)))) return mismatchKind(child, other.get(key));
    }
  } else if (type === 'array') {
    if (value.length !== actual[1].length) return 'array-length';
    for (let i = 0; i < value.length; i++) {
      if (JSON.stringify(normalizedEncoded(value[i])) !== JSON.stringify(normalizedEncoded(actual[1][i]))) return mismatchKind(value[i], actual[1][i]);
    }
  }
  return ['timestamp','point','ref','bytes','number','value'].includes(type) ? `${type}-value` : 'structure';
}
async function restoreDemo(db, file, passphrase, options = {}) {
  if (!db.projectId.startsWith('demo-') || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('Restore is restricted to a local demo emulator');
  const input = await fsp.open(file, 'r');
  const temp = await fsp.mkdtemp(require('node:path').join(require('node:os').tmpdir(), 'dreamary-restore-'));
  const plaintext = require('node:path').join(temp, 'verified.jsonl');
  let stage = 'decrypt', count = 0;
  try {
    const { size } = await input.stat(); if (size < 52) throw new Error('Invalid backup');
    const header = Buffer.alloc(36), tag = Buffer.alloc(16);
    await input.read(header, 0, 36, 0); await input.read(tag, 0, 16, size - 16);
    if (!header.subarray(0, 8).equals(magic)) throw new Error('Invalid format');
    const decipher = crypto.createDecipheriv('aes-256-gcm', passphraseKey(passphrase, header.subarray(8,24)), header.subarray(24));
    decipher.setAAD(header); decipher.setAuthTag(tag);
    // Verify the entire GCM tag before performing even the first database write.
    await pipeline(fs.createReadStream(file, { start: 36, end: size - 17 }), decipher, createGunzip(), fs.createWriteStream(plaintext, { flags: 'wx', mode: 0o600 }));
    let complete = false, expected = 0;
    stage = 'parse';
    for await (const record of jsonRecords(fs.createReadStream(plaintext))) {
      if (record.path) {
        if (!/^[^/]+\/[^/]+$/.test(record.path)) throw failure('RESTORE_PATH');
        stage = 'decode';
        const ref = db.doc(record.path);
        const decoded = decode(record.data, db);
        stage = 'write';
        await ref.set(decoded);
        if (options.verifyWrites) {
          stage = 'read-back';
          const saved = await ref.get();
          stage = 'compare';
          const actual = saved.exists ? encode(saved.data()) : null;
          if (!saved.exists || JSON.stringify(normalizedEncoded(actual)) !== JSON.stringify(normalizedEncoded(record.data))) {
            const error = failure('RESTORE_MISMATCH');
            error.mismatch = saved.exists ? mismatchKind(record.data, actual) : 'missing-document';
            throw error;
          }
        }
        count++;
        if (options.progress && (count === 1 || count % 100 === 0)) options.progress(count);
      } else if (record.complete) { complete = true; expected = record.documents; }
      stage = 'parse';
    }
    stage = 'final-count';
    if (!complete || count !== expected) throw failure('RESTORE_INCOMPLETE');
    return { documents: count };
  } catch (error) {
    error.restoreStage = stage;
    error.restoredDocuments = count;
    throw error;
  } finally { await input.close(); await fsp.rm(temp, { recursive: true, force: true }); }
}
module.exports = { encode, decode, exportBackup, restoreDemo, verifyBackup, planBackup, safeFailure, jsonRecords };
if (require.main === module) {
  let stage = 'configuration', lastProgress = 0;
  (async () => {
    const options = args();
    if (!options.file) throw new Error('File required');
    if (options.action === 'verify') {
      stage = 'verification';
      return verifyBackup(options.file, process.env.BACKUP_PASSPHRASE, options.project);
    }
    const db = database(options.project);
    try {
      if (options.action === 'restore-demo') { stage = 'restore'; return await restoreDemo(db, options.file, process.env.BACKUP_PASSPHRASE); }
      if (options.action !== 'export') throw new Error('Invalid action');
      stage = 'preflight';
      console.error('백업 사전 점검: 문서 개수를 확인합니다.');
      const result = await exportBackup(db, options.file, process.env.BACKUP_PASSPHRASE, Number(options['max-docs']), event => {
        stage = 'export';
        if (event.phase === 'planned') console.error(`백업 대상: ${event.estimatedDocuments}개 문서 (시작 시점 집계)`);
        else if (Date.now() - lastProgress > 2000 || event.documents === event.estimatedDocuments) {
          lastProgress = Date.now(); console.error(`암호화 중: ${event.documents} / 약 ${event.estimatedDocuments}개`);
        }
      });
      stage = 'verification';
      console.error('암호화 파일의 복호화·문서 수·무결성을 로컬에서 확인합니다.');
      const verified = await verifyBackup(options.file, process.env.BACKUP_PASSPHRASE, options.project);
      if (verified.documents !== result.documents) throw new Error('Count mismatch');
      return verified;
    } finally { await db.terminate(); }
  })().then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(`백업/복원 실패 (${stage}): ${safeFailure(error)}`); process.exitCode = 1;
  });
}
