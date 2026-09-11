import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const ref = process.argv[2];
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}
const files = ref
  ? execFileSync('git', ['ls-tree', '-r', '--name-only', ref, 'apps/web'], { cwd: root, encoding: 'utf8' }).trim().split('\n')
  : ['app', 'components', 'features', 'lib'].flatMap(dir => walk(path.join(root, 'apps/web', dir))).map(file => path.relative(root, file).replaceAll('\\', '/'));
const report = files.filter(file => /^apps\/web\/(app|components|features|lib)\/.+\.(ts|tsx|css)$/.test(file)).map(file => {
  const source = ref ? execFileSync('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8' }) : fs.readFileSync(path.join(root, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const components = ast.statements.flatMap(node => {
    if (ts.isFunctionDeclaration(node) && /^[A-Z]/.test(node.name?.text ?? '')) return [node.name.text];
    if (ts.isVariableStatement(node)) return node.declarationList.declarations.filter(d => /^[A-Z]/.test(d.name.getText()) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isCallExpression(d.initializer)) && /<\w/.test(d.initializer.getText())).map(d => d.name.getText());
    return [];
  });
  return { file, lines: source.trimEnd().split('\n').length, bytes: Buffer.byteLength(source), components, stateHooks: [...source.matchAll(/\buseState(?:<[^;]+?>)?\(/g)].length, effects: [...source.matchAll(/\buseEffect\(/g)].length, imports: ast.statements.filter(ts.isImportDeclaration).length };
});
console.log(JSON.stringify({ reference: ref ?? 'working tree', files: report }, null, 2));
