const fs = require('fs');
const path = require('path');

const modules = ['core','gfx','world','build','combat','chars','ai','storm','drops','reboot','ui','main'];
let parts = [];

for (const m of modules) {
  const src = fs.readFileSync(path.join(__dirname, 'js', m + '.js'), 'utf8');
  // Remove import/export statements
  let cleaned = src.replace(/import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"]\s*;\s*/g, '');
  cleaned = cleaned.replace(/export\s*\{[\s\S]*?\}\s*;\s*/g, '');
  cleaned = cleaned.trim();
  parts.push('// === ' + m + ' ===\n' + cleaned);
}

const bundle = '(function() {\n"use strict";\n' + parts.join('\n\n') + '\n})();';

const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

fs.writeFileSync(path.join(distDir, 'game.bundle.js'), bundle, 'utf8');
fs.copyFileSync(path.join(__dirname, 'js', 'vendor', 'three.min.js'), path.join(distDir, '..', 'js', 'vendor', 'three.min.js'));

console.log('Build OK! Bundle:', Math.round(bundle.length / 1024), 'KB');

// Verify syntax
try {
  new Function(bundle);
  console.log('Syntax: OK');
} catch(e) {
  console.log('SYNTAX ERROR:', e.message);
}
