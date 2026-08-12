import React, { useRef, useEffect } from 'react';

// ============================================================================
// Renders the plane + curve using the same "world scrolls under an anchored
// plane" technique: fixed px-per-second / px-per-multiplier scales, so the
// curve grows naturally behind the plane instead of everything rescaling to
// fit itself every frame (which is what caused the plane/line desync in
// earlier attempts). The plane's screen position and the curve's tip are
// ALWAYS the same point, by construction - there's no way for them to drift
// apart since one is derived directly from the other on every draw call.
//
// Time and multiplier here come from the server (via props), never from a
// local clock - `elapsedSec` is derived from the multiplier the server most
// recently broadcast, using the same growth formula the server uses to
// generate multipliers in the first place, purely to know how far along
// the curve to draw. The actual multiplier VALUE always comes from the
// server; this only reconstructs "how much curve to draw" from it.
// ============================================================================

const CURVE_GROWTH_EXP = 2;
const CURVE_GROWTH_COEF = 0.02;

// Inverse of the server's multiplier formula (m = 1 + 0.05*t + 0.02*t^2)
// solved for t, so we can recover "elapsed seconds equivalent" purely from
// the multiplier value the server sent - keeping this a pure function of
// server state, not an independent clock.
function elapsedSecondsFromMultiplier(m) {
  if (m <= 1) return 0;
  // 0.02*t^2 + 0.05*t + (1 - m) = 0 -> quadratic formula
  const a = 0.02;
  const b = 0.05;
  const c = 1 - m;
  const t = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  return Math.max(0, t);
}

// Shows the live "next round in Xs" countdown during the betting phase,
// driven entirely by bettingSecondsLeft (which GameBoard derives from the
// server's own betting_duration_ms) - never a locally-invented timer.
// Previously nothing rendered during this window at all, so the betting
// phase appeared to sit idle and then jump to flying with no visible
// timing, instead of counting down like a real round transition.
function BettingCountdown({ secondsLeft }) {
  const clamped = Math.max(0, secondsLeft);
  const displaySeconds = Math.ceil(clamped);
  // Assume an 8s betting window server-side (BETTING_PHASE_MS in
  // backend/src/game.js) for the ring's fill percentage - if that value
  // changes, only the ring's visual pacing shifts, the countdown number
  // itself stays accurate either way since it's driven by the real
  // remaining time.
  const totalSeconds = 8;
  const fraction = Math.max(0, Math.min(1, clamped / totalSeconds));
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - fraction);

  return (
    <div className="betting-countdown">
      <svg viewBox="0 0 100 100" className="betting-countdown-ring">
        <circle cx="50" cy="50" r={radius} className="betting-countdown-track" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          className="betting-countdown-fill"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="betting-countdown-text">
        <span className="betting-countdown-number">{displaySeconds}</span>
        <span className="betting-countdown-label">Next round in</span>
      </div>
    </div>
  );
}

