// Generate site photos with Magica (Nano Banana Pro). Slots with `refs` edit the reference shots in images/;
// slots without refs are generated text-only.
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
const EDIT_MODEL = 'nano-banana-pro-edit';
const TEXT_MODEL = 'nano-banana-pro-text';
const KEY = process.env.MAGICA_API_KEY;

const STYLE =
  'Candid documentary photograph, shot on a full-frame camera with a 35mm lens at eye level with the children, ' +
  'soft natural window light from one side with matching, consistent shadows, warm and joyful mood, ' +
  'bright modern early-learning center with natural wood, plants and calm warm-cream walls, ' +
  'subtle accents in soft periwinkle blue and fresh leaf green. Plain walls with no signs, posters, letters or numbers. ' +
  'Natural skin texture, true-to-life child proportions and head-to-body ratios for each age, ' +
  'every person at a believable scale for their distance from the camera, natural hands with five fingers. ' +
  'One real photograph, not a composite. No text, no logos, no watermarks.';

const SLOTS = [
  {
    name: 'hero',
    ratio: '1:1',
    resolution: '2K',
    prompt:
      'Three infants, all about 9 to 11 months old and all the same size, sit together on one round, cream play mat in a sunny infant classroom, ' +
      'side by side at the same distance from the camera. No toddlers or older children in the scene. ' +
      'On the left, a Black baby boy with short dark hair in a soft cream cotton onesie sits upright and laughs. ' +
      'In the middle, a Latina baby girl with wispy dark hair in a light blue romper reaches for a wooden ring stacker. ' +
      'On the right, an East Asian baby boy with straight black hair in a pale green onesie holds a soft fabric block and smiles. ' +
      'Low wooden shelves with woven baskets of soft toys behind them, a potted plant, shallow depth of field. ' +
      'Square composition, babies centered, camera low at their eye level.',
  },
  {
    name: 'welcome',
    ratio: '4:5',
    refs: ['Reading-Kids.webp', 'toddlerboy1.png'],
    prompt:
      'A caring adult teacher, seen from behind or in soft focus, reads a large picture book aloud to these three children ' +
      'in a cozy reading nook with floor cushions and a low bookshelf. The children sit close together, engaged and smiling, ' +
      'the girl and boy holding their own books. Vertical portrait composition, children are the focus. ' +
      "Keep every child's face, skin tone, hair and clothing exactly as in the reference photos.",
  },
  {
    name: 'headstart',
    ratio: '4:3',
    resolution: '2K',
    prompt:
      "A warm morning drop-off in an infant room, photographed over a parent's shoulder. In the soft-focus near foreground on the left, " +
      "the back of a Black father's shoulder in a light-blue shirt; his arms extend forward, handing an 8-month-old smiling Black baby girl " +
      'in a yellow floral outfit with a small yellow headband to a smiling South Asian female caregiver in a sage-green top who reaches out to take her. ' +
      "The baby is realistically sized: her whole body is about as long as the adult's forearm, held securely under her arms. " +
      'In the softly blurred background, a second caregiver, a white woman with red hair, sits on a soft floor mat with three infants of the same age, ' +
      'about 6 to 10 months old: a Latino baby, an East Asian baby and a white baby, playing with soft toys and an activity gym. ' +
      'Infants only, no toddlers or older children. Believable size for their distance. Family-centered, welcoming, landscape composition.',
  },
  {
    name: 'vision',
    ratio: '5:4',
    resolution: '2K',
    prompt:
      'A wide shot of a modern, light-filled preschool classroom with tall windows on the left, low wooden tables, open toy shelves, ' +
      'a soft cream rug over a warm wooden floor, and plants. Six diverse preschoolers, all 3 to 4 years old and similar in size, play together naturally: ' +
      'at a low wooden table, a Black girl stacks colorful wooden blocks while a white boy and a Latina girl help and watch; ' +
      'on the rug nearby, an East Asian girl and a South Asian boy roll a toy truck between them, and a mixed-race boy sorts shape blocks. ' +
      'No babies or infants in the scene. Everyone rests on the same floor plane, with perspective-correct sizes that get smaller with distance, ' +
      'all lit by the same soft daylight. Camera at adult chest height, slightly angled down. ' +
      'Wide landscape composition, children mid-ground, the floor and rug filling the bottom of the frame.',
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
    subModelId: urls.length ? EDIT_MODEL : TEXT_MODEL,
    input: {
      prompt: `${slot.prompt} ${STYLE}`,
      ...(urls.length && { image_urls: urls }),
      aspect_ratio: slot.ratio,
      resolution: slot.resolution || '1K',
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

const refs = new Set(slots.flatMap((s) => s.refs || []));
const uploaded = new Map();
if (refs.size) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  try {
    for (const file of refs) {
      uploaded.set(file, await upload(browser, file));
      console.log(`uploaded ${file}`);
    }
  } finally {
    await browser.close();
  }
}

await Promise.all(
  slots.map(async (slot) => {
    try {
      const url = await generate(slot, (slot.refs || []).map((f) => uploaded.get(f)));
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      await writeFile(path.join(OUT, `${slot.name}.jpg`), buf);
      console.log(`saved assets/photos/${slot.name}.jpg`);
    } catch (err) {
      console.error(err.message);
      process.exitCode = 1;
    }
  })
);
