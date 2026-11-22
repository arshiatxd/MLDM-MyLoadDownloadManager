import os from 'node:os';
import path from 'node:path';
import { runNativeHostBridge } from './native-host';

const executablePath = (process.env.MYLOAD_LAUNCH_EXE || process.execPath).trim();
const userDataDir = (
  process.env.MYLOAD_USER_DATA_DIR ||
  path.join(process.env.APPDATA || os.tmpdir(), 'MyLoad Download Manager')
).trim();

void runNativeHostBridge({
  executablePath,
  userDataDir,
}).finally(() => {
  process.exit(0);
});

