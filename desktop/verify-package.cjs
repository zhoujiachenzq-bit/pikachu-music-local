const { execFileSync } = require('node:child_process');
const path = require('node:path');
module.exports = async context => {
  const resources = path.join(context.appOutDir, 'resources');
  execFileSync(path.join(resources, 'node.exe'), [path.join(__dirname, 'smoke-runtime.mjs'), resources], { stdio: 'inherit', timeout: 60000, windowsHide: true });
};
