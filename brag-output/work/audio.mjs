// Soundtrack + SFX for the Tixflow video: 112 BPM, A minor, mixed as one piece.
import fs from 'node:fs';
const SR = 48000, DUR = 23.4, N = Math.ceil(SR * DUR);
const L = new Float32Array(N), R = new Float32Array(N);       // dry bus
const SL = new Float32Array(N), SRb = new Float32Array(N);    // reverb send
const BEAT = 60 / 112, BAR = BEAT * 4;
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
const CH = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
const ROOT = [45, 41, 36, 43];
const bars = Math.ceil(DUR / BAR);
for (let b = 0; b < bars; b++) {
  const t0 = b * BAR, c = CH[b % 4];
  const last = t0 + BAR > 18.8;
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
add(18.8, DUR - 18.8, (t) => Math.sin(2 * Math.PI * hz(69) * t) * env(t, 0.01, 1.4), 0.06, 0, 0.8);

// ---- SFX, in key, sitting under the music ----
const bell = (t0, m, g, pan = 0) => add(t0, 1.2, (t) => (Math.sin(2 * Math.PI * hz(m) * t) + 0.3 * Math.sin(2 * Math.PI * hz(m) * 3.01 * t) * Math.exp(-t / 0.08)) * env(t, 0.003, 0.35), g, pan, 0.7);
const click = (t0, g) => { let lp = 0; add(t0, 0.05, (t) => { lp += 0.3 * (rnd() - lp); return (lp + 0.5 * Math.sin(2 * Math.PI * 1760 * t)) * env(t, 0.001, 0.008); }, g, 0.1, 0.3); };
const whoosh = (tEnd) => { let lp = 0; add(tEnd - 0.45, 0.6, (t) => { const k = 0.02 + 0.2 * Math.min(t / 0.45, 1); lp += k * (rnd() - lp); const a = t < 0.45 ? Math.pow(t / 0.45, 2) : Math.exp(-(t - 0.45) / 0.05); return lp * a; }, 0.09, 0, 0.6); };
[3.4, 8.9, 14.7, 18.8].forEach(whoosh);
// Sell: typing MUKURU, apply, tick, pay
for (let i = 0; i < 6; i++) click(3.4 + 1.2 + i * 0.09, 0.05);
click(3.4 + 2.05, 0.09); bell(3.4 + 2.15, 76, 0.035);
click(3.4 + 3.0, 0.09);
click(3.4 + 4.1, 0.09);
// Gate: scanner beep then Admitted (A→E up), copied ticket (E→C down)
const g = 8.9;
bell(g + 1.3, 93, 0.025); bell(g + 1.65, 81, 0.07, -0.1); bell(g + 1.75, 88, 0.06, 0.1);
bell(g + 3.05, 93, 0.025); bell(g + 3.4, 76, 0.07, 0.1); bell(g + 3.52, 72, 0.07, -0.1);
// Payout: click then a C-E-A rising arpeggio
click(14.7 + 2.4, 0.09); [84, 88, 93].forEach((m, i) => bell(14.7 + 2.55 + i * 0.07, m, 0.04, (i - 1) * 0.3));

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
