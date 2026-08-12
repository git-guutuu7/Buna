import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getCashbackStatus, claimCashback } from '../api.js';

// Formats a seconds count as HH:MM:SS for the countdown display.
function formatHMS(totalSeconds) {
  const clamped = Math.max(Math.floor(totalSeconds), 0);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  return {
    h: String(h).padStart(2, '0'),
    m: String(m).padStart(2, '0'),
    s: String(s).padStart(2, '0'),
  };
}

const REASON_MESSAGES = {
  not_eligible_withdrawn: 'make deposit get 20% Cashback.',
  balance_not_zero: "Cashback unlocks once today's balance has been fully lost.",
  no_deposit_today: 'Make a deposit today to become eligible for cashback.',
  cooldown: null, // shown via the countdown instead
};

export default function CashbackCard({ onClaimed }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const tickRef = useRef(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await getCashbackStatus();
      setStatus(res.data);
      setSecondsLeft(res.data.seconds_until_next_claim || 0);
    } catch {
      // Non-fatal - the card just won't render actionable info this pass.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Local countdown ticker; re-syncs with the server once it hits zero so
  // eligibility (which depends on today's deposits/balance, not just time)
  // gets re-checked rather than trusting the clock alone.
  useEffect(() => {
    clearInterval(tickRef.current);
    if (secondsLeft <= 0) return undefined;
    tickRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          loadStatus();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(tickRef.current);
  }, [secondsLeft > 0, loadStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClaim = async () => {
    if (claiming || !status?.eligible) return;
    setClaiming(true);
    setError(null);
    setMessage(null);
    try {
      const res = await claimCashback();
      setMessage(res.data.message);
      onClaimed?.(res.data.transaction);
      await loadStatus();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not claim cashback right now.');
      await loadStatus();
    } finally {
      setClaiming(false);
    }
  };

  if (loading) return null;
  if (!status) return null;

  const onCooldown = secondsLeft > 0;
  const { h, m, s } = formatHMS(secondsLeft);

  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 18,
        padding: '20px 20px 22px',
        marginBottom: 14,
        background:
          'radial-gradient(140% 100% at 100% 0%, rgba(56,131,255,0.55), transparent 55%), linear-gradient(160deg, #0f2a63 0%, #123a86 45%, #1450c4 100%)',
        boxShadow: '0 10px 30px rgba(20,80,196,0.35)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30,
            height: 30,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.14)',
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
            <path
              d="M12 3a9 9 0 1 0 9 9"
              stroke="#fff"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <path d="M17 3v5h-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="12" cy="12" r="4.2" stroke="#fff" strokeWidth="1.6" />
            <path d="M12 10v4M10.6 11h2.8M10.6 13h2.8" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </span>
        <span style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>Daily Cashback</span>
      </div>

      {onCooldown ? (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            {[
              { v: h, label: 'HRS' },
              { v: m, label: 'MIN' },
              { v: s, label: 'SEC' },
            ].map((block, i) => (
              <React.Fragment key={block.label}>
                <div
                  style={{
                    flex: 1,
                    textAlign: 'center',
                    background: 'rgba(255,255,255,0.1)',
                    borderRadius: 12,
                    padding: '10px 0',
                  }}
                >
                  <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', lineHeight: 1 }}>{block.v}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 4, letterSpacing: 1 }}>
                    {block.label}
                  </div>
                </div>
                {i < 2 && (
                  <span style={{ alignSelf: 'center', color: 'rgba(255,255,255,0.5)', fontWeight: 700 }}>:</span>
                )}
              </React.Fragment>
            ))}
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: 'rgba(255,255,255,0.75)' }}>
            Your next cashback becomes available when this timer ends.
          </p>
        </>
      ) : (
        <>
          {status.eligible ? (
            <>
              <p style={{ margin: '0 0 12px', fontSize: 13.5, color: 'rgba(255,255,255,0.85)' }}>
                You lost <strong>ETB {status.deposited_today.toFixed(2)}</strong> deposited today. Claim{' '}
                <strong>ETB {status.cashback_amount.toFixed(2)}</strong> back now.
              </p>
              <button
                type="button"
                onClick={handleClaim}
                disabled={claiming}
                style={{
                  width: '100%',
                  border: 'none',
                  borderRadius: 12,
                  padding: '13px 0',
                  fontSize: 15,
                  fontWeight: 800,
                  color: '#0f2a63',
                  background: claiming ? 'rgba(255,255,255,0.6)' : '#ffffff',
                  cursor: claiming ? 'default' : 'pointer',
                }}
              >
                {claiming ? 'Claiming...' : `Claim ETB ${status.cashback_amount.toFixed(2)} Cashback`}
              </button>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.75)' }}>
              {REASON_MESSAGES[status.reason] || 'Cashback is not available right now.'}
            </p>
          )}
        </>
      )}

      {message && (
        <div style={{ marginTop: 12, fontSize: 12.5, color: '#c8f7d4', fontWeight: 600 }}>{message}</div>
      )}
      {error && (
        <div style={{ marginTop: 12, fontSize: 12.5, color: '#ffb4b4', fontWeight: 600 }}>{error}</div>
      )}
    </div>
  );
}
