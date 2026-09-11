import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error('Run pnpm dev:dark-mode.');
const setupOnly = process.argv.includes('--setup-only');
const env = {
  ...process.env,
  DATABASE_URL: 'postgresql://tripdock:tripdock@127.0.0.1:55437/tripdock_dark_mode',
  API_PORT: '4300',
  WEB_ORIGIN: 'http://localhost:3300',
  NEXT_PUBLIC_GRAPHQL_URL: 'http://localhost:4300/graphql',
};
const children = new Set();
let stopping = false;

function launch(command, args, childEnv = env, quiet = false) {
  const child = spawn(command, args, { cwd, env: childEnv, stdio: quiet ? 'ignore' : 'inherit', windowsHide: true });
  children.add(child);
  child.once('exit', () => children.delete(child));
  child.once('error', () => children.delete(child));
  return child;
}

function run(command, args, childEnv = env, quiet = false) {
  return new Promise((resolve, reject) => {
    if (stopping) return reject(new Error('Startup cancelled.'));
    const child = launch(command, args, childEnv, quiet);
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}.`)));
  });
}

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  await Promise.all([...children].map(child => new Promise(resolve => {
    if (!child.pid) return resolve();
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
      killer.once('error', resolve);
      killer.once('exit', resolve);
    } else {
      child.once('exit', resolve);
      child.kill('SIGTERM');
    }
  })));
  process.exit(code);
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());

function checkPort(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Port ${port} is occupied. Stop its existing server before running dev:dark-mode; it will not be reused.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

try {
  if (!setupOnly) await Promise.all([checkPort(3300), checkPort(4300)]);
  try {
    await run('docker', ['info'], env, true);
  } catch {
    console.log('Starting Docker Desktop…');
    await run('docker', ['desktop', 'start', '--timeout', '60']);
  }
  await run('docker', ['compose', '-f', 'compose.dark-mode.yaml', 'up', '-d', '--wait']);
  await run(process.execPath, [pnpm, '--filter', '@tripdock/api', 'db:migrate']);
  // The copy process reads DATABASE_URL from the original environment / root .env.
  // Never give it the application's overridden target DATABASE_URL as its source.
  await run(process.execPath, [pnpm, '--filter', '@tripdock/api', 'exec', 'tsx', 'src/scripts/copy-dark-mode-trip.ts'], process.env);
  if (setupOnly) {
    console.log('\nDark-mode database is ready. Run pnpm dev:dark-mode to start the app.');
  } else if (!stopping) {
    for (const args of [
      ['--filter', '@tripdock/api', 'dev'],
      ['--filter', '@tripdock/web', 'dev', '--host', '127.0.0.1', '--port', '3300', '--strictPort'],
    ]) {
      const child = launch(process.execPath, [pnpm, ...args]);
      child.once('error', error => { console.error(error.message); void stop(1); });
      child.once('exit', code => { if (!stopping) void stop(code || 1); });
    }
    console.log('\nWhen both servers are ready, open http://localhost:3300 in your browser.');
    console.log('API: http://localhost:4300/graphql | PostgreSQL: localhost:55437/tripdock_dark_mode');
    console.log('Ctrl+C stops the app servers. The isolated database and your test edits are retained.\n');
  }
} catch (error) {
  console.error(`\nDark-mode startup failed: ${error.message}`);
  await stop(1);
}
