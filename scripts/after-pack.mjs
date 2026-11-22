import fs from 'node:fs';
import path from 'node:path';

export default async function afterPack(context) {
  const appOutDir = context.appOutDir;
  if (!appOutDir || !fs.existsSync(appOutDir)) return;

  const localesDir = path.join(appOutDir, 'locales');
  if (fs.existsSync(localesDir)) {
    for (const entry of fs.readdirSync(localesDir)) {
      if (entry.toLowerCase() !== 'en-us.pak') {
        await fs.promises.rm(path.join(localesDir, entry), { recursive: true, force: true });
      }
    }
  }

  const unusedBinaries = ['dxcompiler.dll'];
  for (const binName of unusedBinaries) {
    const binPath = path.join(appOutDir, binName);
    if (fs.existsSync(binPath)) {
      await fs.promises.rm(binPath, { force: true });
    }
  }
}

