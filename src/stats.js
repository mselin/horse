// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Mika Selin
// Performance overlay in the spirit of MangoHud: frame rate, frame times with
// a graph, CPU (JavaScript) and GPU time per frame, the GPU's name, the render
// resolution, draw calls and triangles, GPU resources, JavaScript memory and
// what the scene holds. Hidden until switched on.
//
// GPU time uses the EXT_disjoint_timer_query_webgl2 extension where the
// browser offers it (results arrive a few frames late); the GPU's name uses
// WEBGL_debug_renderer_info. Both fall back to "n/a". JavaScript memory is
// Chromium-only (performance.memory).

import * as THREE from 'three';

const GRAPH_FRAMES = 150;
const _size = new THREE.Vector2();

export class PerfStats {
  constructor(renderer, { getScene = () => ({}) } = {}) {
    this.renderer = renderer;
    this.getScene = getScene;
    this.visible = false;
    this.frameTimes = new Float32Array(GRAPH_FRAMES); // ms, ring buffer
    this.head = 0;
    this.filled = 0;
    this.last = performance.now();
    this.cpuMs = 0;
    this.gpuMs = null;
    this.textTimer = 0;
    this.renderer.info.autoReset = false; // count every pass of the frame

    const gl = renderer.getContext();
    this.gl = gl;
    this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.queries = [];
    this.active = null;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpuName = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    this.gpuName = String(this.gpuName || 'n/a').replace(/^ANGLE \((.*)\)$/, '$1');

    const el = document.createElement('div');
    el.id = 'perf';
    el.hidden = true;
    el.innerHTML = '<div class="rows"></div><canvas width="300" height="56"></canvas>';
    document.body.appendChild(el);
    this.el = el;
    this.rows = el.querySelector('.rows');
    this.canvas = el.querySelector('canvas');
    this.ctx2d = this.canvas.getContext('2d');
  }

  setVisible(on) {
    this.visible = on;
    this.el.hidden = !on;
  }

  // call at the start of a frame, before any simulation
  begin() {
    const now = performance.now();
    const ft = now - this.last;
    this.last = now;
    this.frameTimes[this.head] = ft;
    this.head = (this.head + 1) % GRAPH_FRAMES;
    this.filled = Math.min(GRAPH_FRAMES, this.filled + 1);
    this.cpuStart = now;
    this.renderer.info.reset();
    if (this.visible && this.timer && !this.active) {
      const q = this.gl.createQuery();
      this.gl.beginQuery(this.timer.TIME_ELAPSED_EXT, q);
      this.active = q;
    }
  }

  // call after the frame's last render call
  end(dt) {
    this.cpuMs = performance.now() - this.cpuStart;
    const gl = this.gl;
    if (this.active) {
      gl.endQuery(this.timer.TIME_ELAPSED_EXT);
      this.queries.push(this.active);
      this.active = null;
    }
    // collect finished GPU timings, oldest first
    while (this.queries.length) {
      const q = this.queries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(this.timer.GPU_DISJOINT_EXT);
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      if (!disjoint) this.gpuMs = this.gpuMs == null ? ns / 1e6 : this.gpuMs * 0.85 + (ns / 1e6) * 0.15;
      gl.deleteQuery(q);
      this.queries.shift();
    }
    if (!this.visible) return;
    this.drawGraph();
    this.textTimer -= dt;
    if (this.textTimer <= 0) {
      this.textTimer = 0.25;
      this.drawText();
    }
  }

  frameStats() {
    const n = this.filled;
    const a = [];
    for (let i = 0; i < n; i++) a.push(this.frameTimes[(this.head - 1 - i + GRAPH_FRAMES) % GRAPH_FRAMES]);
    const recent = a.slice(0, 30);
    const avg = recent.reduce((s, x) => s + x, 0) / Math.max(1, recent.length);
    const sorted = a.slice().sort((x, y) => y - x);
    const low1 = sorted[Math.max(0, Math.floor(sorted.length * 0.01))] || avg; // 1% low (as a frame time)
    return { fps: 1000 / avg, avg, min: Math.min(...a), max: Math.max(...a), low1: 1000 / low1 };
  }

  drawText() {
    const r = this.renderer;
    const info = r.info;
    const s = this.frameStats();
    const sc = this.getScene();
    const size = r.getDrawingBufferSize(_size);
    const mem = performance.memory;
    const fmt = (x, d = 1) => (x == null || !isFinite(x) ? 'n/a' : x.toFixed(d));
    const big = (x) => (x >= 1e6 ? (x / 1e6).toFixed(2) + ' M' : x >= 1e3 ? (x / 1e3).toFixed(1) + ' k' : String(x));
    const row = (label, value, cls = '') => `<div class="row ${cls}"><span>${label}</span><b>${value}</b></div>`;
    this.rows.innerHTML = [
      row('FPS', `${fmt(s.fps, s.fps < 10 ? 1 : 0)} <small>1% low ${fmt(s.low1, s.low1 < 10 ? 1 : 0)}</small>`, 'fps'),
      row('Frame time', `${fmt(s.avg)} ms <small>${fmt(s.min)}–${fmt(s.max)}</small>`),
      row('CPU (JS)', `${fmt(this.cpuMs)} ms`),
      row('GPU', this.timer ? `${fmt(this.gpuMs)} ms` : 'n/a'),
      row('GPU name', `<small>${this.gpuName}</small>`, 'gpu'),
      row('Resolution', `${size.x}×${size.y} <small>@${r.getPixelRatio().toFixed(2)}x · ${sc.quality ?? ''}</small>`),
      row('Draw calls', `${info.render.calls}`),
      row('Triangles', big(info.render.triangles)),
      row('Programs', `${info.programs ? info.programs.length : 'n/a'} <small>geo ${info.memory.geometries} · tex ${info.memory.textures}</small>`),
      row('JS heap', mem ? `${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB <small>of ${(mem.jsHeapSizeLimit / 1048576).toFixed(0)}</small>` : 'n/a'),
      sc.vertices != null ? row('Horse mesh', `${big(sc.vertices)} verts`) : '',
      sc.strands != null ? row('Hair', `${big(sc.strands)} strands`) : '',
      sc.grass != null ? row('Grass', `${big(sc.grass)} blades`) : '',
      sc.sim ? row('Simulation', sc.sim) : '',
    ].join('');
  }

  drawGraph() {
    const c = this.ctx2d, W = this.canvas.width, H = this.canvas.height;
    c.clearRect(0, 0, W, H);
    // guide lines at 60 and 30 fps
    const scale = (ms) => H - Math.min(H, (ms / 50) * H);
    c.strokeStyle = 'rgba(255,255,255,0.18)';
    c.lineWidth = 1;
    for (const ms of [16.7, 33.3]) {
      c.beginPath();
      c.moveTo(0, scale(ms) + 0.5);
      c.lineTo(W, scale(ms) + 0.5);
      c.stroke();
    }
    c.strokeStyle = '#9be37a';
    c.lineWidth = 1.5;
    c.beginPath();
    const n = this.filled;
    for (let i = 0; i < n; i++) {
      const ft = this.frameTimes[(this.head - n + i + GRAPH_FRAMES) % GRAPH_FRAMES];
      const x = (i / (GRAPH_FRAMES - 1)) * W;
      const y = scale(ft);
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.45)';
    c.font = '10px ui-monospace, monospace';
    c.fillText('60', 2, scale(16.7) - 2);
    c.fillText('30', 2, scale(33.3) - 2);
  }
}
