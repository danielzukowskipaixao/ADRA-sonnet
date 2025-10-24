import fs from 'fs/promises';
import path from 'path';

const locks = new Map(); // per-file promise chain

async function ensureFile(filePath, fallback = '[]') {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try { await fs.access(filePath); } catch { await fs.writeFile(filePath, fallback, 'utf-8'); }
}

export async function readJson(filePath, fallback = []) {
  await ensureFile(filePath);
  try {
    const txt = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(txt || '[]');
  } catch (e) {
    console.warn(`[jsonStore] arquivo JSON inválido em ${filePath}, resetando`, e.message);
    await fs.writeFile(filePath, JSON.stringify(fallback, null, 2), 'utf-8');
    return fallback;
  }
}

export async function writeJsonAtomic(filePath, data) {
  await ensureFile(filePath);
  const prev = locks.get(filePath) || Promise.resolve();
  let resolveNext;
  const next = new Promise((r) => (resolveNext = r));
  locks.set(filePath, prev.then(async () => {
    const tmp = `${filePath}.tmp-${Date.now()}`;
    const payload = JSON.stringify(data, null, 2);
    await fs.writeFile(tmp, payload, 'utf-8');
    await fs.rename(tmp, filePath);
  }).finally(() => resolveNext()));
  await locks.get(filePath);
}
