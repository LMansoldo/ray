#!/usr/bin/env bash
set -euo pipefail

# --- Generation-time values (substituted by the ralph-loop skill at scaffold time) ---
# One or more spec files — {{SPEC_PATHS}} is substituted as a quoted, space-separated
# list (e.g. "/path/one.md" "/path/two.md"), so this array always has >=1 element
# (never empty — safe to expand under set -u even on bash 3.2, which chokes on
# expanding a genuinely EMPTY array, not a populated one).
SPEC_PATHS=("/Users/lucasmansoldo/Projects/ray/docs/TASKS.md" "/Users/lucasmansoldo/Projects/ray/docs/docs/SRS-Ray.md" "/Users/lucasmansoldo/Projects/ray/docs/docs/ADR-Ray.md" "/Users/lucasmansoldo/Projects/ray/docs/README.md" "/Users/lucasmansoldo/Projects/ray/.ralph/SCOPE.md")
BRANCH_NAME="ralph/fase-1-sidecar-agente"
MAX_ATTEMPTS_PER_ITEM="5"
PER_CALL_BUDGET_USD="2"
TOTAL_BUDGET_USD="20"
SETUP_CMD="cd sidecar && npm install"
MODEL_LIGHT="mimo-v2.5-pro"
MODEL_MEDIUM="mimo-v2.5-pro"
MODEL_STRONG="deepseek-v4-pro[1m]"
FULL_SUITE_CMD="cd core && cargo check && cd ../sidecar && npm run typecheck && npm test && cd .. && npx prisma validate"

# CLI binary invoked per model tier. Defaults to the standard `claude` CLI
# (Anthropic auth). A tier can instead point at a wrapper script that exports its
# own ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN/ANTHROPIC_MODEL to run that tier's
# calls against a different backend — e.g. `claude-mimo.sh`, which points Claude
# Code at a Xiaomi MiMo-compatible endpoint. This works because every call below
# is spawned as its own subprocess: distinct env vars per tier never collide,
# unlike trying to run two differently-configured `claude` invocations inside the
# same interactive session. light/medium here run the RED/GREEN worker stages on
# mimo-v2.5-pro; judges (always MODEL_STRONG/CLAUDE_BIN_STRONG) stay on real opus.
CLAUDE_BIN_LIGHT="$HOME/claude-mimo.sh"
CLAUDE_BIN_MEDIUM="$HOME/claude-mimo.sh"
CLAUDE_BIN_STRONG="$HOME/claude-deepseek.sh"

RALPH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_REPO="$(cd "$RALPH_DIR/.." && pwd)"
SCRIPTS="$RALPH_DIR/scripts"
PROMPTS="$RALPH_DIR/prompts"
SCHEMAS="$RALPH_DIR/schemas"

REPO_NAME="$(basename "$SOURCE_REPO")"
SLUG="$(echo "$BRANCH_NAME" | tr '/' '-')"
WORKTREE_DIR="$(dirname "$SOURCE_REPO")/${REPO_NAME}-${SLUG}"
STATE_DIR="$WORKTREE_DIR/.ralph-run"
MEMORY_DIR="$STATE_DIR/memory"

fail() { echo "ABORT: $1" >&2; exit 1; }

record_cost() {
  local phase="$1" cost="$2"
  node -e "
    const fs = require('fs');
    const path = '$STATE_DIR/cost.json';
    const summary = JSON.parse(fs.readFileSync(path, 'utf8'));
    summary.totalCostUsd += $cost;
    summary.calls.push({ phase: '$phase', costUsd: $cost });
    fs.writeFileSync(path, JSON.stringify(summary, null, 2));
  "
  local total
  total="$(jq '.totalCostUsd' "$STATE_DIR/cost.json")"
  if awk -v t="$total" -v cap="$TOTAL_BUDGET_USD" 'BEGIN { exit !(t > cap) }'; then
    fail "total run budget exceeded (\$$total > \$$TOTAL_BUDGET_USD) — see $STATE_DIR/cost.json"
  fi
}

