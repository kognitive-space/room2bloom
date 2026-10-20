// Generate site photos with Magica (Nano Banana Pro edit) from the reference shots in images/.
// Usage: node scripts/magica-generate.mjs            -> all slots
//        node scripts/magica-generate.mjs hero vision -> only those slots
// Requires MAGICA_API_KEY in .env (project root) or the environment. Output: assets/photos/<slot>.jpg

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGES = path.join(ROOT, 'images');
const OUT = path.join(ROOT, 'assets', 'photos');
const CHROME = 'C:/Users/kogna/.cache/puppeteer/chrome/win64-131.0.6778.204/chrome-win64/chrome.exe';

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {}

const API = 'https://inference.magica.com/v1';
const NODE = 'nano_banana_pro';
const SUB_MODEL = 'nano-banana-pro-edit';
const KEY = process.env.MAGICA_API_KEY;

const STYLE =
  'Photorealistic editorial photograph, soft natural window light, warm and joyful mood, ' +
  'bright modern early-learning center with natural wood, plants and calm warm-cream walls, ' +
  'subtle accents in soft periwinkle blue and fresh leaf green. Plain walls with no signs, posters, letters or numbers. ' +
  "Keep every child's face, skin tone, hair and clothing exactly as in the reference photos. " +
  'Natural, believable proportions and hands. No text, no logos, no watermarks.';

const SLOTS = [
  {
    name: 'hero',
    ratio: '1:1',
    refs: ['Baby1.png', 'baby3.png', 'Child1.png'],
    prompt:
      'Place these three children together on a soft, rounded play mat in a sunny infant and toddler classroom. ' +
      'The two babies sit and smile while the little girl plays with her colorful building toys beside them. ' +
      'Low wooden shelves with baskets of toys behind them, shallow depth of field. Dress the first baby in a simple soft cream onesie. ' +
      'Square composition, children centered.',
  },
  {
    name: 'welcome',
    ratio: '4:5',
    refs: ['Reading-Kids.webp', 'toddlerboy1.png'],
    prompt:
      'A caring adult teacher, seen from behind or in soft focus, reads a large picture book aloud to these three children ' +
      'in a cozy reading nook with floor cushions and a low bookshelf. The children sit close together, engaged and smiling, ' +
      'the girl and boy holding their own books. Vertical portrait composition, children are the focus.',
  },
  {
    name: 'headstart',
    ratio: '4:3',
    refs: ['baby2.png', 'groupkids2.png'],
    prompt:
      'A warm morning drop-off moment: a parent (face turned away, only shoulders and arms visible) gently hands the smiling baby to the classroom ' +
      'while the three children play happily with colorful blocks at a low table in the background. ' +
      'Family-centered, welcoming, landscape composition.',
  },
  {
    name: 'vision',
    ratio: '5:4',
    refs: ['kidblocks.png', 'kidsgroup.png'],
    prompt:
      'A modern, light-filled preschool classroom with large windows, furnished with low wooden tables, open toy shelves, a soft rug and plants. ' +
      'These children play together naturally and interact with each other: the girl stacks blocks at a low wooden table while two others watch and help, ' +
      'the rest sit and crawl on the rug nearby, the baby exploring the floor. Everyone is lit by the same soft daylight with consistent shadows, ' +
      'naturally integrated into the scene as one real photograph, not a collage. ' +
      'The warm wooden floor and rug fill the entire bottom of the frame edge to edge; no black, empty or transparent areas anywhere. ' +
      'Wide landscape composition, children mid-ground.',
  },
];

if (!KEY) {
  console.error('MAGICA_API_KEY is not set.');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

async function api(method, route, body) {
  const res = await fetch(`${API}${route}`, { method, headers, body: body && JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${json.message || json.error || ''}`);
  return json;
}

// Cut-out PNGs carry transparency, which the model renders as black. Flatten onto white as JPEG.
async function flatten(browser, file) {
  const raw = await readFile(path.join(IMAGES, file));
  const src = `data:${MIME[path.extname(file).toLowerCase()]};base64,${raw.toString('base64')}`;
  const page = await browser.newPage();
  const dataUri = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const scale = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.92);
  }, src);
  await page.close();
  return dataUri;
}

async function upload(browser, file) {
  const res = await api('POST', '/uploads', {
    data_uri: await flatten(browser, file),
    media_type: 'image',
    filename: file.replace(/.w+$/, '.jpg'),
  });
  return res.url;
}

async function generate(slot, urls) {
  const { runId } = await api('POST', `/nodes/${NODE}/run`, {
    subModelId: SUB_MODEL,
    input: {
      prompt: `${slot.prompt} ${STYLE}`,
      image_urls: urls,
      aspect_ratio: slot.ratio,
      resolution: '1K',
      output_format: 'JPEG',
    },
  });

  for (let i = 0; i < 150; i++) {
    await sleep(4000);
    const run = await api('GET', `/nodes/runs/${runId}`);
    if (run.status === 'COMPLETED') {
      const img = (run.output?.result || run.output?.images || [])[0];
      const url = typeof img === 'string' ? img : img?.url;
      if (!url) throw new Error(`${slot.name}: no image in output ${JSON.stringify(run.output)}`);
      return url;
    }
    if (run.status === 'FAILED' || run.status === 'CANCELED') {
      throw new Error(`${slot.name} ${run.status}: ${run.userMessage || run.error}`);
    }
  }
  throw new Error(`${slot.name}: timed out`);
}

const wanted = process.argv.slice(2);
const slots = wanted.length ? SLOTS.filter((s) => wanted.includes(s.name)) : SLOTS;
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const uploaded = new Map();
try {
  for (const file of new Set(slots.flatMap((s) => s.refs))) {
    uploaded.set(file, await upload(browser, file));
    console.log(`uploaded ${file}`);
  }
} finally {
  await browser.close();
}

await Promise.all(
  slots.map(async (slot) => {
    try {
      const url = await generate(slot, slot.refs.map((f) => uploaded.get(f)));
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      await writeFile(path.join(OUT, `${slot.name}.jpg`), buf);
      console.log(`saved assets/photos/${slot.name}.jpg`);
    } catch (err) {
      console.error(err.message);
      process.exitCode = 1;
    }
  })
);
