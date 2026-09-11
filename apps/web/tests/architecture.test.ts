import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function sources(directory: URL): Promise<URL[]> {
  return (await Promise.all((await readdir(directory, { withFileTypes: true })).map(entry => {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    return entry.isDirectory() ? sources(url) : /\.tsx?$/.test(entry.name) ? [url] : [];
  }))).flat();
}

test('production modules keep discoverable components and point dependencies toward data', async () => {
  const files = (await Promise.all(['components', 'features', 'lib'].map(dir => sources(new URL(`../${dir}/`, import.meta.url))))).flat();
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const ast = ts.createSourceFile(file.pathname, source, ts.ScriptTarget.Latest, true, file.pathname.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const components = ast.statements.filter(node =>
      (ts.isFunctionDeclaration(node) && /^[A-Z]/.test(node.name?.text ?? '')) ||
      (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => /^[A-Z]/.test(d.name.getText()) && d.initializer && ts.isCallExpression(d.initializer) && /<\w/.test(d.initializer.getText()))),
    );
    assert.ok(components.length <= 1, `Keep one component definition per file: ${file.pathname}`);
    for (const node of ast.statements.filter(ts.isImportDeclaration)) {
      const from = (node.moduleSpecifier as ts.StringLiteral).text;
      assert.doesNotMatch(from, /\/tests\//, `Production must not import test fixtures: ${file.pathname}`);
      if (file.pathname.includes('/lib/')) assert.doesNotMatch(from, /\/(components|features)\//, `Data modules must not depend on UI: ${file.pathname}`);
      assert.doesNotMatch(from, /graphql-client(?:\.ts)?$/, `Use the focused data owner, not the compatibility facade: ${file.pathname}`);
    }
  }
});