# Writes one progress.json entry. Passes free-text (item ids, judge findings) through
# environment variables, never interpolated into the JS source string — item ids come
# from the Contract phase's LLM output and blockReason from judge findings, both of
# which can contain quotes/backticks that would otherwise break out of a JS string
# literal built with bash interpolation.
write_progress() {
  ITEM_ID_ENV="$1" STATUS_ENV="$2" ATTEMPTS_ENV="$3" SHA_ENV="${4:-}" REASON_ENV="${5:-}" \
  node -e "
    const fs = require('fs');
    const path = '$STATE_DIR/progress.json';
    const p = JSON.parse(fs.readFileSync(path, 'utf8'));
    p[process.env.ITEM_ID_ENV] = {
      status: process.env.STATUS_ENV,
      attempts: Number(process.env.ATTEMPTS_ENV),
      commitSha: process.env.SHA_ENV || null,
      blockReason: process.env.REASON_ENV || null,
    };
    fs.writeFileSync(path, JSON.stringify(p, null, 2));
  "
}

call_claude_structured() {
  local prompt_file="$1" model="$2" schema_file="$3" allowed_tools="$4" out="$5" bin="${6:-claude}"
  local prompt; prompt="$(cat "$prompt_file")"
  local tools_args=()
  [ -n "$allowed_tools" ] && tools_args=(--allowedTools "$allowed_tools")
  "$bin" -p "$prompt" --model "$model" --output-format json \
    --json-schema "$(cat "$schema_file")" \
    --dangerously-skip-permissions --max-budget-usd "$PER_CALL_BUDGET_USD" \
    "${tools_args[@]+"${tools_args[@]}"}" > "$out"
  record_cost "$(basename "$prompt_file")" "$(jq '.total_cost_usd' "$out")"
}

call_claude_free() {
  local prompt_file="$1" model="$2" out="$3" bin="${4:-claude}"
  local prompt; prompt="$(cat "$prompt_file")"
  "$bin" -p "$prompt" --model "$model" --output-format json \
    --dangerously-skip-permissions --max-budget-usd "$PER_CALL_BUDGET_USD" \
    > "$out"
  record_cost "$(basename "$prompt_file")" "$(jq '.total_cost_usd' "$out")"
}

# --- Phase 0: Setup (deterministic) ---
cd "$SOURCE_REPO"
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$CURRENT_BRANCH" != "main" ] || fail "refusing to run from main"
[ "$CURRENT_BRANCH" != "master" ] || fail "refusing to run from master"
[ -z "$(git status --porcelain)" ] || fail "working tree is dirty — commit or stash before running"

if [ -d "$WORKTREE_DIR" ]; then
  echo "Worktree already exists at $WORKTREE_DIR, resuming."
else
  git worktree add -b "$BRANCH_NAME" "$WORKTREE_DIR"
  # NOTE: a worktree's ".git" is a *file* (containing "gitdir: <main-repo>/.git/worktrees/<name>"),
  # not a directory — "$WORKTREE_DIR/.git/info/exclude" would fail with "not a directory".
  # info/exclude is not one of the per-worktree files git splits out; it always lives in
  # the common/main repo's .git dir, so it must be written there instead.
  echo ".ralph-run/" >> "$SOURCE_REPO/.git/info/exclude"
fi

mkdir -p "$STATE_DIR" "$MEMORY_DIR/cycles"
if [ ! -f "$MEMORY_DIR/state.md" ]; then
  cat > "$MEMORY_DIR/state.md" <<'MEMEOF'
# State

## Objective
(uninitialized)

## Checklist
- [ ] Phase 0 setup

## Done
(nothing yet)

## Next
Run Phase 0 setup

## Blockers
(none)
MEMEOF
fi
touch "$MEMORY_DIR/log.md" "$MEMORY_DIR/decisions.md"

for envfile in "$SOURCE_REPO"/.env "$SOURCE_REPO"/.env.*; do
  [ -f "$envfile" ] && cp "$envfile" "$WORKTREE_DIR/"
done

SPECS_DIR="$STATE_DIR/specs"
mkdir -p "$SPECS_DIR"
for spec_path in "${SPEC_PATHS[@]}"; do
  cp "$spec_path" "$SPECS_DIR/"
done

if [ -n "$SETUP_CMD" ]; then
  ( cd "$WORKTREE_DIR" && eval "$SETUP_CMD" )
fi

[ -f "$STATE_DIR/cost.json" ] || echo '{"totalCostUsd": 0, "calls": []}' > "$STATE_DIR/cost.json"

