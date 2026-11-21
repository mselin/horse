// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Mika Selin
// Synthesised hoofbeats: a short band-passed noise "clop" layered with a low
// thump, varied per footfall. Starts muted (browsers require a user gesture).

export class Hoofbeats {
  constructor() {
    this.enabled = false;
    this.ctx = null;
    this.slow = 1; // slow-motion factor: hoofbeats drop in pitch and ring longer
  }

  enable(on) {
    this.enabled = on;
    if (on && !this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const len = this.ctx.sampleRate * 0.25;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (on && this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  play(speed, fore) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const vol = Math.min(1, 0.25 + speed / 12);
    const k = Math.sqrt(Math.max(1, this.slow));
    // click / clop
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = (0.8 + Math.random() * 0.4) / k;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = ((fore ? 900 : 750) + Math.random() * 300) / k;
    bp.Q.value = 1.4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * vol, t + 0.004 * k);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12 * k);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.2 * k);
    // body thump
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime((95 + Math.random() * 20) / k, t);
    o.frequency.exponentialRampToValueAtTime(45 / k, t + 0.12 * k);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.6 * vol, t + 0.006 * k);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.16 * k);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.2 * k);
  }
}