export default function FlightStage({ phase, multiplier, crashPoint, bettingSecondsLeft }) {
  const canvasRef = useRef(null);
  const planeWrapRef = useRef(null);
  const glowRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const planeWrap = planeWrapRef.current;
    const glow = glowRef.current;
    if (!canvas || !planeWrap) return;

    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    if (phase !== 'flying' && phase !== 'ended') {
      planeWrap.style.opacity = '0';
      if (glow) glow.classList.remove('active');
      return;
    }

    const elapsedSec = elapsedSecondsFromMultiplier(multiplier);

    const padX = 26;
    const padBottom = 26;
    const padTop = 16;
    const plotW = w - padX * 2;
    const plotH = h - padBottom - padTop;

    const pxPerSecond = 46;
    const pxPerMultiplier = 34;

    const xForRaw = (t) => padX + t * pxPerSecond;
    const yForRaw = (m) => h - padBottom - (m - 1) * pxPerMultiplier;

    const steps = 90;
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * elapsedSec;
      const m = 1 + Math.pow(t, CURVE_GROWTH_EXP) * CURVE_GROWTH_COEF;
      points.push({ t, m });
    }
    const last = points[points.length - 1] || { t: 0, m: 1 };

    const anchorX = padX + plotW * 0.62;
    const anchorY = padTop + plotH * 0.62;
    const rawTipX = xForRaw(last.t);
    const rawTipY = yForRaw(last.m);
    const offsetX = Math.min(0, anchorX - rawTipX);
    const offsetY = Math.max(0, anchorY - rawTipY);

    const xFor = (t) => xForRaw(t) + offsetX;
    const yFor = (m) => yForRaw(m) + offsetY;

    ctx.beginPath();
    for (let k = 0; k < points.length; k++) {
      const x = xFor(points[k].t);
      const y = yFor(points[k].m);
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = phase === 'ended' ? '#e8283f' : '#e8283f';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(232,40,63,0.65)';
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;

    const px = xFor(last.t);
    const py = yFor(last.m);

    if (phase === 'flying') {
      planeWrap.style.opacity = '1';
      planeWrap.style.left = px + 'px';
      planeWrap.style.top = py + 'px';

      const baseAngle = Math.max(-32, Math.min(-2, -4 - last.m * 1.3));
      planeWrap.style.transform = `translate(-5%, -87%) rotate(${baseAngle}deg)`;

      if (glow) {
        glow.style.left = px + 'px';
        glow.style.top = py + 'px';
        glow.classList.add('active');
        const glowScale = Math.min(2.2, 1 + last.m * 0.06);
        glow.style.transform = `translate(-50%, -50%) scale(${glowScale})`;
      }
    } else if (phase === 'ended') {
      // Plane stays at its last position but fades/drops on crash.
      planeWrap.style.left = px + 'px';
      planeWrap.style.top = py + 'px';
      planeWrap.style.opacity = '0';
      if (glow) glow.classList.remove('active');
    }
  }, [phase, multiplier]);

  return (
    <div className="stage-wrap">
      <div className="stage">
        <div className="rays" />
        <canvas ref={canvasRef} className="curve-canvas" />
        <div className="vignette" />
        <div ref={glowRef} className="flight-glow" />

        <div ref={planeWrapRef} className="plane-wrap">
          <svg viewBox="5.41 98.71 555.88 317.58">
            <g transform="translate(10,398) scale(0.1,-0.1)" fill="#e8283f" stroke="none">
              <path d="M4713 2755 c-50 -13 -101 -28 -112 -35 -25 -13 -253 -95 -326 -117 -27 -8 -59 -20 -70 -27 -23 -14 -107 -44 -214 -76 -100 -31 -184 -25 -278 19 -149 70 -258 48 -476 -98 -54 -36 -112 -74 -129 -84 -18 -10 -55 -38 -82 -61 -28 -23 -63 -48 -78 -55 -15 -8 -52 -36 -83 -63 -62 -55 -78 -95 -73 -173 l3 -50 245 4 245 4 46 48 c25 27 51 49 57 49 6 0 40 18 74 40 35 22 68 40 74 40 5 0 20 9 31 20 12 10 68 45 125 76 56 32 110 63 118 69 26 21 419 215 436 215 12 0 130 48 212 86 40 19 78 34 85 34 7 0 17 4 23 9 17 15 137 51 174 51 47 0 102 -39 125 -87 10 -21 33 -72 53 -113 19 -41 41 -82 49 -91 7 -9 30 -54 51 -100 20 -46 54 -110 75 -141 21 -32 37 -65 35 -75 -5 -28 -45 -27 -79 1 -17 14 -36 26 -43 26 -13 0 -104 -55 -148 -89 -14 -12 -29 -21 -32 -21 -3 0 -34 -17 -68 -38 -35 -21 -84 -49 -110 -62 -27 -14 -48 -28 -48 -32 0 -4 -19 -17 -42 -28 -24 -11 -61 -32 -83 -46 -22 -13 -54 -31 -72 -39 -17 -8 -34 -19 -38 -25 -3 -5 -37 -28 -76 -51 -68 -41 -71 -42 -135 -35 -35 4 -86 14 -112 24 l-47 18 -5 54 c-4 47 -9 57 -31 67 -23 11 -183 24 -499 38 -69 4 -181 11 -250 16 -197 16 -605 42 -840 54 -58 3 -179 10 -270 16 -205 14 -415 7 -462 -15 -32 -16 -56 -33 -131 -99 -18 -15 -44 -35 -59 -44 -16 -10 -28 -20 -28 -24 0 -3 26 -29 58 -58 31 -28 85 -78 118 -111 34 -33 69 -60 79 -60 9 0 48 16 85 36 66 35 69 35 94 19 14 -10 26 -22 26 -29 0 -6 -30 -27 -67 -46 -36 -19 -77 -44 -91 -54 -25 -20 -48 -33 -157 -90 -33 -17 -83 -46 -112 -65 l-52 -34 -25 -109 c-30 -127 -31 -135 -12 -119 8 7 54 33 103 58 48 25 95 51 103 58 8 7 44 28 80 47 109 58 184 101 201 115 14 12 19 8 42 -25 l25 -39 -39 -29 c-21 -16 -39 -32 -39 -36 0 -5 -6 -8 -13 -8 -8 0 -21 -8 -31 -19 -13 -14 -14 -24 -7 -45 6 -14 13 -26 16 -26 12 0 104 50 110 60 4 6 70 42 148 81 78 39 161 81 183 95 35 20 46 23 70 14 17 -7 24 -14 18 -20 -9 -9 -148 -86 -229 -128 -16 -8 -39 -23 -50 -32 -11 -9 -54 -35 -95 -57 -134 -72 -145 -78 -150 -83 -10 -11 -65 -43 -129 -78 -36 -19 -84 -47 -106 -62 -65 -44 -185 -109 -219 -118 -53 -15 -136 3 -226 48 -47 23 -93 49 -102 57 -14 13 -72 48 -208 125 -19 11 -44 28 -55 38 -31 28 -106 72 -136 80 -55 16 -201 -37 -336 -122 -68 -43 -83 -62 -83 -102 0 -38 25 -34 132 25 105 57 113 60 113 40 0 -8 -20 -25 -44 -38 -24 -12 -50 -28 -59 -35 -8 -7 -54 -33 -101 -58 l-86 -46 -3 -77 c-2 -42 -1 -77 2 -77 3 0 52 22 110 49 l105 49 28 -21 c39 -30 274 -223 297 -245 18 -15 103 -87 133 -112 8 -6 25 -4 52 8 l41 17 -170 172 c-153 155 -170 176 -170 207 0 21 6 36 15 40 18 6 72 -18 147 -67 31 -20 61 -37 66 -37 6 0 41 -15 78 -32 61 -29 80 -33 159 -34 50 -1 98 -2 108 -3 36 -3 15 -32 -46 -61 -103 -51 -102 -51 -88 -115 7 -30 13 -55 14 -55 1 0 31 16 67 35 36 19 98 50 138 70 39 19 105 51 145 70 39 20 88 45 107 56 19 11 82 42 140 69 58 28 112 54 120 59 8 6 73 38 145 72 71 34 136 68 143 76 7 7 17 13 22 13 5 0 43 16 85 36 l76 36 70 -48 c38 -26 69 -51 69 -56 0 -14 26 -9 51 10 13 10 53 31 89 46 36 16 132 62 214 102 82 41 155 74 163 74 8 0 26 9 40 20 14 11 34 20 43 20 10 0 23 7 30 14 11 14 38 28 148 77 44 20 187 89 447 215 109 52 111 53 228 60 83 4 117 3 117 -5 0 -6 -7 -11 -16 -11 -8 0 -120 -51 -247 -114 -128 -62 -279 -135 -337 -162 -58 -26 -121 -58 -140 -71 -19 -12 -60 -31 -90 -41 -51 -18 -77 -29 -205 -88 -27 -12 -108 -46 -180 -75 -71 -28 -134 -55 -140 -59 -5 -5 -32 -17 -60 -28 -99 -39 -271 -111 -300 -126 -39 -19 -165 -72 -234 -97 -29 -11 -63 -26 -75 -34 -11 -7 -97 -39 -191 -71 -93 -31 -189 -65 -213 -76 -41 -18 -294 -110 -357 -129 -16 -5 -44 -9 -62 -9 -17 0 -34 -4 -37 -8 -3 -5 -21 -9 -41 -10 -101 -4 -265 -62 -265 -94 0 -15 72 -88 88 -88 7 0 25 6 40 14 27 14 30 13 81 -35 35 -32 57 -46 65 -41 6 5 45 21 86 35 142 49 165 58 210 81 25 13 56 27 70 31 14 4 122 45 240 91 118 47 247 96 285 111 39 14 97 38 130 53 33 16 119 49 190 75 72 26 148 56 169 67 22 11 82 36 135 55 53 20 121 45 151 56 30 11 64 26 76 33 11 8 45 22 75 33 73 25 232 88 296 117 29 13 107 44 172 68 66 25 138 54 160 65 40 21 71 33 193 76 36 13 96 38 132 55 37 17 104 46 149 64 73 30 439 204 477 227 8 5 78 41 155 80 144 73 304 166 352 207 16 13 64 46 108 75 44 29 110 76 145 105 127 103 120 94 120 155 0 110 -25 194 -105 352 -89 177 -116 225 -161 283 -18 24 -34 47 -36 51 -2 4 -20 17 -41 29 -50 29 -124 28 -244 -3z"/>
            </g>
          </svg>
        </div>

        {phase === 'betting' && bettingSecondsLeft != null && (
          <BettingCountdown secondsLeft={bettingSecondsLeft} />
        )}

        <div className="multiplier-display" style={{ color: phase === 'ended' ? '#ff4d5e' : '#f2f2f4' }}>
          {phase === 'ended' && <div className="flew-away-label">FLEW AWAY!</div>}
          {multiplier.toFixed(2)}x
        </div>
      </div>
    </div>
  );
}
