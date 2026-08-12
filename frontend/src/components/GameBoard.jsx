import React, { useEffect, useRef, useState } from 'react';
import api, { getSocket } from '../api.js';
import { useAuth } from '../App.jsx';
import FlightStage from './FlightStage.jsx';
import BetPanel from './BetPanel.jsx';
import { playCrashSound, playTickSound, getMuted, setMuted } from '../sounds.js';

// ============================================================================
// All outcomes (crash point, multiplier ticks, auto-cashout execution) are
// computed server-side in backend/src/game.js and pushed here via Socket.IO.
// This component never invents or predicts the crash point - FlightStage
// only maps whatever multiplier the server sends to a screen position.
// ============================================================================

function chipClass(crash) {
  if (crash < 1.5) return 'low';
  if (crash < 3) return 'mid';
  return 'high';
}

function MuteButton() {
  const [muted, setMutedState] = useState(getMuted());

  const toggle = () => {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
  };

  return (
    <button className="icon-btn" onClick={toggle} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'}>
      {muted ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M11 5 6 9H2v6h4l5 4V5Z" fill="#7a7a85" />
          <path d="M17 9l5 6M22 9l-5 6" stroke="#7a7a85" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M11 5 6 9H2v6h4l5 4V5Z" fill="#f2f2f4" />
          <path d="M16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14" stroke="#f2f2f4" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

function TopBar({ balance }) {
  return (
    <div className="aviator-topbar">
      <div className="aviator-brand">Aviator</div>
      <div className="aviator-topbar-right">
        <span className="aviator-balance">{Number(balance || 0).toFixed(2)} ETB</span>
        <MuteButton />
      </div>
    </div>
  );
}

function HistoryStrip({ history }) {
  return (
    <div className="history-strip">
      {history.map((r, i) => (
        <div key={r.round_id || i} className={`history-chip ${chipClass(r.crash_point)}`}>
          {r.crash_point.toFixed(2)}x
        </div>
      ))}
    </div>
  );
}

function ConnectingOverlay() {
  return (
    <div className="connecting-overlay">
      <div className="connecting-spinner" />
      <p>Connecting to live game...</p>
    </div>
  );
}

export default function GameBoard() {
  const { user, updateBalance } = useAuth();
  const socketRef = useRef(null);

  const [connected, setConnected] = useState(false);
  const [phase, setPhase] = useState('betting');
  const [multiplier, setMultiplier] = useState(1.0);
  const [lastCrashPoint, setLastCrashPoint] = useState(2.0);
  const [serverSeedHash, setServerSeedHash] = useState(null);
  const [history, setHistory] = useState([]);
  const [bettingEndsAt, setBettingEndsAt] = useState(null);
  const [bettingSecondsLeft, setBettingSecondsLeft] = useState(null);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('round:betting', (data) => {
      // A soft tick marks the start of a fresh betting window - quiet
      // enough not to be annoying every ~10 seconds, but gives a subtle
      // audio cue that a new round has opened.
      playTickSound();
      setPhase('betting');
      setServerSeedHash(data.server_seed_hash);
      setMultiplier(1.0);
      // The countdown is derived from the server's own duration, not a
      // locally-guessed value, so it always matches when the server will
      // actually flip to "flying" - it just gives that transition a
      // visible, ticking countdown instead of the screen appearing to
      // sit idle until it suddenly changes.
      if (data.betting_duration_ms) {
        setBettingEndsAt(Date.now() + data.betting_duration_ms);
      }
    });

    socket.on('round:flying', () => {
      setPhase('flying');
      setBettingEndsAt(null);
      setBettingSecondsLeft(null);
    });

    socket.on('round:tick', (data) => setMultiplier(data.multiplier));

    socket.on('round:crashed', (data) => {
      playCrashSound();
      setPhase('ended');
      setMultiplier(data.crash_point);
      setLastCrashPoint(data.crash_point);
      setHistory((prev) => [{ round_id: data.round_id, crash_point: data.crash_point }, ...prev].slice(0, 20));
    });

    api
      .get('/game/history')
      .then((res) => setHistory(res.data.rounds))
      .catch(() => {});

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('round:betting');
      socket.off('round:flying');
      socket.off('round:tick');
      socket.off('round:crashed');
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!bettingEndsAt) {
      setBettingSecondsLeft(null);
      return;
    }
    const tick = () => {
      const remainingMs = bettingEndsAt - Date.now();
      setBettingSecondsLeft(Math.max(0, remainingMs / 1000));
    };
    tick();
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [bettingEndsAt]);

  const handleBalanceChange = (newBalance) => {
    if (typeof newBalance === 'number') {
      updateBalance(newBalance);
    } else {
      api.get('/wallet/balance').then((res) => updateBalance(res.data.balance));
    }
  };

  return (
    <div className="card aviator-card">
      {!connected && <ConnectingOverlay />}

      <TopBar balance={user?.balance} />
      <HistoryStrip history={history} />

      <FlightStage
        phase={phase}
        multiplier={multiplier}
        crashPoint={phase === 'ended' ? multiplier : lastCrashPoint}
        bettingSecondsLeft={bettingSecondsLeft}
      />

      <div className="aviator-body">
        {serverSeedHash && (
          <p className="seed-hash-note">
            Provably fair seed hash: {serverSeedHash.slice(0, 24)}...
          </p>
        )}

        <div className="bet-panels-grid">
          <BetPanel slot={1} phase={phase} multiplier={multiplier} socket={socketRef.current} onBalanceChange={handleBalanceChange} />
          <BetPanel slot={2} phase={phase} multiplier={multiplier} socket={socketRef.current} onBalanceChange={handleBalanceChange} />
        </div>
      </div>
    </div>
  );
}
