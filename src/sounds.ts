// Short synthesized cues (no audio files needed).
let ctx: AudioContext | null = null;

function beep(freqs: number[], dur = 0.07, gain = 0.08) {
  try {
    ctx ??= new AudioContext();
    const t0 = ctx.currentTime;
    freqs.forEach((f, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t = t0 + i * dur;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx!.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    });
  } catch {}
}

export const sounds = {
  start: () => beep([660, 990]),
  stop: () => beep([990, 660]),
  error: () => beep([330, 220], 0.12),
};
