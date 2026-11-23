import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Vercel serves Vite assets and routes API requests to the Express function first', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
    framework: string;
    installCommand: string;
    buildCommand: string;
    outputDirectory: string;
    rewrites: Array<{ source: string; destination: string }>;
  };

  assert.equal(config.framework, 'vite');
  assert.equal(config.installCommand, 'npm ci');
  assert.equal(config.buildCommand, 'npm run build');
  assert.equal(config.outputDirectory, 'dist');
  assert.deepEqual(config.rewrites, [
    { source: '/api/:__futura_vercel_path*', destination: '/api/[...path]' },
    { source: '/(.*)', destination: '/index.html' },
  ]);
});