# All remaining work (Contract phase onward) must happen with the worktree as cwd, not
# $SOURCE_REPO. Every `claude -p` call below inherits this shell's cwd as its own
# working directory (no --add-dir or explicit cwd is passed to `claude`), and every
# prompt in prompts/ talks about "the repo" / "the current working directory" assuming
# that's the worktree — so without this `cd`, the worker/judge subprocesses operate on
# $SOURCE_REPO instead: a worker can still stumble onto the right directory by
# following an absolute path mentioned elsewhere in its prompt (e.g. MEMORY_PATH), but
# a judge told to check "the repo root" has nothing to anchor it to the worktree and
# silently reviews $SOURCE_REPO instead, which is untouched, so it looks perpetually
# clean/untested and every attempt is wrongly REJECTed.
cd "$WORKTREE_DIR"

# --- Phase 1: Contract (Graph Engineering, strong model) ---
# Three independent sub-guards, each keyed on the one artifact it produces, run in
# sequence (2 consumes 1's output, 3 consumes 1's output). This lets a resumed run redo
# only what's actually missing:
# - If contract.json already exists — including one a human hand-fixed after a
#   CONTRACT-FAILED.md abort (validate-coverage/toposort failures explicitly tell the
#   user "fix contract.json and re-run") — sub-guard 1 is skipped entirely, so resuming
#   never re-spends a real Contract-phase LLM call or clobbers the hand-fix.
# - Sub-guard 2 (toposort) and sub-guard 3 (progress init) each run whenever their own
#   output file is missing, regardless of whether contract.json was just generated or
#   already existed — so a run interrupted after any one of the three artifacts resumes
#   by producing only the remaining ones.
if [ ! -f "$STATE_DIR/contract.json" ]; then
  CONTRACT_PROMPT="$STATE_DIR/rendered-contract-prompt.md"
  sed "s|{{SPECS_DIR}}|$SPECS_DIR|g" "$PROMPTS/contract-prompt.md" > "$CONTRACT_PROMPT"

  CONTRACT_RAW="$STATE_DIR/contract-raw.json"
  call_claude_structured "$CONTRACT_PROMPT" "$MODEL_STRONG" "$SCHEMAS/contract.schema.json" "" "$CONTRACT_RAW" "$CLAUDE_BIN_STRONG"
  jq '.structured_output' "$CONTRACT_RAW" > "$STATE_DIR/contract.json"

  node "$SCRIPTS/validate-coverage.mjs" "$STATE_DIR/contract.json" "$STATE_DIR/CONTRACT-FAILED.md" \
    || fail "coverage validation failed — see $STATE_DIR/CONTRACT-FAILED.md"

  echo "Contract generated: $(jq '.items | length' "$STATE_DIR/contract.json") items."
else
  echo "contract.json already exists at $STATE_DIR/contract.json — skipping Contract-phase LLM call (resume or hand-fix)."
fi

if [ ! -f "$STATE_DIR/order.json" ]; then
  node "$SCRIPTS/toposort.mjs" "$STATE_DIR/contract.json" "$STATE_DIR/order.json" "$STATE_DIR/CONTRACT-FAILED.md" \
    || fail "toposort failed (cycle) — see $STATE_DIR/CONTRACT-FAILED.md"
  echo "Toposort complete: order.json written."
else
  echo "order.json already exists — skipping toposort."
fi

if [ ! -f "$STATE_DIR/progress.json" ]; then
  node -e "
    const fs = require('fs');
    const contract = JSON.parse(fs.readFileSync('$STATE_DIR/contract.json', 'utf8'));
    const progress = {};
    for (const item of contract.items) {
      progress[item.id] = { status: 'PENDING', attempts: 0, commitSha: null, blockReason: null };
    }
    fs.writeFileSync('$STATE_DIR/progress.json', JSON.stringify(progress, null, 2));
  "
  echo "progress.json initialized: $(jq '.items | length' "$STATE_DIR/contract.json") items, all PENDING."
else
  echo "progress.json already exists — resuming Phase 2."
fi

# --- Phase 2: Implement (ralph loop, per item, sequential in order.json order) ---
# Portable read-loop instead of `mapfile` — macOS ships bash 3.2 (Apple stopped
# updating bash at the last GPLv2 release), which lacks the `mapfile`/`readarray`
# builtin entirely (added in bash 4.0). `#!/usr/bin/env bash` resolves to that same
# 3.2 unless the user has installed a newer bash earlier in PATH, so this must work
# there too.
ORDER=()
while IFS= read -r line; do
  ORDER+=("$line")
done < <(jq -r '.[]' "$STATE_DIR/order.json")

