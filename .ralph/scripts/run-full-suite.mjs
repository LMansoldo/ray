import { execSync } from 'node:child_process';

export function runFullSuite(command, cwd) {
  try {
    const output = execSync(command, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { passed: true, output };
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}`;
    return { passed: false, output };
  }
}

if (process.argv[1] && process.argv[1].endsWith('run-full-suite.mjs')) {
  const [, , cwd, ...commandParts] = process.argv;
  const command = commandParts.join(' ');
  const result = runFullSuite(command, cwd);
  process.stdout.write(JSON.stringify(result));
  process.exit(result.passed ? 0 : 1);
}
