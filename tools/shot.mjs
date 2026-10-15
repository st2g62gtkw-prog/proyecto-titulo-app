// Captura de pantalla con Chromium headless (WebGL por SwiftShader).
// Uso: node tools/shot.mjs <url> <salida.png> [esperaMs] [ancho] [alto]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const [url, out, wait = '4000', w = '1600', h = '900'] = process.argv.slice(2);
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(+wait);
await page.screenshot({ path: out, timeout: 180000 });
await browser.close();
if (logs.length) console.log(logs.slice(0, 40).join('\n'));
console.log('ok', out);
