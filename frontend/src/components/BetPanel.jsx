import React, { useState, useEffect, useRef } from 'react';
import api from '../api.js';
import { playBetSound, playCashOutSound } from '../sounds.js';

// Faithful port of the bet-panel design, wired to the real backend. The
// server (backend/src/game.js) is the only place that decides bet
// outcomes, auto-cashout timing, or payouts - this component only sends
// intents ("place bet", "cash out", "save auto-bet") and renders whatever
// state comes back, plus a purely-visual "potential payout" estimate.

const QUICK_AMOUNTS = [16, 40, 80, 400];

export default function BetPanel({ slot, phase, multiplier, socket, onBalanceChange, showRemove, onRemove }) {
  const [mode, setMode] = useState('bet'); // 'bet' | 'auto'
  const [amount, setAmount] = useState(16);
  const [autoCashoutValue, setAutoCashoutValue] = useState(2.0);
  const [autoBetNextRound, setAutoBetNextRound] = useState(false);

  // status: 'idle' | 'placed' | 'cashout' (flying, can cash out) | 'won' | 'lost'
  const [status, setStatus] = useState('idle');
  const [betAmount, setBetAmount] = useState(null);
  const [cashoutMultiplier, setCashoutMultiplier] = useState(null);
  const [payout, setPayout] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const amountEditLocked = phase !== 'betting';

  // BUG FIX: the auto-bet-next-round effect below fires placeBet(true)
  // from inside a useEffect keyed only on [phase]. Because placeBet reads
  // `amount`/`autoCashoutValue`/`mode` from its enclosing closure, and
  // that closure is only recreated when the EFFECT re-runs (not on every
  // render), the effect was capturing whatever those values were at an
  // earlier point in time - not whatever the user most recently typed.
  // In practice this meant auto-bet-next-round could silently keep using
  // a stale auto-cashout target (e.g. the 2.0 default) even after the
  // user changed it, which is exactly the "always cashes out at 2" bug.
  //
  // Fix: keep the latest values in a ref that's updated on every render,
  // and read FROM THE REF inside the effect instead of from the closed-
  // over state variables directly. Refs are not subject to the stale-
  // closure problem the way captured state values are.
  const latestRef = useRef({ amount, autoCashoutValue, mode });
  useEffect(() => {
    latestRef.current = { amount, autoCashoutValue, mode };
  }, [amount, autoCashoutValue, mode]);

  // Reset per-round display state when a new betting phase begins, and
  // fire an auto-bet if the toggle is on - now reading fresh values via
  // the ref instead of stale closed-over state.
  useEffect(() => {
    if (phase === 'betting') {
      setStatus('idle');
      setCashoutMultiplier(null);
      setPayout(null);
      setError(null);
      if (autoBetNextRound) placeBetWithLatestValues();
    } else if (phase === 'flying' && status === 'placed') {
      setStatus('cashout');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Listen for server-driven auto-cashout results for this slot.
  useEffect(() => {
    if (!socket) return;
    const handler = (data) => {
      if (data.slot !== slot) return;
      setStatus('won');
      setCashoutMultiplier(data.multiplier);
      setPayout(data.payout);
      onBalanceChange();
    };
    socket.on('bet:auto_cashed_out', handler);
    return () => socket.off('bet:auto_cashed_out', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, slot]);

  // Auto-bet-next-round always goes through this, reading current values
  // from the ref (always fresh) rather than from function-closure state.
  const placeBetWithLatestValues = async () => {
    const { amount: freshAmount, autoCashoutValue: freshAutoCashout, mode: freshMode } = latestRef.current;
    await placeBetCore(freshAmount, freshMode, freshAutoCashout, true);
  };

  const placeBet = async () => {
    await placeBetCore(amount, mode, autoCashoutValue, false);
  };

  const placeBetCore = async (betAmountValue, betMode, autoCashoutTarget, isAuto) => {
    setError(null);
    if (!betAmountValue || betAmountValue <= 0) {
      if (!isAuto) setError('Enter a valid amount');
      return;
    }
    const payload = { amount: betAmountValue, slot };
    if (betMode === 'auto') {
      if (!autoCashoutTarget || autoCashoutTarget <= 1) {
        if (!isAuto) setError('Auto-cashout must be greater than 1.00x');
        return;
      }
      payload.auto_cashout_at = autoCashoutTarget;
    }
    setSubmitting(true);
    try {
      const res = await api.post('/game/bet', payload);
      if (!isAuto) playBetSound();
      setStatus('placed');
      setBetAmount(betAmountValue);
      onBalanceChange(res.data.balance);
    } catch (err) {
      if (!isAuto) setError(err.response?.data?.error || 'Could not place bet');
    } finally {
      setSubmitting(false);
    }
  };

  const cancelBet = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.post('/game/cancel-bet', { slot });
      setStatus('idle');
      setBetAmount(null);
      onBalanceChange(res.data.balance);
    } catch (err) {
      // If the server refuses (e.g. betting just closed), keep showing
      // the bet as placed rather than silently hiding a bet that's
      // actually still active - that mismatch is exactly the bug this
      // replaces.
      setError(err.response?.data?.error || 'Could not cancel bet');
    } finally {
      setSubmitting(false);
    }
  };

  const cashOut = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.post('/game/cashout', { slot });
      playCashOutSound(res.data.multiplier);
      setStatus('won');
      setCashoutMultiplier(res.data.multiplier);
      setPayout(res.data.payout);
      onBalanceChange(res.data.balance);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not cash out');
      setStatus('lost');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleAutoBetNextRound = async (checked) => {
    setAutoBetNextRound(checked);
    try {
      await api.put(`/game/auto-bet/${slot}`, {
        enabled: checked,
        amount,
        auto_cashout_at: mode === 'auto' ? autoCashoutValue : null,
      });
    } catch {
      setAutoBetNextRound(!checked);
    }
  };

  const step = (delta) => {
    if (amountEditLocked) return;
    setAmount((prev) => Math.max(1, Math.round((prev + delta) * 100) / 100));
  };

  // Live "potential payout if you cashed out right now" preview - purely
  // visual, computed client-side from the bet amount and the current
  // multiplier the server is broadcasting. This never determines the
  // ACTUAL payout (that's decided server-side when cashout/auto-cashout
  // actually executes) - it's just a live estimate for the player to see.
  const showPotentialPayout = (status === 'placed' || status === 'cashout') && phase === 'flying' && multiplier;
  const potentialPayout = showPotentialPayout ? (betAmount * multiplier).toFixed(2) : null;

  return (
    <div className="bet-panel" data-mode={mode}>
      <div className="bet-panel-topline">
        <div className="mode-tabs">
          <div
            className={`mode-tab ${mode === 'bet' ? 'active' : ''}`}
            onClick={() => !amountEditLocked && setMode('bet')}
          >
            Bet
          </div>
          <div
            className={`mode-tab ${mode === 'auto' ? 'active' : ''}`}
            onClick={() => !amountEditLocked && setMode('auto')}
          >
            Auto
          </div>
        </div>
        {showRemove && (
          <button className="panel-remove-btn" onClick={onRemove} title="Remove panel">
            &minus;
          </button>
        )}
      </div>

      {mode === 'auto' && (
        <div className="auto-row" style={{ display: 'flex' }}>
          <span className="auto-label">Auto cash out at</span>
          <input
            type="number"
            step="0.1"
            min="1.01"
            value={autoCashoutValue}
            disabled={amountEditLocked}
            onChange={(e) => setAutoCashoutValue(parseFloat(e.target.value) || 0)}
          />
        </div>
      )}

      <div className="bet-panel-body">
        <div className="bet-amount-block">
          <div className="stepper-row">
            <button className="stepper-btn" disabled={amountEditLocked} onClick={() => step(-1)}>
              &minus;
            </button>
            <input
              className="stepper-input"
              type="number"
              step="1"
              min="1"
              value={amount}
              disabled={amountEditLocked}
              onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
            />
            <button className="stepper-btn" disabled={amountEditLocked} onClick={() => step(1)}>
              +
            </button>
          </div>
          <div className="quick-amount-grid">
            {QUICK_AMOUNTS.map((v) => (
              <button
                key={v}
                className={`quick-amount-btn ${Math.abs(amount - v) < 0.001 ? 'selected' : ''}`}
                disabled={amountEditLocked}
                onClick={() => setAmount(v)}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="bet-action-block">
          <ActionButton
            phase={phase}
            status={status}
            amount={amount}
            betAmount={betAmount}
            cashoutMultiplier={cashoutMultiplier}
            payout={payout}
            potentialPayout={potentialPayout}
            submitting={submitting}
            onPlace={placeBet}
            onCancel={cancelBet}
            onCashOut={cashOut}
          />
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-dim)', marginTop: 10 }}>
        <input type="checkbox" checked={autoBetNextRound} onChange={(e) => toggleAutoBetNextRound(e.target.checked)} />
        Auto-bet next round
      </label>

      {error && <div className="error-text" style={{ marginTop: 8, fontSize: 12 }}>{error}</div>}
    </div>
  );
}

function ActionButton({ phase, status, amount, betAmount, cashoutMultiplier, payout, potentialPayout, submitting, onPlace, onCancel, onCashOut }) {
  if (phase === 'betting') {
    if (status === 'placed') {
      return (
        <button className="bet-btn state-placed" onClick={onCancel} disabled={submitting}>
          <span className="bet-btn-top">Cancel</span>
          <span className="bet-btn-sub">{betAmount?.toFixed(2)} ETB</span>
        </button>
      );
    }
    return (
      <button className="bet-btn state-idle" onClick={onPlace} disabled={submitting}>
        <span className="bet-btn-top">Bet</span>
        <span className="bet-btn-sub">
          {amount?.toFixed(2)}
          <span className="cur-tag">ETB</span>
        </span>
      </button>
    );
  }

  if (phase === 'flying') {
    if (status === 'won') {
      return (
        <button className="bet-btn state-won" disabled>
          <span className="bet-btn-top">Cashed Out {cashoutMultiplier}x</span>
          <span className="bet-btn-sub">+{payout?.toFixed(2)} ETB</span>
        </button>
      );
    }
    if (status === 'cashout' || status === 'placed') {
      return (
        <button className="bet-btn state-cashout" onClick={onCashOut} disabled={submitting}>
          <span className="bet-btn-top">Cash Out</span>
          <span className="bet-btn-sub">
            {potentialPayout ? `${potentialPayout} ETB` : `${amount?.toFixed(2)} ETB`}
          </span>
        </button>
      );
    }
  }

  if (status === 'lost') {
    return (
      <button className="bet-btn state-lost" disabled>
        <span className="bet-btn-top">Lost</span>
        <span className="bet-btn-sub">{amount?.toFixed(2)} ETB</span>
      </button>
    );
  }

  return (
    <button className="bet-btn state-idle" disabled>
      <span className="bet-btn-top">Bet</span>
      <span className="bet-btn-sub">
        {amount?.toFixed(2)}
        <span className="cur-tag">ETB</span>
      </span>
    </button>
  );
}
