You are implementing item {{ITEM_ID}} ("{{ITEM_TITLE}}") of a ralph-loop run, attempt
{{ATTEMPT_NUMBER}}.

First, follow the disk-memory skill against {{MEMORY_PATH}}: read state.md, the tail
of log.md, and all of decisions.md before doing anything else.

Why this item exists: {{ITEM_WHY}}

Objective: {{ITEM_OBJECTIVE}}

Files this item owns: {{ITEM_FILES}}

Interfaces (verbatim, do not rename/reshape):
{{ITEM_SPECS_INTERFACES}}

Types (verbatim):
{{ITEM_SPECS_TYPES}}

Signatures (verbatim):
{{ITEM_SPECS_SIGNATURES}}

Acceptance criteria:
{{ITEM_SPECS_ACCEPTANCE_CRITERIA}}

Test strategy: {{ITEM_TEST_STRATEGY}}

Project rules that apply to this item:
{{ITEM_PROJECT_RULES}}

Previous attempt's feedback (empty if this is attempt 1): {{PREVIOUS_FEEDBACK}}

Your task RIGHT NOW is ONLY the RED step: write tests for this item's objective and
acceptance criteria — no implementation code. Run the tests and confirm they FAIL. If
they pass immediately, your tests are not testing anything real — rewrite them until
they genuinely fail for the right reason.

Update {{MEMORY_PATH}}/state.md and append to {{MEMORY_PATH}}/log.md before finishing,
per the disk-memory skill.

Do not commit. Do not touch any file outside {{ITEM_FILES}}.
