const fs = require('node:fs');
const path = require('node:path');
const { nativeDescriptor, assertCompatible } = require('./ota-bundle.cjs');

function nativeOtaConfig(root) {
  const built = JSON.parse(fs.readFileSync(path.join(root, 'out/ota-build.json')));
  assertCompatible(nativeDescriptor(root, built.target), built);
  const config = require(path.join(root, 'ota.config.json'))[built.target];
  return {
    defaultChannel: built.target + '.' + built.nativeHash,
    ...(config.enabled ? { publicKey: config.publicKey } : {}),
    httpTimeout: 30000,
  };
}
module.exports = { nativeOtaConfig };
