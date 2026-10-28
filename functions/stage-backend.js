const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const backendDist = path.join(root, 'backend', 'dist');
const runtimeDir = path.join(__dirname, 'backend', 'runtime');
const configSource = path.join(root, 'config');
const configTarget = path.join(__dirname, 'config');

if (!fs.existsSync(path.join(backendDist, 'serverless.js'))) {
  throw new Error('NestJS build is missing. Run the backend build before staging Firebase Functions.');
}

fs.rmSync(runtimeDir, { recursive: true, force: true });
fs.mkdirSync(path.dirname(runtimeDir), { recursive: true });
fs.cpSync(backendDist, runtimeDir, { recursive: true });

fs.rmSync(configTarget, { recursive: true, force: true });
fs.cpSync(configSource, configTarget, { recursive: true });

console.log('Staged NestJS API build and runtime configuration for Firebase Functions.');
