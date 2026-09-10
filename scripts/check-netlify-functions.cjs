// Fail before deployment if a helper/legacy entry slips into the functions directory.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function assertModernEntry(source, filename) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const hasDefault = ast.statements.some(statement =>
    (ts.isExportAssignment(statement) && !statement.isExportEquals) ||
    statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword) ||
    (ts.isExportDeclaration(statement) && statement.exportClause &&
      ts.isNamedExports(statement.exportClause) &&
      statement.exportClause.elements.some(element => element.name.text === 'default'))
  );
  const hasLegacyHandler = ast.statements.some(statement => {
    if (statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) return false;
    if (!statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) return false;
    if (ts.isFunctionDeclaration(statement)) return statement.name?.text === 'handler';
    return ts.isVariableStatement(statement) && statement.declarationList.declarations.some(
      declaration => ts.isIdentifier(declaration.name) && declaration.name.text === 'handler'
    );
  });
  if (!hasDefault || hasLegacyHandler) {
    throw new Error(`${filename}: Netlify entry must use the modern default export, not a legacy handler. Move shared helpers to netlify/shared/.`);
  }
}

function checkDirectory(directory) {
  let count = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) { count += checkDirectory(filename); continue; }
    if (!/\.(?:[cm]?[jt]s)$/.test(entry.name) || /\.d\.[cm]?ts$/.test(entry.name)) continue;
    assertModernEntry(fs.readFileSync(filename, 'utf8'), filename);
    count++;
  }
  return count;
}

module.exports = { assertModernEntry, checkDirectory };
if (require.main === module) {
  const count = checkDirectory(path.join(__dirname, '../netlify/functions'));
  if (!count) throw new Error('No Netlify function entries found.');
  console.log(`Netlify entry check passed: ${count} modern entries; shared helpers excluded.`);
}
