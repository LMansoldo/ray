import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRunShConfig,
  resolveStateDir,
  buildOrderedRows,
  renderFrame,
} from './watch-progress.mjs';

test('parseRunShConfig reads branch, budget cap, and max attempts out of run.sh', () => {
  const runSh = [
    'BRANCH_NAME="ralph/fase-0-fundacao"',
    'MAX_ATTEMPTS_PER_ITEM="5"',
    'TOTAL_BUDGET_USD="20"',
  ].join('\n');
  assert.deepEqual(parseRunShConfig(runSh), {
    branchName: 'ralph/fase-0-fundacao',
    totalBudgetUsd: 20,
    maxAttemptsPerItem: 5,
  });
});

test('parseRunShConfig throws when BRANCH_NAME is missing', () => {
  assert.throws(() => parseRunShConfig('MODEL_STRONG="opus"'), /BRANCH_NAME not found/);
});

test('resolveStateDir mirrors run.sh: sibling dir named <repo>-<slugified-branch>/.ralph-run', () => {
  const stateDir = resolveStateDir('/Users/x/Projects/ray', 'ralph/fase-0-fundacao');
  assert.equal(stateDir, '/Users/x/Projects/ray-ralph-fase-0-fundacao/.ralph-run');
});

test('buildOrderedRows marks the first still-PENDING item as RUNNING', () => {
  const contract = { items: [{ id: 'A', title: 'A', model: 'light', dependsOn: [] }, { id: 'B', title: 'B', model: 'medium', dependsOn: ['A'] }] };
  const progress = {
    A: { status: 'COMPLETED', attempts: 1, blockReason: null },
    B: { status: 'PENDING', attempts: 0, blockReason: null },
  };
  const rows = buildOrderedRows(contract, progress, ['A', 'B']);
  assert.equal(rows[0].display, 'COMPLETED');
  assert.equal(rows[1].display, 'RUNNING');
});

test('buildOrderedRows marks a PENDING item as WILL SKIP when its dependency is BLOCKED', () => {
  const contract = { items: [{ id: 'A', title: 'A', dependsOn: [] }, { id: 'B', title: 'B', dependsOn: ['A'] }] };
  const progress = {
    A: { status: 'BLOCKED', attempts: 5, blockReason: 'judge rejected' },
    B: { status: 'PENDING', attempts: 0, blockReason: null },
  };
  const rows = buildOrderedRows(contract, progress, ['A', 'B']);
  assert.equal(rows[1].display, 'WILL SKIP (A)');
});

test('buildOrderedRows only assigns RUNNING to the first eligible pending item, not later ones', () => {
  const contract = { items: [{ id: 'A', title: 'A', dependsOn: [] }, { id: 'B', title: 'B', dependsOn: [] }] };
  const progress = {
    A: { status: 'PENDING', attempts: 0, blockReason: null },
    B: { status: 'PENDING', attempts: 0, blockReason: null },
  };
  const rows = buildOrderedRows(contract, progress, ['A', 'B']);
  assert.equal(rows[0].display, 'RUNNING');
  assert.equal(rows[1].display, 'PENDING');
});

test('renderFrame shows a waiting message when contract.json does not exist yet', () => {
  const frame = renderFrame({
    contract: null,
    progress: null,
    order: null,
    cost: null,
    config: { branchName: 'ralph/x', totalBudgetUsd: 20, maxAttemptsPerItem: 5 },
    stateDir: '/tmp/state',
  });
  assert.match(frame, /waiting for Contract phase/);
});

test('renderFrame includes summary counts, budget line, and one row per item', () => {
  const contract = { items: [{ id: 'A', title: 'Do the thing', model: 'light', dependsOn: [] }] };
  const progress = { A: { status: 'COMPLETED', attempts: 1, blockReason: null } };
  const cost = { totalCostUsd: 1.5, calls: [{ phase: 'x', costUsd: 1.5 }] };
  const frame = renderFrame({
    contract,
    progress,
    order: ['A'],
    cost,
    config: { branchName: 'ralph/x', totalBudgetUsd: 20, maxAttemptsPerItem: 5 },
    stateDir: '/tmp/state',
  });
  assert.match(frame, /1\/1 completed/);
  assert.match(frame, /\$1\.5000 \/ \$20\.00 spent \(1 calls\)/);
  assert.match(frame, /Do the thing/);
});
