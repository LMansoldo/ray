import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPrompt, itemToPromptValues } from './render-prompt.mjs';

test('replaces every occurrence of a placeholder', () => {
  const out = renderPrompt('{{X}} and {{X}} again', { X: 'hi' });
  assert.equal(out, 'hi and hi again');
});

test('throws when a placeholder is left unresolved', () => {
  assert.throws(() => renderPrompt('{{X}} {{Y}}', { X: 'hi' }), /Unresolved placeholders: \{\{Y\}\}/);
});

test('itemToPromptValues flattens a full item', () => {
  const item = {
    id: 'A',
    title: 'Add sum util',
    why: 'AC-1 needs a sum helper',
    objective: 'implement sum(a, b)',
    files: ['src/sum.ts'],
    model: 'light',
    testStrategy: 'unit test with a few number pairs',
    dependsOn: [],
    projectRules: ['no any'],
    specs: {
      interfaces: [],
      types: [],
      props: [],
      signatures: ['sum(a: number, b: number): number'],
      acceptanceCriteria: ['AC-1: sum(2,3) === 5'],
      notes: '',
    },
  };
  const values = itemToPromptValues(item);
  assert.equal(values.ITEM_ID, 'A');
  assert.equal(values.ITEM_OBJECTIVE, 'implement sum(a, b)');
  assert.equal(values.ITEM_FILES, '- src/sum.ts');
  assert.equal(values.ITEM_SPECS_SIGNATURES, 'sum(a: number, b: number): number');
  assert.equal(values.ITEM_SPECS_ACCEPTANCE_CRITERIA, '- AC-1: sum(2,3) === 5');
  assert.equal(values.ITEM_PROJECT_RULES, '- no any');
});

test('itemToPromptValues defaults absent optional arrays to a placeholder string', () => {
  const item = {
    id: 'B',
    title: 't',
    why: 'w',
    objective: 'o',
    files: [],
    model: 'light',
    testStrategy: 'ts',
    dependsOn: [],
    specs: { acceptanceCriteria: ['AC-2'] },
  };
  const values = itemToPromptValues(item);
  assert.equal(values.ITEM_PROJECT_RULES, '(none declared)');
  assert.equal(values.ITEM_SPECS_INTERFACES, '(none)');
  assert.equal(values.ITEM_SPECS_NOTES, '(none)');
});
