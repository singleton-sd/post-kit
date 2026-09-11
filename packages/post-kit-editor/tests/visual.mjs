/**
 * Storybook visual screenshots for PR review, with committed baseline comparison.
 *
 * Requires `storybook-static/` from `pnpm build-storybook` in this package.
 * Serves that directory, screenshots a small set of iframe stories, then
 * pixel-diffs against `visual-baselines/`.
 *
 * Output under `test-results/visual/`:
 * - `pr/<story>-<viewport>.png` — this PR
 * - `base/<story>-<viewport>.png` — committed baseline (when present)
 * - `diff/<story>-<viewport>.png` — red pixel diff (when both exist and differ)
 * - `index.html` — side-by-side review page
 * - `manifest.json` — includes `summary` for CI gating
 *
 * Capture always exits 0 on successful screenshots. Use `pnpm test:visual:gate`
 * (or CI job `visual-review`) to fail when stories are `changed` or `new`.
 *
 * Env:
 * - VISUAL_PORT — fixed local port (default: ephemeral)
 * - VISUAL_SKIP_BASE — set to `1` to only capture PR shots (all status=new)
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { chromium } from 'playwright';
import { buildReportHtml } from './visual-report-html.mjs';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const storybookDir = path.join(rootDir, 'storybook-static');
const baselinesDir = path.join(rootDir, 'visual-baselines');
const outDir = path.join(rootDir, 'test-results', 'visual');
const port = Number(process.env.VISUAL_PORT ?? 0);
const skipBase = process.env.VISUAL_SKIP_BASE === '1';
const baseLabel = `committed:${path.relative(rootDir, baselinesDir) || 'visual-baselines'}`;

/** @type {{ id: string; waitFor: string[] }[]} */
const STORIES = [
  {
    id: 'admin-emailtemplateadmin--full-admin',
    waitFor: ['pk-admin-root', 'pk-editor-eb-mui-surface'],
  },
  {
    id: 'editor-emailbuildercanvas--editable',
    waitFor: ['pk-editor-eb-mui-surface'],
  },
  {
    id: 'editor-emailtemplateeditor--full-editor',
    waitFor: ['pk-editor-eb-mui-surface'],
  },
];

const VIEWPORTS = [{ name: 'desktop', width: 1440, height: 900 }];

if (!existsSync(storybookDir)) {
  throw new Error(
    `Missing storybook-static at ${storybookDir}. Run: pnpm --filter @singleton-sd/post-kit-editor build-storybook`,
  );
}

function contentTypeForPath(pathname) {
  if (pathname.endsWith('.html')) return 'text/html; charset=utf-8';
  if (pathname.endsWith('.css')) return 'text/css; charset=utf-8';
  if (pathname.endsWith('.js') || pathname.endsWith('.mjs')) {
    return 'text/javascript; charset=utf-8';
  }
  if (pathname.endsWith('.json')) return 'application/json; charset=utf-8';
  if (pathname.endsWith('.svg')) return 'image/svg+xml';
  if (pathname.endsWith('.ico')) return 'image/x-icon';
  if (pathname.endsWith('.woff2')) return 'font/woff2';
  if (pathname.endsWith('.woff')) return 'font/woff';
  if (pathname.endsWith('.ttf')) return 'font/ttf';
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (pathname.endsWith('.webp')) return 'image/webp';
  if (pathname.endsWith('.map')) return 'application/json';
  return 'application/octet-stream';
}

function normalizePathname(urlPath) {
  const cleaned = urlPath.replace(/\?.*$/, '').replace(/\/+$/, '') || '/';
  if (cleaned === '/') return '/index.html';
  if (path.extname(cleaned)) return cleaned;
  const asDir = `${cleaned}/index.html`;
  if (existsSync(path.join(storybookDir, asDir))) return asDir;
  return cleaned;
}

function createStaticServer(root) {
  return http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        res.statusCode = 400;
        res.end('Bad request');
        return;
      }

      const pathname = normalizePathname(req.url);
      const fsPath = path.join(root, pathname);

      if (!fsPath.startsWith(root) || !existsSync(fsPath)) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }

      res.setHeader('Content-Type', contentTypeForPath(pathname));
      if (
        pathname.endsWith('.html') ||
        pathname.endsWith('.css') ||
        pathname.endsWith('.js') ||
        pathname.endsWith('.mjs') ||
        pathname.endsWith('.json') ||
        pathname.endsWith('.svg') ||
        pathname.endsWith('.map')
      ) {
        res.end(await readFile(fsPath));
        return;
      }

      createReadStream(fsPath).pipe(res);
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err));
    }
  });
}

async function listen(server, preferredPort = 0) {
  await new Promise((resolve) => server.listen(preferredPort, '127.0.0.1', resolve));
  const actual = server.address()?.port;
  assert.ok(typeof actual === 'number' && actual > 0, 'Failed to pick a port');
  return actual;
}

function storySlug(storyId) {
  return storyId.replaceAll('--', '-');
}

function padPng(img, width, height) {
  if (img.width === width && img.height === height) return img;
  const out = new PNG({ width, height });
  out.data.fill(0);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const src = (img.width * y + x) << 2;
      const dst = (width * y + x) << 2;
      out.data[dst] = img.data[src];
      out.data[dst + 1] = img.data[src + 1];
      out.data[dst + 2] = img.data[src + 2];
      out.data[dst + 3] = img.data[src + 3];
    }
  }
  return out;
}

