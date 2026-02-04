const babel = require('@babel/core');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'src', 'app.js'), 'utf8');

// Transpile to ES5 for Android 6 WebView (Chrome 44)
const result = babel.transformSync(src, {
  presets: [
    ['@babel/preset-env', {
      targets: 'chrome 44',
      modules: false,
    }],
  ],
  sourceMaps: false,
});

const transpiledJs = result.code;

// Read the HTML template (has <!--SCRIPT--> placeholder)
const html = fs.readFileSync(path.join(__dirname, 'index.src.html'), 'utf8');
const output = html.replace('<!--SCRIPT-->', transpiledJs);

// Write to index.html (same path worker.js imports)
fs.writeFileSync(path.join(__dirname, 'index.html'), output);

console.log('Built index.html (' + Math.round(output.length / 1024) + ' KB)');
