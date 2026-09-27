// Rewrites the barrel icon import to its subpath, so a bundle carries only the
// Ionicons font instead of every @expo/vector-icons family (WS0 T0.3):
//
//   import { Ionicons } from '@expo/vector-icons';   →   import Ionicons from '@expo/vector-icons/Ionicons';
//
// Idempotent. Refuses (exit 1) on any other named import from the barrel, so a
// second icon family is converted by hand rather than silently left behind.
// Usage (from apps/mobile): node scripts/codemod-icons.mjs
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['app', 'components', 'lib'];
const BARREL = /^import\s*\{\s*Ionicons\s*\}\s*from\s*(['"])@expo\/vector-icons\1;?[ \t]*$/m;
const ANY_BARREL = /from\s*['"]@expo\/vector-icons['"]/;

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (/\.(tsx?|jsx?)$/.test(name)) yield path;
  }
}

let changed = 0;
const leftovers = [];
for (const root of ROOTS) {
  for (const file of sourceFiles(root)) {
    const before = readFileSync(file, 'utf8');
    const after = before.replace(BARREL, "import Ionicons from '@expo/vector-icons/Ionicons';");
    if (after !== before) {
      writeFileSync(file, after);
      changed += 1;
    }
    if (ANY_BARREL.test(after)) leftovers.push(file);
  }
}

console.log(`codemod-icons: rewrote ${changed} file(s)`);
if (leftovers.length) {
  console.error(`codemod-icons: barrel imports left to convert by hand:\n  ${leftovers.join('\n  ')}`);
  process.exit(1);
}
