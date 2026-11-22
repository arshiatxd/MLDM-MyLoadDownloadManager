import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function runStep(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

if (!fs.existsSync(path.resolve('build/icon.png'))) {
  await runStep('node', ['scripts/generate-icon.mjs']);
}

await runStep('node', ['scripts/build-electron.mjs']);

const viteProc = spawn('npx', ['vite', '--port', '5173', '--strictPort'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

const devUrl = 'http://localhost:5173';
const deadline = Date.now() + 20000;
while (Date.now() < deadline) {
  try {
    const res = await fetch(devUrl);
    if (res.ok) break;
  } catch {

  }
  await new Promise((r) => setTimeout(r, 300));
}

const electronProc = spawn('npx', ['electron', '.'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: devUrl,
  },
});

const cleanup = () => {
  if (!electronProc.killed) electronProc.kill();
  if (!viteProc.killed) viteProc.kill();
};

electronProc.on('exit', (code) => {
  cleanup();
  process.exit(code ?? 0);
});

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

