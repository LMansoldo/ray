import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export function buildCommitMessage(item, attempt) {
  return `feat: ${item.title} (item ${item.id})\n\n${item.objective}\n\nRalph-loop item ${item.id}, attempt ${attempt}.`;
}

export function commitItem({ cwd, files, message }) {
  if (!files || files.length === 0) {
    return { success: false, stderr: 'No files to commit — refusing to run git commit with an empty file list.' };
  }
  try {
    execFileSync('git', ['add', '--', ...files], { cwd });
  } catch (error) {
    return { success: false, stderr: `git add failed: ${error.stderr ? error.stderr.toString() : error.message}` };
  }
  try {
    execFileSync('git', ['commit', '-m', message], { cwd });
  } catch (error) {
    return { success: false, stderr: `git commit failed: ${error.stderr ? error.stderr.toString() : error.message}` };
  }
  let sha;
  try {
    sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd }).toString().trim();
  } catch (error) {
    return { success: false, stderr: `git rev-parse failed: ${error.stderr ? error.stderr.toString() : error.message}` };
  }
  return { success: true, sha };
}

if (process.argv[1] && process.argv[1].endsWith('commit-item.mjs')) {
  const [, , cwd, itemJsonPath, attemptArg, extraFilesJsonPath] = process.argv;
  const item = JSON.parse(readFileSync(itemJsonPath, 'utf8'));
  const attempt = Number(attemptArg);
  const extraFiles = extraFilesJsonPath ? JSON.parse(readFileSync(extraFilesJsonPath, 'utf8')) : [];
  const files = [...item.files, ...extraFiles];
  const message = buildCommitMessage(item, attempt);
  const result = commitItem({ cwd, files, message });
  process.stdout.write(JSON.stringify(result));
  process.exit(result.success ? 0 : 1);
}
