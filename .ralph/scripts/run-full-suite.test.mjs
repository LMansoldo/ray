import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runFullSuite } from './run-full-suite.mjs';

test('reports passed: true and captures stdout for a succeeding command', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ralph-suite-test-'));
  const result = runFullSuite('echo hello-from-suite', dir);
  assert.equal(result.passed, true);
  assert.match(result.output, /hello-from-suite/);
});

test('reports passed: false and captures output for a failing command', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ralph-suite-test-'));
  const result = runFullSuite('echo failing-output && false', dir);
  assert.equal(result.passed, false);
  assert.match(result.output, /failing-output/);
});

test('runs the command in the given cwd', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ralph-suite-test-'));
  const result = runFullSuite('pwd', dir);
  assert.equal(result.passed, true);
  assert.match(result.output.trim(), new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
});
