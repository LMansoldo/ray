import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findOrphans } from './validate-coverage.mjs';

test('returns empty array when every requirement has a coverer', () => {
  const coverageMap = [
    { requirement: 'AC-1', coveredBy: ['A'] },
    { requirement: 'AC-2', coveredBy: ['B', 'C'] },
  ];
  assert.deepEqual(findOrphans(coverageMap), []);
});

test('returns the requirement text for empty coveredBy arrays', () => {
  const coverageMap = [
    { requirement: 'AC-1', coveredBy: ['A'] },
    { requirement: 'AC-2 (loading state)', coveredBy: [] },
  ];
  assert.deepEqual(findOrphans(coverageMap), ['AC-2 (loading state)']);
});

test('treats an empty coverageMap as zero orphans', () => {
  assert.deepEqual(findOrphans([]), []);
});
