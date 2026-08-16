// ~/.claude/skills/ralph-loop/templates/scripts/toposort.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toposort } from './toposort.mjs';

test('orders a linear chain A -> B -> C', () => {
  const items = [
    { id: 'C', dependsOn: ['B'] },
    { id: 'A', dependsOn: [] },
    { id: 'B', dependsOn: ['A'] },
  ];
  assert.deepEqual(toposort(items), ['A', 'B', 'C']);
});

test('orders independent items before their dependents, any order among independents', () => {
  const items = [
    { id: 'A', dependsOn: [] },
    { id: 'D', dependsOn: [] },
    { id: 'B', dependsOn: ['A'] },
    { id: 'C', dependsOn: ['B'] },
  ];
  const order = toposort(items);
  assert.ok(order.indexOf('A') < order.indexOf('B'));
  assert.ok(order.indexOf('B') < order.indexOf('C'));
  assert.equal(order.length, 4);
});

test('throws with the exact cycle path on a circular dependency', () => {
  const items = [
    { id: 'A', dependsOn: ['B'] },
    { id: 'B', dependsOn: ['C'] },
    { id: 'C', dependsOn: ['A'] },
  ];
  assert.throws(() => toposort(items), /A -> B -> C -> A|B -> C -> A -> B|C -> A -> B -> C/);
});

test('throws when dependsOn references an unknown item id', () => {
  const items = [{ id: 'A', dependsOn: ['ghost'] }];
  assert.throws(() => toposort(items), /unknown item "ghost"/);
});
