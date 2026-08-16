import { readFileSync, writeFileSync } from 'node:fs';

function escapeMermaid(text) {
  return text.replace(/"/g, "'").replace(/\[/g, '(').replace(/\]/g, ')');
}

function escapeTableCell(text) {
  return String(text).replace(/\|/g, '\\|');
}

export function buildMermaid(items, progress) {
  const lines = ['flowchart TD'];
  for (const item of items) {
    lines.push(`    ${item.id}["${escapeMermaid(item.title)}"]`);
  }
  for (const item of items) {
    for (const dep of item.dependsOn) {
      lines.push(`    ${dep} --> ${item.id}`);
    }
  }
  lines.push('');
  lines.push('    classDef completed stroke:#2a2,stroke-width:2px;');
  lines.push('    classDef blocked stroke:#c00,stroke-width:2px;');
  lines.push('    classDef skipped stroke:#888,stroke-width:2px,stroke-dasharray: 4 2;');
  for (const item of items) {
    const status = progress[item.id]?.status;
    if (status === 'COMPLETED') lines.push(`    class ${item.id} completed;`);
    if (status === 'BLOCKED') lines.push(`    class ${item.id} blocked;`);
    if (status === 'SKIPPED') lines.push(`    class ${item.id} skipped;`);
  }
  return lines.join('\n');
}

export function buildTaskTable(items, progress) {
  const header = '| id | title | status | attempts | commit | files | dependsOn |\n|---|---|---|---|---|---|---|';
  const rows = items.map((item) => {
    const p = progress[item.id] || { status: 'PENDING', attempts: 0, commitSha: null };
    const commit = p.commitSha ? p.commitSha.slice(0, 7) : '-';
    const deps = item.dependsOn.length ? item.dependsOn.join(', ') : '-';
    return `| ${item.id} | ${escapeTableCell(item.title)} | ${p.status} | ${p.attempts} | ${commit} | ${escapeTableCell(item.files.join(', '))} | ${escapeTableCell(deps)} |`;
  });
  return [header, ...rows].join('\n');
}

export function buildCoverageSection(coverageMap) {
  const header = '| requirement | covered by |\n|---|---|';
  const rows = coverageMap.map((entry) => `| ${entry.requirement} | ${entry.coveredBy.join(', ')} |`);
  return [header, ...rows].join('\n');
}

export function buildContractsAppendix(items) {
  return items
    .map((item) => {
      const parts = [`### ${item.id} — ${escapeTableCell(item.title)}`];
      if (item.specs.interfaces?.length) {
        parts.push(`**Interfaces:**\n\`\`\`\n${item.specs.interfaces.join('\n')}\n\`\`\``);
      }
      if (item.specs.types?.length) {
        parts.push(`**Types:**\n\`\`\`\n${item.specs.types.join('\n')}\n\`\`\``);
      }
      if (item.specs.signatures?.length) {
        parts.push(`**Signatures:**\n\`\`\`\n${item.specs.signatures.join('\n')}\n\`\`\``);
      }
      return parts.join('\n\n');
    })
    .join('\n\n');
}

export function generateReport({ contract, progress, integrationResult, costSummary }) {
  const items = contract.items;
  const statuses = items.map((item) => progress[item.id]?.status || 'PENDING');
  const completed = statuses.filter((s) => s === 'COMPLETED').length;
  const blocked = statuses.filter((s) => s === 'BLOCKED').length;
  const skipped = statuses.filter((s) => s === 'SKIPPED').length;

  return `# Ralph Loop Report

## Summary

- Items completed: ${completed}/${items.length}
- Blocked: ${blocked}
- Skipped: ${skipped}
- Total cost: $${costSummary.totalCostUsd.toFixed(4)}

## Graph

\`\`\`mermaid
${buildMermaid(items, progress)}
\`\`\`

## Tasks

${buildTaskTable(items, progress)}

## Coverage Map

${buildCoverageSection(contract.coverageMap)}

## Frozen Contracts

${buildContractsAppendix(items)}

## Final Integration Pass

${integrationResult.passed ? 'PASSED' : 'FAILED'}

\`\`\`
${integrationResult.output}
\`\`\`
`;
}

if (process.argv[1] && process.argv[1].endsWith('generate-report.mjs')) {
  const [, , contractPath, progressPath, integrationResultPath, costSummaryPath, outputPath] = process.argv;
  const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
  const progress = JSON.parse(readFileSync(progressPath, 'utf8'));
  const integrationResult = JSON.parse(readFileSync(integrationResultPath, 'utf8'));
  const costSummary = JSON.parse(readFileSync(costSummaryPath, 'utf8'));
  const report = generateReport({ contract, progress, integrationResult, costSummary });
  writeFileSync(outputPath, report);
  console.log(`Report written to ${outputPath}`);
}
