const fs = require('node:fs');
const path = require('node:path');

for (const generatedPath of [
  path.join(__dirname, 'backend', 'runtime'),
  path.join(__dirname, 'config'),
]) {
  fs.rmSync(generatedPath, { recursive: true, force: true });
}

console.log('Removed staged NestJS build files after Firebase Functions deployment.');
