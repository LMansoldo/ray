import { readFileSync } from 'node:fs';

export function renderPrompt(template, values) {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.split(`{{${key}}}`).join(String(value));
  }
  const leftover = result.match(/\{\{[A-Z_]+\}\}/g);
  if (leftover) {
    throw new Error(`Unresolved placeholders: ${leftover.join(', ')}`);
  }
  return result;
}

function listOrDefault(list, bulleted, fallback) {
  if (!list || list.length === 0) return fallback;
  return bulleted ? list.map((entry) => `- ${entry}`).join('\n') : list.join('\n');
}

export function itemToPromptValues(item) {
  return {
    ITEM_ID: item.id,
    ITEM_TITLE: item.title,
    ITEM_WHY: item.why,
    ITEM_OBJECTIVE: item.objective,
    ITEM_FILES: listOrDefault(item.files, true, '(none)'),
    ITEM_TEST_STRATEGY: item.testStrategy,
    ITEM_PROJECT_RULES: listOrDefault(item.projectRules, true, '(none declared)'),
    ITEM_SPECS_INTERFACES: listOrDefault(item.specs.interfaces, false, '(none)'),
    ITEM_SPECS_TYPES: listOrDefault(item.specs.types, false, '(none)'),
    ITEM_SPECS_PROPS: listOrDefault(item.specs.props, false, '(none)'),
    ITEM_SPECS_SIGNATURES: listOrDefault(item.specs.signatures, false, '(none)'),
    ITEM_SPECS_ACCEPTANCE_CRITERIA: listOrDefault(item.specs.acceptanceCriteria, true, '(none)'),
    ITEM_SPECS_NOTES: item.specs.notes || '(none)',
  };
}

if (process.argv[1] && process.argv[1].endsWith('render-prompt.mjs')) {
  const [, , templatePath, itemJsonPath, extraJsonPath] = process.argv;
  const template = readFileSync(templatePath, 'utf8');
  const item = JSON.parse(readFileSync(itemJsonPath, 'utf8'));
  const extra = extraJsonPath ? JSON.parse(readFileSync(extraJsonPath, 'utf8')) : {};
  const values = { ...itemToPromptValues(item), ...extra };
  process.stdout.write(renderPrompt(template, values));
}
