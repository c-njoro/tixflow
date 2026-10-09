// Soundtrack + SFX for the Tixflow video: 112 BPM, A minor, mixed as one piece.
import fs from 'node:fs';
const SR = 48000, DUR = 23.8, N = Math.ceil(SR * DUR);
const L = new Float32Array(N), R = new Float32Array(N);       // dry bus
const SL = new Float32Array(N), SRb = new Float32Array(N);    // reverb send
const BEAT = 60 / 118, BAR = BEAT * 4;
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

function add(t0, len, fn, gain, pan = 0, send = 0) {
  const s0 = Math.floor(t0 * SR), n = Math.floor(len * SR);
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < n && s0 + i < N; i++) {
    if (s0 + i < 0) continue;
    const v = fn(i / SR, i);
    L[s0 + i] += v * gl; R[s0 + i] += v * gr;
    SL[s0 + i] += v * gl * send; SRb[s0 + i] += v * gr * send;
  }
}
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));

// Chords per bar: Am F C G
const CH = [[50, 53, 57], [50, 53, 58], [48, 53, 57], [48, 52, 55]];
const ROOT = [38, 34, 41, 36];
const bars = Math.ceil(DUR / BAR);
for (let b = 0; b < bars; b++) {
  const t0 = b * BAR, c = CH[b % 4];
  const last = t0 + BAR > 19.9;
  // Pad: detuned saws, lowpassed
  c.forEach((m, k) => {
    let lp = 0;
    const len = last ? DUR - t0 : BAR + 0.4;
    add(t0, len, (t) => {
      let s = 0;
      for (const d of [-0.08, 0, 0.08]) { const ph = (t * hz(m + 12) * Math.pow(2, d / 12)) % 1; s += ph * 2 - 1; }
      lp += 0.035 * (s / 3 - lp);
      const a = Math.min(t / 0.35, 1), r = Math.min((len - t) / 0.4, 1);
      return lp * a * r;
    }, 0.11, (k - 1) * 0.5, 0.6);
  });
  if (t0 >= 21.5) continue;
  // Bass: root on beat 1, offbeat pulses
  if (b >= 1 && !last) for (const off of [0, 1.5, 2.5, 3.5]) {
    add(t0 + off * BEAT, BEAT * 0.9, (t) => { const f = hz(ROOT[b % 4]); return Math.tanh(1.6 * Math.sin(2 * Math.PI * f * t)) * env(t, 0.008, 0.22); }, 0.22);
  }
  // Kick + shaker
  if (b >= 1 && !last) for (let q = 0; q < 4; q++) {
    const tk = t0 + q * BEAT;
    add(tk, 0.35, (t) => { const f = 45 + 75 * Math.exp(-t / 0.03); return Math.sin(2 * Math.PI * (45 * t + 75 * 0.03 * (1 - Math.exp(-t / 0.03)))) * env(t, 0.002, 0.11) * (f > 0 ? 1 : 1); }, 0.42);
    let hp = 0, prev = 0;
    add(tk + BEAT / 2, 0.08, (t) => { const n = rnd(); hp = 0.85 * (hp + n - prev); prev = n; return hp * env(t, 0.004, 0.022); }, 0.05, 0.3);
  }
  // Pluck arp on 8ths (from bar 1)
  if (b >= 1 && !last) for (let e = 0; e < 8; e++) {
    const m = c[[0, 1, 2, 1, 0, 2, 1, 2][e]] + 24;
    add(t0 + e * BEAT / 2, 0.5, (t) => Math.sin(2 * Math.PI * hz(m) * t) * (0.7 + 0.3 * Math.sin(2 * Math.PI * hz(m) * 2 * t)) * env(t, 0.004, 0.12), 0.045, e % 2 ? 0.35 : -0.35, 0.5);
  }
}
// Final ringing note on the outro
add(19.9, DUR - 19.9, (t) => Math.sin(2 * Math.PI * hz(74) * t) * env(t, 0.01, 1.4), 0.06, 0, 0.8);

