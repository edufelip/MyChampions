/**
 * generate-icons.mjs
 *
 * Generates all app icon and splash screen assets from assets/images/logo.svg.
 *
 * Outputs:
 *  - assets/images/icon.png                    (1024x1024) — iOS/universal app icon source
 *  - assets/images/splash-icon.png             (512x512)   — splash screen image source
 *  - assets/images/android-icon-foreground.png (1024x1024) — Android adaptive icon foreground (108dp canvas)
 *  - assets/images/android-icon-background.png (1024x1024) — Android adaptive icon background (solid #E2FAE8)
 *  - assets/images/android-icon-monochrome.png (1024x1024) — Android adaptive icon monochrome
 *  - ios/.../AppIcon.appiconset/App-Icon-1024x1024@1x.png
 *  - ios/.../SplashScreenLogo.imageset/image.png|@2x|@3x
 *  - android/.../drawable-{dpi}/splashscreen_logo.png
 *  - android/.../mipmap-{dpi}/ic_launcher*.webp
 *
 * Usage: node scripts/generate-icons.mjs
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SVG_SOURCE = path.join(ROOT, 'assets', 'images', 'logo.svg');

/** Brand background colour — must match colors.xml `iconBackground` and app.config.ts adaptiveIcon.backgroundColor */
const BRAND_BG = '#E2FAE8';

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseHex(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

async function ensureDir(filePath) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
}

function label(outPath) {
  return path.relative(ROOT, outPath);
}

async function toPng(size, outPath) {
  await ensureDir(outPath);
  await sharp(SVG_SOURCE).resize(size, size).png().toFile(outPath);
  console.log(`  ✓ PNG  ${size}×${size}  → ${label(outPath)}`);
}

async function toWebp(size, outPath) {
  await ensureDir(outPath);
  await sharp(SVG_SOURCE).resize(size, size).webp({ lossless: true }).toFile(outPath);
  console.log(`  ✓ WebP ${size}×${size}  → ${label(outPath)}`);
}

async function toGreyscalePng(size, outPath) {
  await ensureDir(outPath);
  await sharp(SVG_SOURCE).resize(size, size).greyscale().png().toFile(outPath);
  console.log(`  ✓ Greyscale PNG  ${size}×${size}  → ${label(outPath)}`);
}

async function toGreyscaleWebp(size, outPath) {
  await ensureDir(outPath);
  await sharp(SVG_SOURCE).resize(size, size).greyscale().webp({ lossless: true }).toFile(outPath);
  console.log(`  ✓ Greyscale WebP ${size}×${size}  → ${label(outPath)}`);
}

async function toSolidPng(size, hex, outPath) {
  await ensureDir(outPath);
  const bg = parseHex(hex);
  await sharp({ create: { width: size, height: size, channels: 3, background: bg } })
    .png()
    .toFile(outPath);
  console.log(`  ✓ Solid PNG  ${size}×${size} (${hex}) → ${label(outPath)}`);
}

async function toSolidWebp(size, hex, outPath) {
  await ensureDir(outPath);
  const bg = parseHex(hex);
  await sharp({ create: { width: size, height: size, channels: 3, background: bg } })
    .webp({ lossless: true })
    .toFile(outPath);
  console.log(`  ✓ Solid WebP ${size}×${size} (${hex}) → ${label(outPath)}`);
}

/**
 * Composite the SVG logo centred on a solid background canvas.
 *
 * Android adaptive icons use a 108dp canvas where only the inner 72dp circle
 * is guaranteed to be visible. Writing the logo full-bleed at 72dp clips it
 * on devices that apply a circular/squircle mask. Instead, we place the logo
 * at 72dp size centred inside the 108dp canvas so content is within the safe zone.
 *
 * Safe-zone ratio: 72/108 ≈ 0.667  → logo fits in 66.7 % of the canvas.
 */
async function toAdaptiveForeground(canvasPx, hex, outPath) {
  await ensureDir(outPath);
  const bg = parseHex(hex);
  const logoSize = Math.round(canvasPx * (72 / 108));
  const offset = Math.round((canvasPx - logoSize) / 2);

  const logoBuffer = await sharp(SVG_SOURCE)
    .resize(logoSize, logoSize)
    .png()
    .toBuffer();

  await sharp({ create: { width: canvasPx, height: canvasPx, channels: 4, background: { ...bg, alpha: 0 } } })
    .composite([{ input: logoBuffer, left: offset, top: offset }])
    .webp({ lossless: true })
    .toFile(outPath);

  console.log(`  ✓ Adaptive FG WebP ${canvasPx}×${canvasPx} (logo ${logoSize}px centred) → ${label(outPath)}`);
}

// ─── Density maps ────────────────────────────────────────────────────────────

/**
 * Android adaptive icon canvas sizes (108dp equivalent per density).
 * The adaptive icon foreground/background drawables are rendered on a 108dp canvas;
 * the visible area is the inner 72dp circle/squircle.
 */
const ANDROID_ADAPTIVE_DENSITIES = [
  { dpi: 'mdpi',    canvas: 108 },
  { dpi: 'hdpi',    canvas: 162 },
  { dpi: 'xhdpi',   canvas: 216 },
  { dpi: 'xxhdpi',  canvas: 324 },
  { dpi: 'xxxhdpi', canvas: 432 },
];

