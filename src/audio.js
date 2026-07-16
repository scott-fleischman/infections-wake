// Procedural WebAudio: no assets, just small synthesized cues.
// Sound is a readability channel (§5.5): machines hum, cysts click before a
// breach, assaults sting, and low sanity plays UNVERIFIED sounds on purpose.

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.humOsc = null;
    this.enabled = true;
  }

  ensure() {
    if (this.ctx) return true;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
      return true;
    } catch { return false; }
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  blip(freq = 440, dur = 0.08, type = 'square', vol = 0.4, glide = 0) {
    if (!this.enabled || !this.ensure()) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + glide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise(dur = 0.15, vol = 0.3, freq = 800) {
    if (!this.enabled || !this.ensure()) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  }

  dig() { this.noise(0.06, 0.25, 500 + Math.random() * 300); }
  breakBlock() { this.noise(0.16, 0.4, 350); this.blip(180, 0.1, 'triangle', 0.2, -80); }
  place() { this.blip(220, 0.06, 'triangle', 0.25, 40); }
  pickup() { this.blip(660, 0.07, 'sine', 0.25, 220); }
  craft() { this.blip(440, 0.09, 'triangle', 0.3, 120); this.blip(660, 0.09, 'triangle', 0.2, 120); }
  hitEnemy() { this.noise(0.08, 0.35, 900); this.blip(140, 0.08, 'sawtooth', 0.2, -60); }
  hurt() { this.blip(110, 0.22, 'sawtooth', 0.5, -50); this.noise(0.2, 0.3, 250); }
  die() { this.blip(220, 1.2, 'sawtooth', 0.4, -180); }
  eat() { this.noise(0.12, 0.2, 420); }
  assault() {
    this.blip(80, 0.7, 'sawtooth', 0.5, -30);
    setTimeout(() => this.blip(70, 0.9, 'sawtooth', 0.5, -25), 350);
    setTimeout(() => this.blip(60, 1.4, 'sawtooth', 0.5, -20), 800);
  }
  forecast() { this.blip(520, 0.12, 'sine', 0.25, -120); setTimeout(() => this.blip(420, 0.16, 'sine', 0.2, -80), 160); }
  archive() { this.blip(523, 0.15, 'sine', 0.3); setTimeout(() => this.blip(659, 0.15, 'sine', 0.3), 140); setTimeout(() => this.blip(784, 0.3, 'sine', 0.3), 280); }
  cystClick() { this.blip(1200 + Math.random() * 800, 0.03, 'square', 0.12); }
  turret() { this.noise(0.05, 0.3, 1400); }
  falseAlarm() { this.blip(880, 0.1, 'square', 0.3); setTimeout(() => this.blip(880, 0.1, 'square', 0.3), 200); }
  phantom() {
    // faint footstep-ish thumps behind the player
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) setTimeout(() => this.noise(0.07, 0.12, 150), i * 320);
  }
  recover() { this.blip(392, 0.2, 'sine', 0.3, 100); setTimeout(() => this.blip(523, 0.3, 'sine', 0.3, 60), 220); }
  bossRoar() { this.blip(55, 1.4, 'sawtooth', 0.6, 25); this.noise(0.8, 0.4, 120); }

  setHum(on, intensity = 0.05) {
    if (!this.ensure()) return;
    if (on && !this.humOsc) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = 52;
      g.gain.value = intensity;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 140;
      o.connect(f); f.connect(g); g.connect(this.master);
      o.start();
      this.humOsc = { o, g };
    } else if (!on && this.humOsc) {
      this.humOsc.o.stop();
      this.humOsc = null;
    } else if (on && this.humOsc) {
      this.humOsc.g.gain.value = intensity;
    }
  }
}
