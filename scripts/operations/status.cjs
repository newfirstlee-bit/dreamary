// Read-only, bounded operational samples. No chat/diary/image/token contents.
const { database, args } = require('./database.cjs');
async function status(db) {
  const [jobs, images] = await Promise.all([
    db.collection('dataJobs').where('status', '==', 'pending').limit(5).get(),
    db.collection('imageDeletionQueue').where('status', '==', 'pending').limit(5).get(),
  ]);
  return {
    checkedAt: new Date().toISOString(),
    dataJobs: { sampled: jobs.size, mayHaveMore: jobs.size === 5, failedSamples: jobs.docs.filter(d => d.data().attempts > 0).length,
      oldestSampleAgeMinutes: Math.max(0, ...jobs.docs.map(d => Math.floor((Date.now() - d.data().createdAt) / 60000))) },
    imageDeletionQueue: { sampled: images.size, mayHaveMore: images.size === 5 },
  };
}
module.exports = { status };
if (require.main === module) {
  const options = args();
  status(database(options.project)).then(value => console.log(JSON.stringify(value))).catch(() => { console.error('Status read failed; check credentials and indexes.'); process.exitCode = 1; });
}
