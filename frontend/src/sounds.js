// Synthesized sound effects using the Web Audio API. No external audio
// files - every sound here is generated in-browser from oscillators and
// gain envelopes, so there's nothing to license, download, or host.
//
// A single shared AudioContext is created lazily on first use (browsers
// block audio until a user gesture, so this is created on the first
// button tap rather than on page load).

let audioContext = null;
let muted = false;

function getContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextClass();
  }
  // Some browsers start the context "suspended" until a user gesture -
  // resume defensively every time we're about to play something.
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  return audioContext;
}

export function setMuted(value) {
  muted = value;
  try {
    localStorage.setItem('aviator_muted', value ? '1' : '0');
  } catch {
    // Ignore storage errors (e.g. private browsing) - mute state just
    // won't persist across reloads, which is a minor inconvenience, not
    // a functional break.
  }
}

export function getMuted() {
  try {
    return localStorage.getItem('aviator_muted') === '1';
  } catch {
    return muted;
  }
}

// Plays a single tone: a sine wave that ramps up quickly and fades out,
// shaped by `freqStart`/`freqEnd` (pitch sweep) and `duration`.
function playTone({ freqStart, freqEnd = freqStart, duration = 0.15, volume = 0.2, type = 'sine' }) {
  if (getMuted()) return;

  const ctx = getContext();
  const now = ctx.currentTime;

  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(freqStart, now);
  if (freqEnd !== freqStart) {
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), now + duration);
  }

  // Quick attack, smooth decay - avoids clicks/pops at the start/end of
  // the tone.
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(volume, now + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.start(now);
  oscillator.stop(now + duration + 0.05);
}

// A short, crisp click - used when a bet is placed.
export function playBetSound() {
  playTone({ freqStart: 440, freqEnd: 660, duration: 0.08, volume: 0.15, type: 'triangle' });
}

// A bright, rising two-note chime - used on a successful cash-out. The
// higher the multiplier, the higher-pitched the chime, so bigger wins
// feel more rewarding.
export function playCashOutSound(multiplier = 1) {
  if (getMuted()) return;
  const pitchBoost = Math.min(multiplier * 20, 300);
  playTone({ freqStart: 523 + pitchBoost, freqEnd: 784 + pitchBoost, duration: 0.18, volume: 0.22, type: 'sine' });
  setTimeout(() => {
    playTone({ freqStart: 784 + pitchBoost, freqEnd: 1046 + pitchBoost, duration: 0.22, volume: 0.18, type: 'sine' });
  }, 90);
}

// A low, descending thud with a touch of noise-like harshness - used
// when the plane crashes.
export function playCrashSound() {
  if (getMuted()) return;
  playTone({ freqStart: 220, freqEnd: 55, duration: 0.35, volume: 0.25, type: 'sawtooth' });
}

// A soft tick - used for each history chip / round transition, kept very
// quiet so it's not annoying on every single round.
export function playTickSound() {
  playTone({ freqStart: 880, duration: 0.04, volume: 0.05, type: 'sine' });
}
