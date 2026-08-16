You are implementing item {{ITEM_ID}} ("{{ITEM_TITLE}}") of a ralph-loop run, attempt
{{ATTEMPT_NUMBER}}. The tests for this item already exist and were judge-approved as a
valid red state.

First, follow the disk-memory skill against {{MEMORY_PATH}}: read state.md, the tail
of log.md, and all of decisions.md before doing anything else.

Objective: {{ITEM_OBJECTIVE}}
Files this item owns: {{ITEM_FILES}}
Test strategy: {{ITEM_TEST_STRATEGY}}
Project rules:
{{ITEM_PROJECT_RULES}}

Previous review feedback, if any (empty on this item's first green attempt):
{{PREVIOUS_FEEDBACK}}

Your task RIGHT NOW is the GREEN step: write the minimal implementation to make the
existing tests pass. Run lint/style/autofix until clean. Do NOT commit — a separate
deterministic step handles that.

Scope: stay inside {{ITEM_FILES}}. EXCEPTION — if, and only if, making these tests
genuinely pass requires fixing a real bug in a file from an EARLIER, already-committed
item (not this item's own scope), you may touch that file, but you MUST append an
entry to {{MEMORY_PATH}}/decisions.md explaining exactly what was wrong and why the
fix belongs there, before finishing. Do not use this to expand scope for convenience —
only for a genuine regression the tests in front of you expose.

Update {{MEMORY_PATH}}/state.md and append to {{MEMORY_PATH}}/log.md before finishing.