for ITEM_ID in "${ORDER[@]:-}"; do
  [ -z "$ITEM_ID" ] && continue
  EXISTING_STATUS="$(jq -r --arg id "$ITEM_ID" '.[$id].status' "$STATE_DIR/progress.json")"
  if [ "$EXISTING_STATUS" != "PENDING" ]; then
    echo "SKIP (already $EXISTING_STATUS) $ITEM_ID"
    continue
  fi

  ITEM_JSON="$STATE_DIR/item-$ITEM_ID.json"
  jq --arg id "$ITEM_ID" '.items[] | select(.id == $id)' "$STATE_DIR/contract.json" > "$ITEM_JSON"
  ITEM_MODEL_TIER="$(jq -r '.model' "$ITEM_JSON")"
  if [ "$ITEM_MODEL_TIER" = "light" ]; then
    ITEM_MODEL="$MODEL_LIGHT"
    ITEM_BIN="$CLAUDE_BIN_LIGHT"
  else
    ITEM_MODEL="$MODEL_MEDIUM"
    ITEM_BIN="$CLAUDE_BIN_MEDIUM"
  fi

  DEPS=()
  while IFS= read -r line; do
    DEPS+=("$line")
  done < <(jq -r '.dependsOn[]?' "$ITEM_JSON")
  SKIP_DUE_TO=""
  for DEP in "${DEPS[@]:-}"; do
    [ -z "$DEP" ] && continue
    DEP_STATUS="$(jq -r --arg id "$DEP" '.[$id].status' "$STATE_DIR/progress.json")"
    if [ "$DEP_STATUS" = "BLOCKED" ] || [ "$DEP_STATUS" = "SKIPPED" ]; then
      SKIP_DUE_TO="$DEP"
      break
    fi
  done
  if [ -n "$SKIP_DUE_TO" ]; then
    write_progress "$ITEM_ID" "SKIPPED" 0 "" "dependency $SKIP_DUE_TO is BLOCKED or SKIPPED"
    echo "SKIPPED $ITEM_ID (dependency $SKIP_DUE_TO not completed)"
    continue
  fi

  ATTEMPT=1
  ITEM_DONE=false
  PREVIOUS_FEEDBACK="(none — first attempt)"
  RED_STAGE=true

  while [ "$ATTEMPT" -le "$MAX_ATTEMPTS_PER_ITEM" ]; do
    EXTRA_VALUES="$STATE_DIR/extra-$ITEM_ID-$ATTEMPT.json"
    jq -n --arg attempt "$ATTEMPT" --arg feedback "$PREVIOUS_FEEDBACK" --arg suite "$FULL_SUITE_CMD" --arg memory "$MEMORY_DIR" \
      '{ATTEMPT_NUMBER: $attempt, PREVIOUS_FEEDBACK: $feedback, FULL_SUITE_CMD: $suite, MEMORY_PATH: $memory}' > "$EXTRA_VALUES"

    if [ "$RED_STAGE" = true ]; then
      RED_PROMPT="$STATE_DIR/rendered-$ITEM_ID-$ATTEMPT-red.md"
      node "$SCRIPTS/render-prompt.mjs" "$PROMPTS/worker-red-prompt.md" "$ITEM_JSON" "$EXTRA_VALUES" > "$RED_PROMPT"
      call_claude_free "$RED_PROMPT" "$ITEM_MODEL" "$STATE_DIR/out-$ITEM_ID-$ATTEMPT-red.json" "$ITEM_BIN"

      JUDGE_B_PROMPT="$STATE_DIR/rendered-$ITEM_ID-$ATTEMPT-judgeB.md"
      node "$SCRIPTS/render-prompt.mjs" "$PROMPTS/judge-review-tests-prompt.md" "$ITEM_JSON" "$EXTRA_VALUES" > "$JUDGE_B_PROMPT"
      JUDGE_B_OUT="$STATE_DIR/out-$ITEM_ID-$ATTEMPT-judgeB.json"
      call_claude_structured "$JUDGE_B_PROMPT" "$MODEL_STRONG" "$SCHEMAS/judge-verdict.schema.json" "Read,Grep,Glob,Bash" "$JUDGE_B_OUT" "$CLAUDE_BIN_STRONG"
      VERDICT_B="$(jq -r '.structured_output.verdict' "$JUDGE_B_OUT")"

      if [ "$VERDICT_B" = "REJECT" ]; then
        PREVIOUS_FEEDBACK="$(jq -r '.structured_output.findings | map(.issue) | join("; ")' "$JUDGE_B_OUT")"
        ATTEMPT=$((ATTEMPT + 1))
        continue
      fi
      RED_STAGE=false
    fi

    GREEN_PROMPT="$STATE_DIR/rendered-$ITEM_ID-$ATTEMPT-green.md"
    node "$SCRIPTS/render-prompt.mjs" "$PROMPTS/worker-green-prompt.md" "$ITEM_JSON" "$EXTRA_VALUES" > "$GREEN_PROMPT"
    call_claude_free "$GREEN_PROMPT" "$ITEM_MODEL" "$STATE_DIR/out-$ITEM_ID-$ATTEMPT-green.json" "$ITEM_BIN"

    JUDGE_D_PROMPT="$STATE_DIR/rendered-$ITEM_ID-$ATTEMPT-judgeD.md"
    node "$SCRIPTS/render-prompt.mjs" "$PROMPTS/judge-final-review-prompt.md" "$ITEM_JSON" "$EXTRA_VALUES" > "$JUDGE_D_PROMPT"
    JUDGE_D_OUT="$STATE_DIR/out-$ITEM_ID-$ATTEMPT-judgeD.json"
    call_claude_structured "$JUDGE_D_PROMPT" "$MODEL_STRONG" "$SCHEMAS/judge-verdict.schema.json" "Read,Grep,Glob,Bash" "$JUDGE_D_OUT" "$CLAUDE_BIN_STRONG"
    VERDICT_D="$(jq -r '.structured_output.verdict' "$JUDGE_D_OUT")"

    if [ "$VERDICT_D" = "REJECT" ]; then
      PREVIOUS_FEEDBACK="$(jq -r '.structured_output.findings | map(.issue) | join("; ")' "$JUDGE_D_OUT")"
      ATTEMPT=$((ATTEMPT + 1))
      continue
    fi

    # Step E: commit (deterministic). Any file changed outside item.files was already
    # gated by judge D's scopeExpansionJustified check above — collect it here so the
    # justified regression fix actually gets committed alongside this item.
    EXTRA_FILES="$STATE_DIR/extra-files-$ITEM_ID.json"
    node -e "
      const { execFileSync } = require('node:child_process');
      const fs = require('node:fs');
      const item = JSON.parse(fs.readFileSync('$ITEM_JSON', 'utf8'));
      const status = execFileSync('git', ['status', '--porcelain'], { cwd: '$WORKTREE_DIR' }).toString();
      const changed = status.split('\n').filter(Boolean).map((line) => line.slice(3).trim());
      const extra = changed.filter((f) => !item.files.includes(f));
      fs.writeFileSync('$EXTRA_FILES', JSON.stringify(extra));
    "
    COMMIT_OUT="$STATE_DIR/commit-$ITEM_ID.json"
    if node "$SCRIPTS/commit-item.mjs" "$WORKTREE_DIR" "$ITEM_JSON" "$ATTEMPT" "$EXTRA_FILES" > "$COMMIT_OUT"; then
      SHA="$(jq -r '.sha' "$COMMIT_OUT")"
      write_progress "$ITEM_ID" "COMPLETED" "$ATTEMPT" "$SHA" ""
      echo "COMPLETED $ITEM_ID ($SHA)"
      ITEM_DONE=true
      break
    else
      PREVIOUS_FEEDBACK="commit/hook failed: $(jq -r '.stderr' "$COMMIT_OUT")"
      ATTEMPT=$((ATTEMPT + 1))
      continue
    fi
  done

  if [ "$ITEM_DONE" != true ]; then
    write_progress "$ITEM_ID" "BLOCKED" "$MAX_ATTEMPTS_PER_ITEM" "" "$PREVIOUS_FEEDBACK"
    echo "BLOCKED $ITEM_ID after $MAX_ATTEMPTS_PER_ITEM attempts"
  fi
done

# --- Phase 2.5: Final integration pass (deterministic) ---
INTEGRATION_OUT="$STATE_DIR/integration-result.json"
node "$SCRIPTS/run-full-suite.mjs" "$WORKTREE_DIR" "$FULL_SUITE_CMD" > "$INTEGRATION_OUT" || true

# --- Phase 3: Report (deterministic) ---
node "$SCRIPTS/generate-report.mjs" "$STATE_DIR/contract.json" "$STATE_DIR/progress.json" \
  "$INTEGRATION_OUT" "$STATE_DIR/cost.json" "$STATE_DIR/REPORT.md"

echo ""
echo "Done. Report: $STATE_DIR/REPORT.md"
echo "Worktree: $WORKTREE_DIR (branch $BRANCH_NAME)"
