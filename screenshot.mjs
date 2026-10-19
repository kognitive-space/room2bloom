import puppeteer from 'puppeteer-core';
import { mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const CHROME = 'C:/Users/kogna/.cache/puppeteer/chrome/win64-131.0.6778.204/chrome-win64/chrome.exe';

const url = process.argv[2] || 'http://localhost:3000';
const label = process.argv[3] || '';
const width = Number(process.argv[4]) || 1440;
const height = Number(process.argv[5]) || 900;

const outDir = fileURLToPath(new URL('./temporary screenshots/', import.meta.url));
await mkdir(outDir, { recursive: true });

// auto-increment index, never overwrite
let max = 0;
for (const f of await readdir(outDir).catch(() => [])) {
  const m = f.match(/^screenshot-(\d+)/);
  if (m) max = Math.max(max, Number(m[1]));
}
const n = max + 1;
const name = label ? `screenshot-${n}-${label}.png` : `screenshot-${n}.png`;
const outPath = join(outDir, name);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width, height, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 800)); // let fonts load

// Scroll through the whole page to trigger IntersectionObserver reveals + count-ups
await page.evaluate(async () => {
  const total = document.body.scrollHeight;
  const stepPx = window.innerHeight * 0.6;
  for (let y = 0; y <= total; y += stepPx) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 130));
  }
  window.scrollTo(0, total);
  await new Promise((r) => setTimeout(r, 400));
});
await page.evaluate(() => window.scrollTo(0, 0));
await new Promise((r) => setTimeout(r, 700)); // settle entrance animations at top
await page.screenshot({ path: outPath, fullPage: true });
await browser.close();
console.log(`Saved ${outPath} (${width}x${height})`);
