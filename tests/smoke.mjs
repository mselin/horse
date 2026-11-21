// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Mika Selin
// Browser smoke test: serves the production build, loads the page in headless
// Chromium (software WebGL), runs a short canter and renders one frame.
// Fails on any page error, console error, or if the horse never appears.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 4173;
// start vite directly (not via npx) so killing it really stops the server
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: ['ignore', 'inherit', 'inherit'] });
const errors = [];
let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/`);
      if (r.ok) break;
    } catch {}
    await sleep(500);
  }
  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.goto(`http://127.0.0.1:${PORT}/?quality=low&sim=1.5&gait=3&cam=cinematic&shot=0&freeze&still&sweat=0.6&dirt=0.5`);
  await page.waitForFunction(() => window.__stillDone === true, null, { timeout: 240000 });
  const info = await page.evaluate(() => {
    const { horse, loco } = window.__app;
    let nan = 0;
    for (const b of horse.skeleton.bones) for (const e of b.matrixWorld.elements) if (!Number.isFinite(e)) nan++;
    return { verts: horse.geometry.attributes.position.count, gait: loco.gaitName, speed: loco.speed, nan };
  });
  console.log('smoke:', JSON.stringify(info));
  if (info.verts < 20000) errors.push(`mesh too small: ${info.verts} vertices`);
  if (info.nan) errors.push(`${info.nan} non-finite bone matrix entries`);
  if (info.gait !== 'canter') errors.push(`expected canter, got ${info.gait}`);
} catch (e) {
  errors.push(String(e));
} finally {
  if (browser) await browser.close();
  server.kill();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('smoke test passed');
