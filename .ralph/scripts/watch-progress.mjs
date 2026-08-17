import { readFileSync, existsSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const GRAY = '\x1b[90m';

const STATUS_COLOR = {
  COMPLETED: GREEN,
  BLOCKED: RED,
  SKIPPED: GRAY,
  RUNNING: CYAN + BOLD,
  PENDING: DIM,
};

export function parseRunShConfig(runShText) {
  const branchMatch = runShText.match(/^BRANCH_NAME="([^"]*)"/m);
  if (!branchMatch) throw new Error('BRANCH_NAME not found in run.sh');
  const budgetMatch = runShText.match(/^TOTAL_BUDGET_USD="([^"]*)"/m);
  const attemptsMatch = runShText.match(/^MAX_ATTEMPTS_PER_ITEM="([^"]*)"/m);
  return {
    branchName: branchMatch[1],
    totalBudgetUsd: budgetMatch ? Number(budgetMatch[1]) : null,
    maxAttemptsPerItem: attemptsMatch ? Number(attemptsMatch[1]) : null,
  };
}

export function resolveStateDir(sourceRepo, branchName) {
  const repoName = basename(sourceRepo);
  const slug = branchName.replace(/\//g, '-');
  const worktreeDir = join(dirname(sourceRepo), `${repoName}-${slug}`);
  return join(worktreeDir, '.ralph-run');
}

function firstUnresolvedDependency(item, progress) {
  const deps = item?.dependsOn ?? [];
  return deps.find((dep) => {
    const depStatus = progress?.[dep]?.status;
    return depStatus === 'BLOCKED' || depStatus === 'SKIPPED';
  });
}

// Progress.json only records terminal states (COMPLETED/BLOCKED/SKIPPED); the item
// currently being attempted is still PENDING there. run.sh works order.json
// sequentially, so the first still-PENDING item with no blocked/skipped dependency is
// the one presumed in flight — a display guess, not a fact read from disk.
export function buildOrderedRows(contract, progress, order) {
  const items = contract?.items ?? [];
  const byId = new Map(items.map((item) => [item.id, item]));
  const ids = order?.length ? order : items.map((item) => item.id);

  let runningAssigned = false;
  return ids.map((id) => {
    const item = byId.get(id);
    const p = progress?.[id] ?? { status: 'PENDING', attempts: 0, commitSha: null, blockReason: null };
    let display = p.status;
    if (p.status === 'PENDING') {
      const blockedDep = firstUnresolvedDependency(item, progress);
      if (blockedDep) {
        display = `WILL SKIP (${blockedDep})`;
      } else if (!runningAssigned) {
        display = 'RUNNING';
        runningAssigned = true;
      }
    }
    return {
      id,
      title: item?.title ?? '(unknown)',
      model: item?.model ?? '-',
      status: p.status,
      display,
      attempts: p.attempts,
      blockReason: p.blockReason,
    };
  });
}

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);
}

function colorFor(row) {
  if (row.display.startsWith('WILL SKIP')) return YELLOW;
  return STATUS_COLOR[row.display] ?? RESET;
}

function formatBudgetLine(cost, totalBudgetUsd) {
  const spent = cost?.totalCostUsd ?? 0;
  const calls = cost?.calls?.length ?? 0;
  const cap = totalBudgetUsd ? ` / $${totalBudgetUsd.toFixed(2)}` : '';
  return `$${spent.toFixed(4)}${cap} spent (${calls} calls)`;
}

function formatRow(row, config, columnWidths) {
  const color = colorFor(row);
  const attempts = config.maxAttemptsPerItem ? `${row.attempts}/${config.maxAttemptsPerItem}` : String(row.attempts);
  let note = row.title;
  if (row.status === 'BLOCKED' && row.blockReason) {
    note = `${row.title}  ${DIM}(${row.blockReason.slice(0, 60)})${RESET}`;
  }
  return `${color}${pad(row.id, columnWidths.id)}${pad(row.display, columnWidths.status)}${RESET}${pad(attempts, 6)}${pad(row.model, 8)}${note}`;
}

function computeColumnWidths(rows) {
  const idWidth = Math.max(2, ...rows.map((row) => row.id.length)) + 2;
  const statusWidth = Math.max(6, ...rows.map((row) => row.display.length)) + 2;
  return { id: idWidth, status: statusWidth };
}

export function renderFrame({ contract, progress, order, cost, config, stateDir }) {
  const lines = [`${BOLD}ralph-loop${RESET} — branch ${config.branchName} — ${DIM}${stateDir}${RESET}`];

  if (!contract) {
    lines.push('', `${DIM}waiting for Contract phase to finish (contract.json not written yet)...${RESET}`);
    return lines.join('\n');
  }

  const rows = buildOrderedRows(contract, progress, order);
  const completed = rows.filter((r) => r.status === 'COMPLETED').length;
  const blocked = rows.filter((r) => r.status === 'BLOCKED').length;
  const skipped = rows.filter((r) => r.status === 'SKIPPED').length;
  const columnWidths = computeColumnWidths(rows);

  lines.push(
    `${completed}/${rows.length} completed  ${RED}${blocked} blocked${RESET}  ${GRAY}${skipped} skipped${RESET}  —  ${formatBudgetLine(cost, config.totalBudgetUsd)}`,
    '',
    `${DIM}${pad('ID', columnWidths.id)}${pad('STATUS', columnWidths.status)}${pad('ATT', 6)}${pad('MODEL', 8)}TITLE${RESET}`,
    ...rows.map((row) => formatRow(row, config, columnWidths)),
  );

  return lines.join('\n');
}

function readJsonIfExists(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

function parseCliArgs(argv) {
  let stateDirOverride = null;
  let pollSeconds = 2;
  for (const arg of argv) {
    if (arg.startsWith('--state-dir=')) stateDirOverride = arg.slice('--state-dir='.length);
    else if (arg.startsWith('--interval=')) pollSeconds = Number(arg.slice('--interval='.length));
  }
  return { stateDirOverride, pollSeconds };
}

if (process.argv[1] && process.argv[1].endsWith('watch-progress.mjs')) {
  const scriptsDir = dirname(fileURLToPath(import.meta.url));
  const ralphDir = dirname(scriptsDir);
  const sourceRepo = dirname(ralphDir);
  const config = parseRunShConfig(readFileSync(join(ralphDir, 'run.sh'), 'utf8'));

  const { stateDirOverride, pollSeconds } = parseCliArgs(process.argv.slice(2));
  const stateDir = stateDirOverride ?? resolveStateDir(sourceRepo, config.branchName);

  const tick = () => {
    const frame = renderFrame({
      contract: readJsonIfExists(join(stateDir, 'contract.json')),
      progress: readJsonIfExists(join(stateDir, 'progress.json')),
      order: readJsonIfExists(join(stateDir, 'order.json')),
      cost: readJsonIfExists(join(stateDir, 'cost.json')),
      config,
      stateDir,
    });
    process.stdout.write('\x1b[2J\x1b[H');
    process.stdout.write(frame);
    process.stdout.write(`\n\n${DIM}refreshing every ${pollSeconds}s — ctrl+c to exit — ${new Date().toISOString()}${RESET}\n`);
  };

  tick();
  setInterval(tick, pollSeconds * 1000);
}
