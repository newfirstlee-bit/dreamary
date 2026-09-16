const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Timestamp, GeoPoint } = require('firebase-admin/firestore');
const { encode, decode, exportBackup, restoreDemo, verifyBackup, safeFailure } = require('./operations/backup.cjs');
const { prepare } = require('./operations/prepare.cjs');
const { buildEnvironment } = require('./build-app.cjs');
function database(seed = []) {
  const rows = new Map(seed), db = { projectId: 'demo-backup-test' };
  db.doc = path => ({ path, set: async value => rows.set(path, value), get: async () => ({ exists: rows.has(path), data: () => rows.get(path) }), listCollections: async () => [] });
  const collection = name => {
    const query = (cap = 20, cursor = '') => ({ orderBy: () => query(cap, cursor), limit: n => query(n, cursor), startAfter: doc => query(cap, typeof doc === 'string' ? doc : doc.id),
      count: () => ({ get: async () => ({ data: () => ({ count: Math.min(cap, [...rows.keys()].filter(p => p.startsWith(name + '/')).length) }) }) }),
      get: async () => { assert.ok(cap <= 20); const docs = [...rows].filter(([p]) => p.startsWith(name + '/') && p.split('/')[1] > cursor).sort(([a], [b]) => a.localeCompare(b)).slice(0,cap).map(([p,v]) => ({ id: p.split('/')[1], ref: db.doc(p), data: () => v })); return { docs, size: docs.length }; }, doc: id => db.doc(name + '/' + id) });
    return query();
  };
  db.collection = collection;
  db.listCollections = async () => [...new Set([...rows.keys()].map(p => p.split('/')[0]))].map(collection);
  return { db, rows };
}
test('backup: lossless types, paged export, encrypted file, authenticated restore and wrong-key refusal', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dreamary-backup-test-'));
  const file = path.join(dir, 'backup.enc'), pass = 'synthetic-only-backup-passphrase';
  const { db } = database(Array.from({ length: 43 }, (_, i) => ['diaries/d' + i, { text: 'synthetic private text', at: new Timestamp(123,456), point: new GeoPoint(37,127), bytes: Buffer.from('bytes'), values: [null, true, Infinity, NaN], collision: { type: 'timestamp' } }]));
  const target = database();
  const previousHost = process.env.FIRESTORE_EMULATOR_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  try {
    assert.equal((await exportBackup(db, file, pass, 100)).documents, 43);
    assert.deepEqual(await verifyBackup(file, pass, db.projectId), { documents: 43, verified: true });
    await assert.rejects(verifyBackup(file, pass, 'wrong-project'));
    await assert.rejects(verifyBackup(file, 'another-synthetic-passphrase', db.projectId));
    assert.equal((await fs.readFile(file)).includes(Buffer.from('synthetic private text')), false);
    await assert.rejects(restoreDemo(target.db, file, 'another-synthetic-passphrase'));
    assert.equal(target.rows.size, 0);
    assert.equal((await restoreDemo(target.db, file, pass, { verifyWrites: true })).documents, 43);
    const mismatched = database();
    mismatched.db.doc = () => ({ set: async () => {}, get: async () => ({ exists: true, data: () => ({ text: 'incorrect synthetic value' }) }) });
    await assert.rejects(restoreDemo(mismatched.db, file, pass, { verifyWrites: true }), { code:'RESTORE_MISMATCH', restoreStage:'compare', restoredDocuments:0, mismatch:'map-keys' });
    const restored = target.rows.get('diaries/d0');
    assert.ok(restored.at.isEqual(new Timestamp(123,456)));
    assert.ok(restored.point.isEqual(new GeoPoint(37,127)));
    assert.ok(restored.bytes.equals(Buffer.from('bytes')));
    assert.ok(Number.isNaN(restored.values[3]));
    assert.deepEqual(decode(encode({ type: 'timestamp' }), target.db), { type: 'timestamp' });
    await assert.rejects(exportBackup(db, file, pass)); // Existing good copy cannot be overwritten or removed.
    assert.equal((await restoreDemo(database().db, file, pass)).documents, 43);
    const tampered = await fs.readFile(file); tampered[45] ^= 1; await fs.writeFile(file, tampered);
    await assert.rejects(verifyBackup(file, pass, db.projectId));
    const untouched = database(); await assert.rejects(restoreDemo(untouched.db, file, pass)); assert.equal(untouched.rows.size, 0);
    await assert.rejects(restoreDemo({ ...target.db, projectId: 'production' }, file, pass));
  } finally { if (previousHost === undefined) delete process.env.FIRESTORE_EMULATOR_HOST; else process.env.FIRESTORE_EMULATOR_HOST = previousHost; await fs.rm(dir, { recursive: true, force: true }); }
});
test('backup: ceiling preflight avoids document reads and incomplete files; failures stay sanitized', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dreamary-backup-limit-'));
  const file = path.join(dir, 'backup.drmbkp');
  let bodyReads = 0;
  const collection = { limit: n => ({ count: () => ({ get: async () => ({ data: () => ({ count: Math.min(n, 7315) }) }) }) }), orderBy: () => { bodyReads++; throw new Error('must not read'); } };
  try {
    await assert.rejects(exportBackup({projectId:'demo-test', listCollections:async()=>[collection]}, file, 'synthetic-backup-passphrase', 1000), { code: 'BACKUP_LIMIT' });
    assert.equal(bodyReads, 0);
    await assert.rejects(fs.stat(file), { code: 'ENOENT' });
    assert.match(safeFailure({ code:'BACKUP_LIMIT' }), /상한/);
    assert.match(safeFailure({ code:8, message:'private-token' }), /한도/);
    assert.equal(safeFailure({code:'private-token', message:'private-token'}).includes('private-token'), false);
  } finally { await fs.rm(dir, {recursive:true,force:true}); }
});
test('restore diagnostics identify local write/read failures without private error details', async () => {
  const {safeDiagnostic} = require('./operations/restore-drill.cjs');
  assert.deepEqual(safeDiagnostic({restoreStage:'write',restoredDocuments:12,mismatch:'private-field',name:'TypeError',message:'private-data'}), {stage:'write',restoredDocuments:12,mismatch:null,errorType:'TypeError'});
  assert.equal(JSON.stringify(safeDiagnostic({restoreStage:'private-data',restoredDocuments:'private-data',name:'private-data',stack:'private-data'})).includes('private-data'),false);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dreamary-restore-diagnostics-'));
  const file = path.join(dir,'synthetic.drmbkp'), pass='synthetic-only-backup-passphrase';
  const oldHost=process.env.FIRESTORE_EMULATOR_HOST;
  process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8186';
  try {
    await exportBackup(database([['diaries/d0',{text:'synthetic'}]]).db,file,pass,10);
    const target=database().db;
    target.doc=()=>({set:async()=>{throw Object.assign(new Error('private-data'),{code:3})}});
    await assert.rejects(restoreDemo(target,file,pass,{verifyWrites:true}),{code:3,restoreStage:'write',restoredDocuments:0});
    target.doc=()=>({set:async()=>{},get:async()=>{throw Object.assign(new Error('private-data'),{code:14})}});
    await assert.rejects(restoreDemo(target,file,pass,{verifyWrites:true}),{code:14,restoreStage:'read-back',restoredDocuments:0});
  } finally {if(oldHost===undefined) delete process.env.FIRESTORE_EMULATOR_HOST;else process.env.FIRESTORE_EMULATOR_HOST=oldHost;await fs.rm(dir,{recursive:true,force:true});}
});
test('restore verifies multi-buffer unicode records with asynchronous database writes', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dreamary-restore-stream-'));
  const file=path.join(dir,'synthetic.drmbkp'),pass='synthetic-only-backup-passphrase';
  const source=database(Array.from({length:125},(_,i)=>['diaries/d'+i,{text:'한글🧪'.repeat(800),i,nested:{z:1,a:{b:null,a:true}}}]));
  const target=database();const oldHost=process.env.FIRESTORE_EMULATOR_HOST;process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8186';
  const doc=target.db.doc;
  target.db.doc=p=>({...doc(p),set:async value=>{await new Promise(resolve=>setImmediate(resolve));target.rows.set(p,value)}});
  try {
    await exportBackup(source.db,file,pass,200);
    assert.equal((await restoreDemo(target.db,file,pass,{verifyWrites:true})).documents,125);
    assert.equal(target.rows.size,125);
  } finally {if(oldHost===undefined) delete process.env.FIRESTORE_EMULATOR_HOST;else process.env.FIRESTORE_EMULATOR_HOST=oldHost;await fs.rm(dir,{recursive:true,force:true});}
});
test('shared backup reader preserves split UTF-8 and long JSON records under backpressure', async () => {
  const {jsonRecords}=require('./operations/backup.cjs');
  const rows=[{text:'가🧪\r\n문자\u2028끝'}, {text:'한글🧪'.repeat(30000)}, {complete:true,documents:2}];
  const bytes=Buffer.from(rows.map(row=>JSON.stringify(row)+'\n').join(''));
  async function* chunks(){for(let i=0;i<bytes.length;i+=127)yield bytes.subarray(i,i+127)}
  const result=[];
  for await(const record of jsonRecords(require('node:stream').Readable.from(chunks()))){await new Promise(resolve=>setTimeout(resolve,2));result.push(record)}
  assert.deepEqual(result,rows);
});
test('backup: growth beyond preflight count and nested data refuse incomplete success', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dreamary-backup-growth-'));
  const file = path.join(dir, 'backup.drmbkp'), pass='synthetic-backup-passphrase';
  try {
    const {db,rows}=database([['diaries/d0',{text:'synthetic'}]]);
    await assert.rejects(exportBackup(db,file,pass,1, event=>{ if(event.phase==='planned') rows.set('diaries/d1',{text:'new'}); }), {code:'BACKUP_LIMIT'});
    await assert.rejects(fs.stat(file), {code:'ENOENT'});
    rows.delete('diaries/d1');
    db.doc=path=>({path,listCollections:async()=>[{}]});
    await assert.rejects(exportBackup(db,file,pass,10), {code:'BACKUP_NESTED'});
    await assert.rejects(fs.stat(file), {code:'ENOENT'});
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
test('topic preparation reads 20 per page, dry run writes nothing and apply stores one bounded catalog', async () => {
  const { db, rows } = database(Array.from({ length: 45 }, (_, i) => ['topics/t' + i, { content: '주제', order: 45 - i }]));
  const options = { action: 'catalog', 'max-docs': '1000', apply: false };
  const result = await prepare(db, options); assert.equal(result.topics, 45); assert.equal(rows.has('topicCatalog/current'), false);
  await prepare(db, { ...options, apply: true }); assert.equal(rows.get('topicCatalog/current').topics[0].order, 1);
  await assert.rejects(prepare(db, { ...options, 'max-docs': '20' }));
});
test('test app has an explicit demo project and loopback API, never production data', () => {
  const env = buildEnvironment('test', { NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-dreamary-security' });
  assert.equal(env.NEXT_PUBLIC_API_URL, 'http://127.0.0.1:3000');
  assert.throws(() => buildEnvironment('test', { NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'dreamary-1a9af' }));
});

test('staging isolation rejects production credentials and prevents Next env defaults leaking into test builds', async () => {
  const { isolatedEnvironment, validateStaging } = require('./runtime-environment.cjs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dreamary-env-test-'));
  const input = { PATH: process.env.PATH, NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'dreamary-1a9af', FIREBASE_SERVICE_ACCOUNT_KEY: '{"project_id":"dreamary-1a9af"}', OPENROUTER_API_KEY: 'synthetic-production-key' };
  try {
    await fs.writeFile(path.join(dir, '.env.local'), 'UNKNOWN_PRODUCTION_SECRET=synthetic-secret\nNEXT_PUBLIC_MIXPANEL_TOKEN=synthetic-tracking\n');
    assert.throws(() => isolatedEnvironment('branch', input, dir), /staging/);
    const demo = isolatedEnvironment('test', input, dir);
    assert.equal(demo.OPENROUTER_API_KEY, ''); assert.equal(demo.FIREBASE_SERVICE_ACCOUNT_KEY, ''); assert.equal(demo.UNKNOWN_PRODUCTION_SECRET, '');
    assert.equal(demo.NEXT_PUBLIC_FIREBASE_PROJECT_ID, 'demo-dreamary-security');
    const staging = { DREAMARY_ENVIRONMENT:'staging', NEXT_PUBLIC_FIREBASE_PROJECT_ID:'dreamary-staging', NEXT_PUBLIC_API_URL:'https://dreamary-staging.netlify.app', NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:'dreamary-staging.firebaseapp.com' };
    await fs.writeFile(path.join(dir, '.env.staging.local'), Object.entries(staging).map(([k,v])=>k+'='+v).join('\n'));
    const result = isolatedEnvironment('branch', input, dir);
    assert.equal(result.NEXT_PUBLIC_FIREBASE_PROJECT_ID, 'dreamary-staging');
    assert.equal(result.NEXT_PUBLIC_MIXPANEL_TOKEN, ''); assert.equal(result.PATH, input.PATH);
    assert.throws(()=>validateStaging({...result,FIREBASE_SERVICE_ACCOUNT_KEY:input.FIREBASE_SERVICE_ACCOUNT_KEY}), /서비스 계정/);
    assert.throws(()=>validateStaging({...result,NEXT_PUBLIC_API_URL:'https://dreamary.netlify.app'}));
    assert.throws(()=>validateStaging(result,true), /서비스 계정/);
    assert.throws(()=>validateStaging({...result,FIRESTORE_EMULATOR_HOST:'localhost:8080'}));
    assert.equal(input.OPENROUTER_API_KEY, 'synthetic-production-key');
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});

test('deployed staging functions reject a production service account before database initialization', () => {
  const vm = require('node:vm'), ts = require('typescript'), source = require('node:fs').readFileSync(require.resolve('../src/lib/server/environmentGuard.ts'),'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,process:{env:{}},require:()=>({default:require('../app-build-targets.json')})});
  const env={DREAMARY_ENVIRONMENT:'staging',NEXT_PUBLIC_FIREBASE_PROJECT_ID:'dreamary-staging',NEXT_PUBLIC_API_URL:'https://dreamary-staging.netlify.app',FIREBASE_SERVICE_ACCOUNT_KEY:'{"project_id":"dreamary-staging"}'};
  assert.doesNotThrow(()=>exports.assertServerEnvironment(env));
  assert.throws(()=>exports.assertServerEnvironment({...env,FIREBASE_SERVICE_ACCOUNT_KEY:'{"project_id":"dreamary-1a9af"}'}));
  assert.throws(()=>exports.assertServerEnvironment({...env,FIREBASE_SERVICE_ACCOUNT_KEY:''}));
  assert.throws(()=>exports.assertServerEnvironment({...env,FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080'}));
});

test('mail endpoints load without a delivery key in isolated builds', async () => {
  const vm = require('node:vm'), ts = require('typescript');
  for (const file of ['src/app/api/auth/find-id/route.ts', 'netlify/functions/reset-password.mts', 'netlify/functions/auth-reset-password.ts']) {
    const source = await fs.readFile(path.join(__dirname,'..',file),'utf8');
    let constructions=0; const exports={};
    vm.runInNewContext(ts.transpileModule(source,{fileName:file.replace(/\.mts$/, '.ts'),compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,process:{env:{}},require:name=>name==='resend'?{Resend:class{constructor(){constructions++;throw new Error('No mail key');}}}:name==='next/server'?{NextResponse:{}}:name==='node:crypto'?require(name):{},console});
    assert.equal(constructions,0,file);
    assert.equal(typeof (exports.POST||exports.default),'function');
  }
});
