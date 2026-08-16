import { readFileSync, writeFileSync } from 'node:fs';

export function toposort(items) {
  const ids = items.map((item) => item.id);
  const idSet = new Set(ids);
  const inDegree = new Map(ids.map((id) => [id, 0]));
  const dependents = new Map(ids.map((id) => [id, []]));

  for (const item of items) {
    for (const dep of item.dependsOn) {
      if (!idSet.has(dep)) {
        throw new Error(`Item "${item.id}" dependsOn unknown item "${dep}"`);
      }
      dependents.get(dep).push(item.id);
      inDegree.set(item.id, inDegree.get(item.id) + 1);
    }
  }

  const queue = ids.filter((id) => inDegree.get(id) === 0);
  const order = [];

  while (queue.length > 0) {
    const id = queue.shift();
    order.push(id);
    for (const next of dependents.get(id)) {
      inDegree.set(next, inDegree.get(next) - 1);
      if (inDegree.get(next) === 0) queue.push(next);
    }
  }

  if (order.length !== ids.length) {
    const stuck = ids.filter((id) => !order.includes(id));
    throw new Error(`Cycle detected: ${findCyclePath(stuck, items)}`);
  }

  return order;
}

function findCyclePath(stuckIds, items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const stuckSet = new Set(stuckIds);
  const visiting = new Set();
  const path = [];

  function dfs(id) {
    if (visiting.has(id)) {
      const cycleStart = path.indexOf(id);
      return [...path.slice(cycleStart), id];
    }
    visiting.add(id);
    path.push(id);
    for (const dep of byId.get(id).dependsOn) {
      if (stuckSet.has(dep)) {
        const found = dfs(dep);
        if (found) return found;
      }
    }
    path.pop();
    visiting.delete(id);
    return null;
  }

  for (const id of stuckIds) {
    const found = dfs(id);
    if (found) return found.join(' -> ');
  }
  return `${stuckIds.join(', ')} (cycle among these; exact path not isolated)`;
}

// CLI entrypoint — only runs when invoked directly, not when imported by the test.
if (process.argv[1] && process.argv[1].endsWith('toposort.mjs')) {
  const [, , contractPath, orderPath, failReportPath] = process.argv;
  const contract = JSON.parse(readFileSync(contractPath, 'utf8'));

  try {
    const order = toposort(contract.items);
    writeFileSync(orderPath, JSON.stringify(order, null, 2));
    console.log(`Toposort OK: ${order.join(', ')}`);
    process.exit(0);
  } catch (error) {
    writeFileSync(
      failReportPath,
      `# Contract Failed\n\n## Cycle detected\n\n\`\`\`\n${error.message}\n\`\`\`\n\nFix contract.json (or the spec that produced it) and re-run the Contract phase.\n`,
    );
    console.error(error.message);
    process.exit(1);
  }
}
