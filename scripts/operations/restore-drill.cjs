// Local-only recovery drill. Never loads production credentials or prints records.
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { createReadStream } = require('node:fs');
const { verifyBackup, restoreDemo, safeFailure } = require('./backup.cjs');

function safeDiagnostic(error) {
  return {
    stage: ['decrypt','parse','decode','write','read-back','compare','final-count'].includes(error?.restoreStage) ? error.restoreStage : 'preflight-or-finalize',
    restoredDocuments: Number.isSafeInteger(error?.restoredDocuments) ? error.restoredDocuments : null,
    mismatch: ['invalid-encoding','value-type','map-keys','array-length','timestamp-value','point-value','ref-value','bytes-value','number-value','value-value','structure','missing-document'].includes(error?.mismatch) ? error.mismatch : null,
    errorType: ['TypeError','RangeError','SyntaxError'].includes(error?.name) ? error.name : 'Error',
  };
}

async function drill(file, passphrase, sourceProject) {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8186') throw new Error('Dedicated local emulator required');
  const verified = await verifyBackup(file, passphrase, sourceProject);
  const projectId = 'demo-dreamary-backup-drill';
  const app = initializeApp({ projectId }, 'restore-drill');
  const db = getFirestore(app);
  try {
    if ((await db.listCollections()).length) throw new Error('Empty emulator required');
    console.log(`격리 복원 시작: ${verified.documents}개. 저장된 내용을 한 건씩 다시 읽어 원본과 비교합니다.`);
    const restored = await restoreDemo(db, file, passphrase, {
      verifyWrites: true,
      progress: count => console.log(`복원·내용 대조: ${count} / ${verified.documents}개`),
    });
    if (restored.documents !== verified.documents) throw new Error('Count mismatch');
    const hash = crypto.createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    const result = { sourceProject, targetProject: projectId, documents: restored.documents, verifiedEveryDocument: true, sha256: hash.digest('hex'), completedAt: new Date().toISOString() };
    await fs.writeFile(file + '.restore-check.json', JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    return result;
  } finally { await db.terminate(); await deleteApp(app); }
}

module.exports = { drill, safeDiagnostic };
if (require.main === module) {
  drill(process.env.DREAMARY_RESTORE_FILE, process.env.BACKUP_PASSPHRASE, process.env.DREAMARY_RESTORE_SOURCE || 'dreamary-1a9af')
    .then(result => console.log(`격리 복원·전체 내용 대조 완료: ${result.documents}개`))
    .catch(async error => {
      const diagnostic = safeDiagnostic(error);
      console.error(`격리 복원 실패: ${safeFailure(error)}`);
      console.error(`안전 진단: ${JSON.stringify(diagnostic)}`);
      // No document IDs, field names, data, stack traces, or credentials are retained.
      if (process.env.DREAMARY_RESTORE_FILE) await fs.writeFile(process.env.DREAMARY_RESTORE_FILE + '.restore-failure.json', JSON.stringify(diagnostic, null, 2) + '\n', {mode:0o600}).catch(()=>{});
      process.exitCode = 1;
    });
}