// ---- SFX, in key, sitting under the music ----
const bell = (t0, m, g, pan = 0) => add(t0, 1.2, (t) => (Math.sin(2 * Math.PI * hz(m) * t) + 0.3 * Math.sin(2 * Math.PI * hz(m) * 3.01 * t) * Math.exp(-t / 0.08)) * env(t, 0.003, 0.35), g, pan, 0.7);
const click = (t0, g) => { let lp = 0; add(t0, 0.05, (t) => { lp += 0.3 * (rnd() - lp); return (lp + 0.5 * Math.sin(2 * Math.PI * 1760 * t)) * env(t, 0.001, 0.008); }, g, 0.1, 0.3); };
const whoosh = (tEnd) => { let lp = 0; add(tEnd - 0.45, 0.6, (t) => { const k = 0.02 + 0.2 * Math.min(t / 0.45, 1); lp += k * (rnd() - lp); const a = t < 0.45 ? Math.pow(t / 0.45, 2) : Math.exp(-(t - 0.45) / 0.05); return lp * a; }, 0.09, 0, 0.6); };
[3.9, 9.6, 15.6, 19.9].forEach(whoosh);
// Hook: people joining, soft pops in D minor pentatonic, kept in the background
const PENT = [74, 77, 79, 81, 84, 86];
for (let i = 0; i < 12; i++) { const tt = 0.35 + 2.8 * Math.pow(i / 12, 0.8); bell(tt, PENT[(i * 7) % 6], 0.014, ((i % 3) - 1) * 0.5); }
// Live poll: pick, submit, answer received (D up to A)
click(5.45, 0.08); click(6.15, 0.08); bell(6.5, 74, 0.05, -0.1); bell(6.6, 81, 0.045, 0.1);
// Follow the presenter: Next, and a paper-soft swish as every screen turns the page
const swish = (t0) => { let lp = 0; add(t0, 0.3, (t) => { lp += 0.12 * (rnd() - lp); return lp * Math.sin(Math.PI * Math.min(t / 0.3, 1)); }, 0.12, 0.2, 0.5); };
for (const n of [11.7, 13.5]) { click(n, 0.09); swish(n + 0.12); bell(n + 0.3, 86, 0.018, 0.4); }
// Q&A: upvote tick (F to A), then the question goes on the big screen
click(16.85, 0.08); bell(16.9, 77, 0.04, 0.2); bell(16.98, 81, 0.035, 0.2);
[74, 77, 81].forEach((m, i) => bell(17.6 + i * 0.08, m + 12, 0.035, (i - 1) * 0.3));

// ---- Reverb (Schroeder) on the send bus ----
function reverb(x, offs) {
  const out = new Float32Array(N);
  for (const [d, fb] of [[1557, 0.82], [1617, 0.81], [1491, 0.83], [1422, 0.84]].map(([d, f]) => [d + offs, f])) {
    const buf = new Float32Array(d); let p = 0, lp = 0;
    for (let i = 0; i < N; i++) { const y = buf[p]; lp = y * 0.7 + lp * 0.3; buf[p] = x[i] + lp * fb; p = (p + 1) % d; out[i] += y * 0.25; }
  }
  for (const d of [225, 556]) { const buf = new Float32Array(d); let p = 0; for (let i = 0; i < N; i++) { const b = buf[p]; const y = -out[i] + b; buf[p] = out[i] + b * 0.5; out[i] = y; p = (p + 1) % d; } }
  return out;
}
const rl = reverb(SL, 0), rr = reverb(SRb, 23);
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR, fade = Math.min(t / 0.05, 1, (DUR - t) / 0.7);
  L[i] = Math.tanh((L[i] + rl[i] * 0.35) * 1.1) * fade; R[i] = Math.tanh((R[i] + rr[i] * 0.35) * 1.1) * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const gain = 0.89 / peak;
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(L[i] * gain * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(R[i] * gain * 32767), 46 + i * 4); }
fs.writeFileSync('music.wav', buf);
console.log('peak', peak.toFixed(3));
