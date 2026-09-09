import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error('Start this preview with pnpm dev:itinerary.');

const env = {
  ...process.env,
  DATABASE_URL: 'postgresql://tripdock:tripdock@127.0.0.1:55433/tripdock_itinerary',
  API_PORT: '4100',
  WEB_ORIGIN: 'http://localhost:3100',
  NEXT_PUBLIC_GRAPHQL_URL: 'http://localhost:4100/graphql',
};
const children = new Set();
let stopping = false;

async function runningServices() {
  const [web, api] = await Promise.all([
    fetch('http://localhost:3100/', { signal: AbortSignal.timeout(5000) })
      .then(async (response) => response.ok && (await response.text()).includes('TripDock'))
      .catch(() => false),
    fetch('http://127.0.0.1:4100/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'query { trips { id } }' }),
      signal: AbortSignal.timeout(5000),
    }).then(async (response) => {
      if (!response.ok) return false;
      const result = await response.json();
      return !result.errors && Array.isArray(result.data?.trips);
    }).catch(() => false),
  ]);
  return { web, api };
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
      // Stop only processes launched by this invocation, including their watchers.
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
  const existing = await runningServices();
  if (existing.web && existing.api) {
    console.log('\nTripDock is already running. Open http://localhost:3100\n');
    process.exit(0);
  }
  console.log('\nStarting the itinerary preview. Your main app stays separate.\n');
  try {
    await run('docker', ['info'], true);
  } catch {
    console.log('Starting Docker Desktop…');
    await run('docker', ['desktop', 'start', '--timeout', '60']);
  }
  await run('docker', ['compose', '-f', 'compose.itinerary.yaml', 'up', '-d', '--wait']);
  await run(process.execPath, [pnpm, 'db:migrate']);
  if (!stopping) {
    const running = await runningServices();
    const services = [];
    if (!running.api) services.push(['--filter', '@tripdock/api', 'dev']);
    if (!running.web) services.push(['--filter', '@tripdock/web', 'dev', '--port', '3100', '--strictPort']);
    for (const args of services) {
      const child = launch(process.execPath, [pnpm, ...args]);
      child.once('error', (error) => { console.error(error.message); void stop(1); });
      child.once('exit', (code) => { if (!stopping) void stop(code ?? 1); });
    }
    console.log('\nOpen http://localhost:3100 when the web server is ready. Existing services are reused.\n');
    if (services.length) console.log('Press Ctrl+C to stop services started by this command.\n');
  }
} catch (error) {
  console.error(`\nCould not start the preview: ${error.message}\nMake sure Docker Desktop is running, then run pnpm dev:itinerary again.`);
  await stop(1);
}
