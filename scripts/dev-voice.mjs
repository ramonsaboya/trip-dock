import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error('Start the real app with pnpm dev:voice.');

const env = {
  ...process.env,
  DATABASE_URL: 'postgresql://tripdock:tripdock@127.0.0.1:55436/tripdock_voice',
  API_PORT: '4202',
  WEB_ORIGIN: 'http://localhost:3202',
  NEXT_PUBLIC_GRAPHQL_URL: 'http://localhost:4202/graphql',
};
const children = new Set();
let stopping = false;

function availablePort(port) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error(`Port ${port} is already in use. Stop that app before launching another copy; no existing server was changed.`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}

function launch(command, args, quiet = false) {
  const child = spawn(command, args, { cwd, env, stdio: quiet ? 'ignore' : 'inherit', windowsHide: true });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

function run(command, args, quiet = false) {
  return new Promise((resolve, reject) => {
    const child = launch(command, args, quiet);
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}.`)));
  });
}

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  await Promise.all([...children].map((child) => new Promise((resolve) => {
    if (!child.pid) return resolve();
    if (process.platform === 'win32') {
      // Terminate only this invocation's process trees, never other app servers.
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
      killer.once('error', resolve);
      killer.once('exit', resolve);
    } else {
      child.kill('SIGTERM');
      resolve();
    }
  })));
  process.exit(code);
}

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());

try {
  await Promise.all([availablePort(3202), availablePort(4202)]);
  console.log('\nStarting the real TripDock app with a separate voice-test database.\n');
  try {
    await run('docker', ['info'], true);
  } catch {
    console.log('Starting Docker Desktop…');
    await run('docker', ['desktop', 'start', '--timeout', '60']);
  }
  if (stopping) process.exit(0);
  await run('docker', ['compose', '-f', 'compose.voice.yaml', 'up', '-d', '--wait']);
  if (stopping) process.exit(0);
  await run(process.execPath, [pnpm, 'db:migrate']);
  if (!stopping) {
    for (const args of [
      ['--filter', '@tripdock/api', 'dev'],
      ['--filter', '@tripdock/web', 'dev', '--host', '127.0.0.1', '--port', '3202', '--strictPort'],
    ]) {
      const child = launch(process.execPath, [pnpm, ...args]);
      child.once('error', (error) => { console.error(error.message); void stop(1); });
      child.once('exit', (code) => { if (!stopping) void stop(code ?? 1); });
    }
    console.log('\nOpen http://localhost:3202 in Chrome once the web server is ready.\n');
    console.log('Speak uses GPT Live Transcribe in fastest mode. Dictation and drafts use the server-only OpenAI settings in .env.');
    console.log('Ctrl+C stops these app servers. Your test trips remain in the separate Docker volume.\n');
  }
} catch (error) {
  console.error(`\nCould not start TripDock: ${error.message}\n`);
  await stop(1);
}
