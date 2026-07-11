/** One-shot: {animal}.svg → {animal}.ts exporting the XML as a template string.
 * Run from this folder: node convert.js  (SVGs from microsoft/fluentui-emoji, MIT) */
const fs = require('fs');

for (const f of ['panda', 'elephant', 'fox', 'turtle', 'deer', 'owl']) {
  const xml = fs.readFileSync(`${f}.svg`, 'utf8').replace(/\r/g, '');
  const escaped = xml
    .split('\\').join('\\\\')
    .split('`').join('\\`')
    .split('${').join('\\${');
  const out =
    `/** Fluent Emoji "${f}" (Color) — microsoft/fluentui-emoji, MIT. ` +
    `Auto-generated from ${f}_color.svg by convert.js — do not hand-edit. */\n` +
    `export const ${f}Xml = \`${escaped}\`;\n`;
  fs.writeFileSync(`${f}.ts`, out);
  console.log(`${f}.ts: ${out.length} bytes`);
  fs.unlinkSync(`${f}.svg`);
}
