import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildCommitMessage, commitItem } from './commit-item.mjs';

function makeTempRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ralph-commit-test-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  return dir;
}

test('buildCommitMessage includes id, title, objective, attempt', () => {
  const item = { id: 'A', title: 'Add sum util', objective: 'implement sum(a, b)' };
  const message = buildCommitMessage(item, 2);
  assert.match(message, /Add sum util/);
  assert.match(message, /implement sum\(a, b\)/);
  assert.match(message, /item A, attempt 2/);
});

test('commits exactly the given files and returns a real sha', () => {
  const dir = makeTempRepo();
  writeFileSync(path.join(dir, 'a.txt'), 'a');
  writeFileSync(path.join(dir, 'b.txt'), 'b (should not be committed)');
  const result = commitItem({ cwd: dir, files: ['a.txt'], message: 'feat: only a.txt' });
  assert.equal(result.success, true);
  assert.match(result.sha, /^[0-9a-f]{40}$/);
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString();
  assert.match(status, /\?\? b\.txt/); // b.txt still untracked
  const log = execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: dir }).toString().trim();
  assert.equal(log, 'feat: only a.txt');
});

test('refuses to commit an empty file list', () => {
  const dir = makeTempRepo();
  const result = commitItem({ cwd: dir, files: [], message: 'feat: nothing' });
  assert.equal(result.success, false);
  assert.match(result.stderr, /No files to commit/);
});

test('reports failure without throwing when a pre-commit hook rejects', () => {
  const dir = makeTempRepo();
  const hooksDir = path.join(dir, '.git', 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  const hookPath = path.join(hooksDir, 'pre-commit');
  writeFileSync(hookPath, '#!/bin/sh\necho "blocked by hook" >&2\nexit 1\n');
  chmodSync(hookPath, 0o755);
  writeFileSync(path.join(dir, 'a.txt'), 'a');
  const result = commitItem({ cwd: dir, files: ['a.txt'], message: 'feat: should be blocked' });
  assert.equal(result.success, false);
  assert.match(result.stderr, /git commit failed/);
});