function diffPngs(baseFilePath, prFilePath, diffFilePath) {
  const baseImg = PNG.sync.read(readFileSync(baseFilePath));
  const prImg = PNG.sync.read(readFileSync(prFilePath));
  const width = Math.max(baseImg.width, prImg.width);
  const height = Math.max(baseImg.height, prImg.height);
  const baseNorm = padPng(baseImg, width, height);
  const prNorm = padPng(prImg, width, height);
  const diff = new PNG({ width, height });
  const mismatched = pixelmatch(baseNorm.data, prNorm.data, diff.data, width, height, {
    threshold: 0.1,
  });
  mkdirSync(path.dirname(diffFilePath), { recursive: true });
  writeFileSync(diffFilePath, PNG.sync.write(diff));
  return mismatched;
}

/**
 * @param {import('playwright').Browser} browser
 * @param {string} url
 * @param {{ width: number; height: number }} viewport
 * @param {string} filePath
 * @param {string[]} waitForTestIds
 */
async function screenshotStory(browser, url, viewport, filePath, waitForTestIds) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  try {
    const response = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 90_000,
    });
    const status = response?.status() ?? 0;
    if (!response || status >= 400) {
      return { ok: false, status };
    }

    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
          caret-color: transparent !important;
        }
      `,
    });

    for (const testId of waitForTestIds) {
      await page.waitForSelector(`[data-testid="${testId}"]`, {
        timeout: 60_000,
        state: 'visible',
      });
    }

    await page.evaluate(async () => {
      /* eslint-disable no-undef -- browser page context */
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
      /* eslint-enable no-undef */
    });
    await page.waitForTimeout(250);

    await page.screenshot({
      path: filePath,
      fullPage: true,
      animations: 'disabled',
    });
    return { ok: true, status };
  } finally {
    await context.close();
  }
}

const server = createStaticServer(storybookDir);
const actualPort = await listen(server, port);
const origin = `http://127.0.0.1:${actualPort}`;

await rm(outDir, { recursive: true, force: true });
for (const dir of ['pr', 'base', 'diff']) {
  mkdirSync(path.join(outDir, dir), { recursive: true });
}

const browser = await chromium.launch();
const manifest = [];

try {
  for (const story of STORIES) {
    for (const viewport of VIEWPORTS) {
      const slug = `${storySlug(story.id)}-${viewport.name}`;
      const prRel = `pr/${slug}.png`;
      const baseRel = `base/${slug}.png`;
      const diffRel = `diff/${slug}.png`;
      const prFile = path.join(outDir, prRel);
      const baseOutFile = path.join(outDir, baseRel);
      const diffFile = path.join(outDir, diffRel);
      const baselineFile = path.join(baselinesDir, `${slug}.png`);

      const storyUrl = `${origin}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`;
      const prShot = await screenshotStory(browser, storyUrl, viewport, prFile, story.waitFor);
      assert.ok(
        prShot.ok && prShot.status < 400,
        `Failed to load story ${story.id}: HTTP ${prShot.status}`,
      );

      let baseOk = false;
      let mismatched = 0;
      if (!skipBase && existsSync(baselineFile)) {
        copyFileSync(baselineFile, baseOutFile);
        baseOk = true;
        mismatched = diffPngs(baseOutFile, prFile, diffFile);
        if (mismatched === 0) {
          await rm(diffFile, { force: true });
        }
      }

      const status = !baseOk ? 'new' : mismatched > 0 ? 'changed' : 'unchanged';

      manifest.push({
        story: story.id,
        viewport: viewport.name,
        prFile: prRel,
        baseFile: baseOk ? baseRel : null,
        diffFile: mismatched > 0 ? diffRel : null,
        mismatched: mismatched > 0 ? mismatched : 0,
        storyUrl: `/iframe.html?id=${story.id}&viewMode=story`,
        status,
      });
    }
  }
} finally {
  await browser.close();
  server.close();
}

const changedStories = [
  ...new Set(manifest.filter((m) => m.status === 'changed').map((m) => m.story)),
].sort();
const newStories = [
  ...new Set(manifest.filter((m) => m.status === 'new').map((m) => m.story)),
].sort();
const unchanged = manifest.filter((m) => m.status === 'unchanged').length;
const summary = {
  total: manifest.length,
  unchanged,
  changed: changedStories.length,
  new: newStories.length,
  changedStories,
  newStories,
  hasDiffs: changedStories.length > 0 || newStories.length > 0,
};

await writeFile(
  path.join(outDir, 'manifest.json'),
  `${JSON.stringify(
    {
      baseLabel: skipBase ? null : baseLabel,
      baselinesDir: skipBase ? null : baselinesDir,
      summary,
      stories: manifest,
    },
    null,
    2,
  )}\n`,
  'utf8',
);
await writeFile(path.join(outDir, 'index.html'), buildReportHtml(manifest, { baseLabel }));

console.log(
  `Visual screenshots: ${summary.total} comparisons → ${outDir} (${summary.changed} changed, ${summary.new} new). Open index.html`,
);
