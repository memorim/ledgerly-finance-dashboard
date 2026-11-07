import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
export function dataDirectory() {
  const directory = resolve(process.env.LEDGERLY_DATA_DIRECTORY || resolve(root, 'data'));
  const publicDirectory = resolve(root, 'public');
  if (directory === publicDirectory || directory.startsWith(publicDirectory + '/'))
    throw new Error('Ledgerly data must be outside the public directory');
  return directory;
}
