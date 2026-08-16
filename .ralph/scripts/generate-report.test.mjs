import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMermaid,
  buildTaskTable,
  buildCoverageSection,
  generateReport,
} from './generate-report.mjs';

const items = [
  { id: 'A', title: 'Hook', why: 'w', objective: 'o', files: ['a.ts'], model: 'light', testStrategy: 't', dependsOn: [], specs: { acceptanceCriteria: ['AC-1'], interfaces: ['DataHookResult'] } },
  { id: 'B', title: 'Container', why: 'w', objective: 'o', files: ['b.ts'], model: 'medium', testStrategy: 't', dependsOn: ['A'], specs: { acceptanceCriteria: ['AC-2'] } },
];
const progress = {
  A: { status: 'COMPLETED', attempts: 1, commitSha: 'a'.repeat(40), blockReason: null },
  B: { status: 'BLOCKED', attempts: 5, commitSha: null, blockReason: 'judge rejected: scope creep' },
};

test('buildMermaid emits one node per item, one edge per dependsOn, and status classes', () => {
  const mermaid = buildMermaid(items, progress);
  assert.match(mermaid, /flowchart TD/);
  assert.match(mermaid, /A\["Hook"\]/);
  assert.match(mermaid, /B\["Container"\]/);
  assert.match(mermaid, /A --> B/);
  assert.match(mermaid, /class A completed;/);
  assert.match(mermaid, /class B blocked;/);
});

test('buildTaskTable includes one row per item with status/attempts/short sha', () => {
  const table = buildTaskTable(items, progress);
  assert.match(table, /\| A \| Hook \| COMPLETED \| 1 \| aaaaaaa \| a\.ts \| - \|/);
  assert.match(table, /\| B \| Container \| BLOCKED \| 5 \| - \| b\.ts \| A \|/);
});

test('buildCoverageSection lists every requirement with its coverers', () => {
  const section = buildCoverageSection([{ requirement: 'AC-1', coveredBy: ['A'] }]);
  assert.match(section, /\| AC-1 \| A \|/);
});

test('generateReport composes a full report with summary counts and integration result', () => {
  const report = generateReport({
    contract: { items, coverageMap: [{ requirement: 'AC-1', coveredBy: ['A'] }] },
    progress,
    integrationResult: { passed: true, output: 'all green' },
    costSummary: { totalCostUsd: 1.2345 },
  });
  assert.match(report, /Items completed: 1\/2/);
  assert.match(report, /Blocked: 1/);
  assert.match(report, /\$1\.2345/);
  assert.match(report, /PASSED/);
  assert.match(report, /all green/);
  assert.match(report, /DataHookResult/);
});

test('buildMermaid escapes brackets in titles so node labels stay well-formed', () => {
  const bracketItems = [
    { id: 'C', title: 'Add PredictGrowth[v2] endpoint', dependsOn: [] },
  ];
  const mermaid = buildMermaid(bracketItems, {});
  const labelMatch = mermaid.match(/C\["([^\n]*)"\]/);
  assert.ok(labelMatch, 'expected a well-formed C["..."] node line');
  assert.ok(!labelMatch[1].includes('['), 'label must not contain an unescaped [');
  assert.ok(!labelMatch[1].includes(']'), 'label must not contain an unescaped ]');
});

test('buildTaskTable escapes pipe characters in titles so columns stay aligned', () => {
  const pipeItems = [
    { id: 'D', title: 'Fix a | bug', files: ['d.ts'], dependsOn: [] },
  ];
  const pipeProgress = {
    D: { status: 'PENDING', attempts: 0, commitSha: null, blockReason: null },
  };
  const table = buildTaskTable(pipeItems, pipeProgress);
  const dataRow = table.split('\n')[2];
  assert.match(dataRow, /Fix a \\\| bug/);
  // Same column count as a normal row (7 cells) when split on the unescaped ' | ' delimiter.
  assert.equal(dataRow.split(' | ').length, 7);
});
