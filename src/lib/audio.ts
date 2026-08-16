/**
 * Synthesized keyboard feedback (AGENTS.md §2).
 *
 * Everything is generated with oscillators and a noise buffer — no samples to
 * fetch, so the first keystroke of a run sounds exactly like the thousandth and
 * nothing is gated on a network request.
 *
 * Two rules shape this module:
 *  - **Audio must never break typing.** Every public method swallows its own
 *    errors; a wedged AudioContext costs the player a sound, not a run.
 *  - **Nothing happens before a gesture.** Browsers refuse to start audio
 *    otherwise, so the context is created lazily on the first `resume()`.
 */

export type SoundName = "keypress" | "error" | "complete";

export interface SwitchProfile {
  /** Centre frequency of the click transient, in Hz. */
  clickHz: number;
  /** How long the click rings, in seconds. */
  clickDecay: number;
  /** Bandpass sharpness — higher is thinner and more plasticky. */
  resonance: number;
  /** Level of the noise component relative to the tone, 0..1. */
  noise: number;
}

/** Named after the switch families they imitate, not sampled from them. */
export const SWITCH_PROFILES: Record<string, SwitchProfile> = {
  linear: { clickHz: 1_100, clickDecay: 0.035, resonance: 6, noise: 0.35 },
  tactile: { clickHz: 1_600, clickDecay: 0.028, resonance: 10, noise: 0.5 },
  clicky: { clickHz: 2_600, clickDecay: 0.022, resonance: 16, noise: 0.7 },
};

export interface AudioEngineOptions {
  profile?: SwitchProfile;
  /** Master level, 0..1. */
  volume?: number;
  /** Injectable for tests and for environments without Web Audio. */
  contextFactory?: () => AudioContext;
}

export interface AudioEngine {
  /** Must be called from a user gesture before anything will sound. */
  resume(): Promise<void>;
  play(sound: SoundName): void;
  setEnabled(enabled: boolean): void;
  readonly enabled: boolean;
  readonly ready: boolean;
  dispose(): void;
}

/** Used when Web Audio is unavailable, so callers never need a null check. */
function silentEngine(): AudioEngine {
  return {
    async resume() {},
    play() {},
    setEnabled() {},
    enabled: false,
    ready: false,
    dispose() {},
  };
}

function defaultContextFactory(): AudioContext {
  // 'interactive' asks the browser for the smallest buffer it can manage, which
  // is the difference between a keystroke that feels connected and one that lags.
  return new AudioContext({ latencyHint: "interactive" });
}

export function createAudioEngine(options: AudioEngineOptions = {}): AudioEngine {
  const available =
    options.contextFactory ??
    (typeof globalThis.AudioContext === "function" ? defaultContextFactory : null);

  if (!available) return silentEngine();
  // Re-bound after the guard so the closures below see a non-nullable type.
  const factory = available;

  const profile = options.profile ?? SWITCH_PROFILES.tactile;
  const volume = options.volume ?? 0.25;

  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;
  let enabled = true;

  /** One buffer of white noise, reused by every burst. */
  function buildNoise(ctx: AudioContext): AudioBuffer {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function ensureContext(): AudioContext | null {
    if (context) return context;
    try {
      context = factory();
      master = context.createGain();
      master.gain.value = volume;
      master.connect(context.destination);
      noiseBuffer = buildNoise(context);
      return context;
    } catch {
      context = null;
      return null;
    }
  }

  function noiseBurst(ctx: AudioContext, at: number, duration: number, gain: number, hz: number, q: number) {
    if (!noiseBuffer || !master) return;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = hz;
    filter.Q.value = q;

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(gain, at);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    source.connect(filter).connect(envelope).connect(master);
    source.start(at);
    source.stop(at + duration);
  }

  function tone(ctx: AudioContext, at: number, hz: number, duration: number, gain: number, type: OscillatorType) {
    if (!master) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(hz, at);

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(gain, at);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    osc.connect(envelope).connect(master);
    osc.start(at);
    osc.stop(at + duration);
  }

  function render(ctx: AudioContext, sound: SoundName) {
    const now = ctx.currentTime;

    if (sound === "keypress") {
      // A touch of random detune stops a fast run from sounding like a machine gun.
      const detune = 0.92 + Math.random() * 0.16;
      noiseBurst(ctx, now, profile.clickDecay, profile.noise, profile.clickHz * detune, profile.resonance);
      tone(ctx, now, 180 * detune, 0.02, 0.18, "triangle");
      return;
    }

    if (sound === "error") {
      // Low and blunt: unmistakably different from a keypress even at speed.
      tone(ctx, now, 92, 0.16, 0.5, "sine");
      noiseBurst(ctx, now, 0.09, 0.35, 220, 2);
      return;
    }

    // complete — a short rising arpeggio.
    [523.25, 659.25, 783.99].forEach((hz, index) => {
      tone(ctx, now + index * 0.09, hz, 0.22, 0.22, "triangle");
    });
  }

  return {
    async resume() {
      const ctx = ensureContext();
      if (!ctx) return;
      try {
        if (ctx.state === "suspended") await ctx.resume();
      } catch {
        // A browser that refuses to resume leaves the game silent, not broken.
      }
    },

    play(sound: SoundName) {
      if (!enabled) return;
      const ctx = context;
      // Never create the context here: that would happen mid-keystroke, off any
      // gesture, and the browser would reject it anyway.
      if (!ctx || ctx.state !== "running") return;
      try {
        render(ctx, sound);
      } catch {
        // Audio is decoration. Losing it must not cost the player a keystroke.
      }
    },

    setEnabled(next: boolean) {
      enabled = next;
    },

    get enabled() {
      return enabled;
    },

    get ready() {
      return context?.state === "running";
    },

    dispose() {
      try {
        void context?.close();
      } catch {
        // Nothing useful to do if teardown fails.
      }
      context = null;
      master = null;
      noiseBuffer = null;
    },
  };
}

/** Maps a keystroke effect to its sound, so callers do not each invent a mapping. */
export function soundForEffect(effect: string): SoundName | null {
  switch (effect) {
    case "accepted":
      return "keypress";
    case "completed":
      return "complete";
    case "error":
    case "blocked":
      return "error";
    default:
      return null;
  }
}