/**
 * Legacy ic_launcher sizes (72dp equivalent) — used for ic_launcher.webp and
 * ic_launcher_round.webp (non-adaptive paths, pre-API-26 fallback).
 */
const ANDROID_LEGACY_DENSITIES = [
  { dpi: 'mdpi',    px: 48  },
  { dpi: 'hdpi',    px: 72  },
  { dpi: 'xhdpi',   px: 96  },
  { dpi: 'xxhdpi',  px: 144 },
  { dpi: 'xxxhdpi', px: 192 },
];

/**
 * Splash screen logo sizes (200dp baseline from app.config.ts imageWidth:200).
 */
const ANDROID_SPLASH_DENSITIES = [
  { dpi: 'mdpi',    px: 200 },
  { dpi: 'hdpi',    px: 300 },
  { dpi: 'xhdpi',   px: 400 },
  { dpi: 'xxhdpi',  px: 600 },
  { dpi: 'xxxhdpi', px: 800 },
];

const ANDROID_RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const IOS_XCASSETS = path.join(ROOT, 'ios', 'mychampions', 'Images.xcassets');

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Fail fast if the SVG source is missing
  if (!fs.existsSync(SVG_SOURCE)) {
    console.error(`\n❌ SVG source not found: ${SVG_SOURCE}`);
    console.error('   Run: cp ~/Downloads/logo.svg assets/images/logo.svg\n');
    process.exit(1);
  }

  console.log('\n📦 Generating app icons and splash assets from logo.svg…\n');

  // ── 1. Universal source assets ──────────────────────────────────────────
  console.log('── 1. Universal source assets ──');
  await Promise.all([
    toPng(1024, path.join(ROOT, 'assets', 'images', 'icon.png')),
    toPng(512,  path.join(ROOT, 'assets', 'images', 'splash-icon.png')),
  ]);

  // ── 2. Android adaptive icon source layers (assets/images/ copies) ──────
  console.log('\n── 2. Android adaptive icon source layers ──');
  await Promise.all([
    toPng(1024, path.join(ROOT, 'assets', 'images', 'android-icon-foreground.png')),
    toSolidPng(1024, BRAND_BG, path.join(ROOT, 'assets', 'images', 'android-icon-background.png')),
    toGreyscalePng(1024, path.join(ROOT, 'assets', 'images', 'android-icon-monochrome.png')),
  ]);

  // ── 3. iOS App Icon ─────────────────────────────────────────────────────
  console.log('\n── 3. iOS App Icon ──');
  await toPng(
    1024,
    path.join(IOS_XCASSETS, 'AppIcon.appiconset', 'App-Icon-1024x1024@1x.png'),
  );

  // ── 4. iOS Splash Screen logo ───────────────────────────────────────────
  console.log('\n── 4. iOS SplashScreen logo ──');
  const splashLogoDir = path.join(IOS_XCASSETS, 'SplashScreenLogo.imageset');
  await Promise.all([
    toPng(200, path.join(splashLogoDir, 'image.png')),
    toPng(400, path.join(splashLogoDir, 'image@2x.png')),
    toPng(600, path.join(splashLogoDir, 'image@3x.png')),
  ]);

  // ── 5. Android Splash Screen drawables ─────────────────────────────────
  console.log('\n── 5. Android splash drawables ──');
  await Promise.all(
    ANDROID_SPLASH_DENSITIES.map(({ dpi, px }) =>
      toPng(px, path.join(ANDROID_RES, `drawable-${dpi}`, 'splashscreen_logo.png')),
    ),
  );

  // ── 6. Android launcher icons ───────────────────────────────────────────
  // Adaptive foreground/background/monochrome at 108dp canvas (safe-zone correct).
  // Legacy ic_launcher / ic_launcher_round at 72dp (pre-API-26 fallback).
  console.log('\n── 6. Android launcher icons (adaptive, 108dp canvas) ──');
  await Promise.all(
    ANDROID_ADAPTIVE_DENSITIES.map(({ dpi, canvas }) => {
      const dir = path.join(ANDROID_RES, `mipmap-${dpi}`);
      return Promise.all([
        toAdaptiveForeground(canvas, BRAND_BG, path.join(dir, 'ic_launcher_foreground.webp')),
        toSolidWebp(canvas, BRAND_BG,           path.join(dir, 'ic_launcher_background.webp')),
        toGreyscaleWebp(canvas,                  path.join(dir, 'ic_launcher_monochrome.webp')),
      ]);
    }),
  );

  console.log('\n── 6b. Android launcher icons (legacy ic_launcher, 72dp) ──');
  await Promise.all(
    ANDROID_LEGACY_DENSITIES.map(({ dpi, px }) => {
      const dir = path.join(ANDROID_RES, `mipmap-${dpi}`);
      return Promise.all([
        toWebp(px, path.join(dir, 'ic_launcher.webp')),
        toWebp(px, path.join(dir, 'ic_launcher_round.webp')),
      ]);
    }),
  );

  console.log('\n✅ All assets generated successfully.\n');
}

main().catch((err) => {
  console.error('\n❌ Generation failed:', err);
  process.exit(1);
});
