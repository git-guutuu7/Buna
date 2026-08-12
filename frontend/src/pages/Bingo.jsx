import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSocket, getBingoState, getBingoCartelas, stakeBingoCartelas } from '../api.js';
import { useAuth } from '../App.jsx';

const GRID_LETTERS = ['B', 'I', 'N', 'G', 'O'];
const COLUMN_COLORS = {
  B: '#2f6fed',
  I: '#7c4fe0',
  N: '#1f9d63',
  G: '#e0a72f',
  O: '#e0522f',
};

function speak(text) {
  try {
    if (!window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Speech synthesis not available - silently skip, the visual call
    // display is still there.
  }
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(Math.ceil(ms / 1000), 0);
  return `${totalSeconds}s`;
}

// The 5x5 number board (1-75) shown so players can see which numbers have
// been called, independent of any specific cartela.
function NumberBoard({ calledNumbers }) {
  const calledSet = new Set(calledNumbers);
  return (
    <div className="bingo-board">
      {GRID_LETTERS.map((letter, colIdx) => (
        <div className="bingo-board-column" key={letter}>
          <div className="bingo-board-header" style={{ background: COLUMN_COLORS[letter] }}>
            {letter}
          </div>
          {Array.from({ length: 15 }, (_, i) => colIdx * 15 + i + 1).map((num) => (
            <div key={num} className={`bingo-board-cell ${calledSet.has(num) ? 'called' : ''}`}>
              {num}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function CartelaPreview({ numbers, calledNumbers, cartelaNumber }) {
  const calledSet = new Set(calledNumbers);
  return (
    <div className="bingo-cartela-preview">
      <div className="bingo-cartela-preview-title">Cartela #{cartelaNumber}</div>
      <div className="bingo-cartela-grid">
        {GRID_LETTERS.map((letter) => (
          <div key={letter} className="bingo-cartela-grid-header" style={{ color: COLUMN_COLORS[letter] }}>
            {letter}
          </div>
        ))}
        {numbers.map((num, i) => {
          const isFree = num === 0;
          const isMarked = isFree || calledSet.has(num);
          return (
            <div key={i} className={`bingo-cartela-cell ${isMarked ? 'marked' : ''} ${isFree ? 'free' : ''}`}>
              {isFree ? 'FREE' : num}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CartelaPickerModal({ cartelas, takenCartelas, myCartelas, onClose, onConfirm, submitting, error }) {
  const [selected, setSelected] = useState([]);

  const toggle = (num) => {
    if (takenCartelas.includes(num)) return;
    setSelected((prev) => (prev.includes(num) ? prev.filter((n) => n !== num) : [...prev, num]));
  };

  return (
    <div className="deposit-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="deposit-modal-card" style={{ maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="deposit-modal-header">
          <h4 className="deposit-modal-title">Select Cartela(s)</h4>
          <button type="button" className="deposit-modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="deposit-modal-body" style={{ overflowY: 'auto' }}>
          <p className="field-hint">10 ETB per cartela. Tap to select, tap again to deselect.</p>
          <div className="bingo-cartela-picker-grid">
            {cartelas.map((c) => {
              const isTaken = takenCartelas.includes(c.cartela_number);
              const isMine = myCartelas.includes(c.cartela_number);
              const isSelected = selected.includes(c.cartela_number);
              return (
                <button
                  type="button"
                  key={c.cartela_number}
                  disabled={isTaken}
                  onClick={() => toggle(c.cartela_number)}
                  className={`bingo-cartela-chip ${isSelected ? 'selected' : ''} ${isTaken ? 'taken' : ''} ${isMine ? 'mine' : ''}`}
                >
                  {c.cartela_number}
                </button>
              );
            })}
          </div>

          {error && <div className="error-text" style={{ marginTop: 10 }}>{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
            <span className="field-hint" style={{ margin: 0 }}>
              {selected.length} selected — {(selected.length * 10).toFixed(2)} ETB
            </span>
          </div>

          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 12 }}
            disabled={selected.length === 0 || submitting}
            onClick={() => onConfirm(selected)}
          >
            {submitting ? 'Staking...' : `Stake ${selected.length || ''} Cartela${selected.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Bingo() {
  const navigate = useNavigate();
  const { user, updateBalance } = useAuth();

  const [round, setRound] = useState(null);
  const [myCartelaNumbers, setMyCartelaNumbers] = useState([]);
  const [myCartelaData, setMyCartelaData] = useState([]);
  const [takenCartelas, setTakenCartelas] = useState([]);
  const [allCartelas, setAllCartelas] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [staking, setStaking] = useState(false);
  const [stakeError, setStakeError] = useState(null);
  const [lastCall, setLastCall] = useState(null);
  const [countdownMs, setCountdownMs] = useState(0);
  const [winnerInfo, setWinnerInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  const socketRef = useRef(null);
  const countdownTickRef = useRef(null);

  const refreshState = useCallback(async () => {
    try {
      const res = await getBingoState();
      setRound(res.data.round);
      setTakenCartelas(res.data.taken_cartelas || []);
      setMyCartelaNumbers(res.data.my_cartelas || []);
      if (res.data.round?.countdown_ends_at) {
        setCountdownMs(Math.max(res.data.round.countdown_ends_at - Date.now(), 0));
      }
    } catch {
      // Non-fatal.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshState();
    getBingoCartelas()
      .then((res) => setAllCartelas(res.data.cartelas))
      .catch(() => {});
  }, [refreshState]);

  // Load full cartela numbers for whichever cartelas the user owns this
  // round, so we can render live win-progress previews.
  useEffect(() => {
    if (myCartelaNumbers.length === 0 || allCartelas.length === 0) {
      setMyCartelaData([]);
      return;
    }
    setMyCartelaData(allCartelas.filter((c) => myCartelaNumbers.includes(c.cartela_number)));
  }, [myCartelaNumbers, allCartelas]);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    socket.on('bingo:round_open', (payload) => {
      setRound(payload);
      setWinnerInfo(null);
      setMyCartelaNumbers([]);
      setTakenCartelas([]);
      setLastCall(null);
    });

    socket.on('bingo:cartelas_taken', (payload) => {
      setTakenCartelas((prev) => [...new Set([...prev, ...payload.cartela_numbers])]);
    });

    socket.on('bingo:countdown_started', (payload) => {
      setRound((prev) => (prev ? { ...prev, status: 'countdown' } : prev));
      setCountdownMs(payload.countdown_ms);
    });

    socket.on('bingo:calling_started', () => {
      setRound((prev) => (prev ? { ...prev, status: 'calling' } : prev));
    });

    socket.on('bingo:number_called', (payload) => {
      setLastCall(payload);
      setRound((prev) => (prev ? { ...prev, called_numbers: payload.called_numbers } : prev));
      speak(payload.label.replace('-', ' '));
    });

    socket.on('bingo:round_finished', (payload) => {
      setWinnerInfo(payload);
      setRound((prev) => (prev ? { ...prev, status: 'finished' } : prev));
      refreshState();
    });

    return () => {
      socket.off('bingo:round_open');
      socket.off('bingo:cartelas_taken');
      socket.off('bingo:countdown_started');
      socket.off('bingo:calling_started');
      socket.off('bingo:number_called');
      socket.off('bingo:round_finished');
      socket.disconnect();
    };
  }, [refreshState]);

  // Local countdown ticker between server events.
  useEffect(() => {
    clearInterval(countdownTickRef.current);
    if (round?.status !== 'countdown' || countdownMs <= 0) return undefined;
    countdownTickRef.current = setInterval(() => {
      setCountdownMs((ms) => Math.max(ms - 1000, 0));
    }, 1000);
    return () => clearInterval(countdownTickRef.current);
  }, [round?.status, countdownMs > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStake = async (cartelaNumbers) => {
    setStaking(true);
    setStakeError(null);
    try {
      const res = await stakeBingoCartelas(cartelaNumbers);
      setMyCartelaNumbers((prev) => [...new Set([...prev, ...res.data.cartela_numbers])]);
      setTakenCartelas((prev) => [...new Set([...prev, ...res.data.cartela_numbers])]);
      if (user?.balance != null) {
        updateBalance(user.balance - res.data.total_stake);
      }
      setPickerOpen(false);
    } catch (err) {
      setStakeError(err.response?.data?.error || 'Could not stake those cartelas');
    } finally {
      setStaking(false);
    }
  };

  const calledNumbers = round?.called_numbers || [];
  const canStake = round && ['waiting', 'countdown'].includes(round.status);

  return (
    <div className="container" style={{ paddingBottom: 90 }}>
      <div className="bingo-header-row">
        <button type="button" className="icon-btn" onClick={() => navigate('/dashboard')} aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
            <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h3 className="wallet-title" style={{ margin: 0 }}>Bingo</h3>
        <span style={{ width: 32 }} />
      </div>

      <div className="bingo-status-card">
        {loading ? (
          <p className="field-hint">Loading round...</p>
        ) : round?.status === 'waiting' ? (
          <>
            <div className="bingo-status-title">Waiting for players</div>
            <p className="field-hint">The round starts a 45 second countdown as soon as you stake.</p>
          </>
        ) : round?.status === 'countdown' ? (
          <>
            <div className="bingo-status-title">Starting in {formatCountdown(countdownMs)}</div>
            <p className="field-hint">Stake now to join before the round starts.</p>
          </>
        ) : round?.status === 'calling' ? (
          <>
            <div className="bingo-status-title">Round in progress</div>
            {lastCall && (
              <div className="bingo-current-call" style={{ background: COLUMN_COLORS[lastCall.label[0]] }}>
                {lastCall.label}
              </div>
            )}
            <p className="field-hint">{calledNumbers.length} / 75 balls called</p>
          </>
        ) : (
          <div className="bingo-status-title">Round finished</div>
        )}
      </div>

      {winnerInfo && (
        <div className={`bingo-result-card ${winnerInfo.outcome === 'won' ? 'won' : 'platform'}`}>
          {winnerInfo.outcome === 'won' ? (
            <>
              <div className="bingo-result-title">
                {winnerInfo.winners.length > 1 ? 'Multiple Winners' : 'We Have a Winner'}
              </div>
              {winnerInfo.winners.map((w) => (
                <div key={w.user_id} className="bingo-result-winner-row">
                  <span>{w.name} — Cartela #{w.cartela_number}</span>
                  <span>ETB {w.payout.toFixed(2)}</span>
                </div>
              ))}
            </>
          ) : (
            <>
              <div className="bingo-result-title">Bingo Finished</div>
              <p className="field-hint" style={{ margin: 0 }}>No winner this round. The platform takes the pot.</p>
            </>
          )}
        </div>
      )}

      {canStake && (
        <button type="button" className="btn btn-primary" style={{ width: '100%', marginBottom: 14 }} onClick={() => setPickerOpen(true)}>
          {myCartelaNumbers.length > 0 ? `Add More Cartelas (${myCartelaNumbers.length} taken)` : 'Choose Your Cartela'}
        </button>
      )}

      {myCartelaData.length > 0 && (
        <div className="bingo-my-cartelas">
          {myCartelaData.map((c) => (
            <CartelaPreview
              key={c.cartela_number}
              numbers={c.numbers}
              calledNumbers={calledNumbers}
              cartelaNumber={c.cartela_number}
            />
          ))}
        </div>
      )}

      <div className="section-label-row" style={{ marginTop: 20 }}>
        <span className="section-label">Called Numbers</span>
      </div>
      <NumberBoard calledNumbers={calledNumbers} />

      {pickerOpen && (
        <CartelaPickerModal
          cartelas={allCartelas}
          takenCartelas={takenCartelas}
          myCartelas={myCartelaNumbers}
          onClose={() => setPickerOpen(false)}
          onConfirm={handleStake}
          submitting={staking}
          error={stakeError}
        />
      )}
    </div>
  );
}
