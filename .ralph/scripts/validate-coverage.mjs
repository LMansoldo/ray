import { readFileSync, writeFileSync } from 'node:fs';

export function findOrphans(coverageMap) {
  return coverageMap
    .filter((entry) => entry.coveredBy.length === 0)
    .map((entry) => entry.requirement);
}

if (process.argv[1] && process.argv[1].endsWith('validate-coverage.mjs')) {
  const [, , contractPath, failReportPath] = process.argv;
  const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
  const orphans = findOrphans(contract.coverageMap);

  if (orphans.length === 0) {
    console.log('Coverage OK: every requirement has >=1 covering item.');
    process.exit(0);
  }

  const list = orphans.map((requirement) => `- ${requirement}`).join('\n');
  writeFileSync(
    failReportPath,
    `# Contract Failed\n\n## Orphaned requirements (no covering item)\n\n${list}\n\nRevise the spec or re-run the Contract phase so every requirement maps to >=1 item.\n`,
  );
  console.error(`Coverage FAILED: ${orphans.length} orphaned requirement(s).`);
  process.exit(1);
}
