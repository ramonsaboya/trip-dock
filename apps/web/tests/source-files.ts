import { readdir, readFile } from 'node:fs/promises';

/** Inspect the feature tree after extraction, rather than assuming one master file. */
export async function productionSources(): Promise<string> {
  const files: URL[] = [];
  async function visit(directory: URL) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) await visit(url);
      else if (/\.tsx?$/.test(entry.name) && !['theme.ts', 'theme-toggle.tsx'].includes(entry.name)) files.push(url);
    }
  }
  for (const folder of ['components', 'features', 'lib']) await visit(new URL(`../${folder}/`, import.meta.url));
  return (await Promise.all(files.map(file => readFile(file, 'utf8')))).join('\n');
}
