import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App.jsx';
import { redeemCoupon } from '../api.js';
import CashbackCard from '../components/CashbackCard.jsx';

function RedeemCouponModal({ onClose, onRedeemed }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!code.trim()) {
      setError('Enter a coupon code');
      return;
    }
    setSubmitting(true);
    try {
      const res = await redeemCoupon(code.trim());
      setSuccess(res.data);
      onRedeemed(res.data.balance);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not redeem this coupon');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="deposit-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="deposit-modal-card">
        <div className="deposit-modal-header">
          <h4 className="deposit-modal-title">Redeem Coupon</h4>
          <button type="button" className="deposit-modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="deposit-modal-body">
          {success ? (
            <div>
              <div className="admin-notice" style={{ color: '#4ade80', background: 'rgba(74,222,128,0.1)', borderColor: 'rgba(74,222,128,0.3)' }}>
                {success.amount.toFixed(2)} ETB has been added to your balance.
              </div>
              <button className="btn btn-primary" type="button" onClick={onClose} style={{ width: '100%' }}>
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <label className="field-label">Coupon Code</label>
              <input
                className="input"
                type="text"
                placeholder="e.g. WELCOME50"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                style={{ textTransform: 'uppercase' }}
                autoFocus
              />
              {error && <div className="error-text">{error}</div>}
              <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: '100%', marginTop: 8 }}>
                {submitting ? 'Redeeming...' : 'Redeem'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// Landing page after login (the "Games" tab). Shows the Aviator game tile.
// Wallet, Support, and Profile now live on their own routes, reachable via
// the persistent bottom navigation.
export default function Dashboard() {
  const navigate = useNavigate();
  const { user, updateBalance } = useAuth();
  const [couponModalOpen, setCouponModalOpen] = useState(false);

  return (
    <div className="container" style={{ paddingBottom: 90 }}>
      <CashbackCard />

      <button
        type="button"
        className="profile-referral-banner"
        onClick={() => setCouponModalOpen(true)}
        style={{
          width: '100%',
          marginTop: 0,
          marginBottom: 14,
          borderRadius: 16,
        }}
      >
        <span className="profile-referral-banner-icon">
          <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
            <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1.5a1.5 1.5 0 0 0 0 3V15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1.5a1.5 1.5 0 0 0 0-3V9Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M10 7v10" stroke="currentColor" strokeWidth="1.8" strokeDasharray="1.6 2" strokeLinecap="round" />
          </svg>
        </span>
        <span className="profile-referral-banner-text">
          <strong>Redeem Coupon</strong>
          <span>Enter a code to add funds to your balance</span>
        </span>
        <span className="profile-referral-banner-arrow">›</span>
      </button>

      <div
        className="card"
        onClick={() => navigate('/dashboard/aviator')}
        style={{
          cursor: 'pointer',
          padding: 0,
          overflow: 'hidden',
          position: 'relative',
          minHeight: 220,
          borderRadius: 18,
          display: 'flex',
          alignItems: 'flex-end',
          border: '1px solid rgba(255,59,78,0.25)',
          boxShadow: '0 12px 28px rgba(255,59,78,0.15)',
          backgroundImage:
            'linear-gradient(180deg, rgba(15,17,23,0) 35%, rgba(15,17,23,0.92) 100%), radial-gradient(130% 100% at 10% 0%, rgba(255,59,78,0.32), transparent 62%), radial-gradient(90% 70% at 90% 100%, rgba(255,185,48,0.14), transparent 60%)',
          backgroundColor: '#121016',
          transition: 'transform 0.15s ease',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            fontSize: 28,
            fontWeight: 800,
            color: '#ff3b4e',
            letterSpacing: '-0.5px',
            textShadow: '0 0 18px rgba(255,59,78,0.45)',
          }}
        >
          Aviator
        </div>
        <div
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1,
            textTransform: 'uppercase',
            color: '#ffb930',
            background: 'rgba(0,0,0,0.4)',
            padding: '4px 10px',
            borderRadius: 999,
          }}
        >
          Live
        </div>
        <div style={{ padding: 20, width: '100%' }}>
          <div style={{ fontSize: 14, color: '#e8e8ea', fontWeight: 600, marginBottom: 4 }}>
            Watch it climb. Cash out before it crashes.
          </div>
          <div style={{ fontSize: 12, color: '#9aa0b4' }}>Tap to play</div>
        </div>
      </div>

      <div
        className="card"
        onClick={() => navigate('/dashboard/bingo')}
        style={{
          cursor: 'pointer',
          padding: 0,
          overflow: 'hidden',
          position: 'relative',
          minHeight: 220,
          marginTop: 14,
          borderRadius: 18,
          display: 'flex',
          alignItems: 'flex-end',
          border: '1px solid rgba(47,157,99,0.3)',
          boxShadow: '0 12px 28px rgba(47,157,99,0.15)',
          backgroundImage:
            'linear-gradient(180deg, rgba(15,17,23,0) 30%, rgba(15,17,23,0.92) 100%), radial-gradient(130% 100% at 90% 0%, rgba(47,157,99,0.3), transparent 60%), radial-gradient(90% 70% at 10% 100%, rgba(224,167,47,0.16), transparent 60%)',
          backgroundColor: '#101613',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            fontSize: 28,
            fontWeight: 800,
            color: '#3fbd7d',
            letterSpacing: '-0.5px',
            textShadow: '0 0 18px rgba(63,189,125,0.45)',
          }}
        >
          Bingo
        </div>
        <div style={{ padding: 20, width: '100%' }}>
          <div style={{ fontSize: 14, color: '#e8e8ea', fontWeight: 600, marginBottom: 4 }}>
            Classic 75-ball bingo. Mark a line, win the pot.
          </div>
          <div style={{ fontSize: 12, color: '#9aa0b4' }}>Tap to play</div>
        </div>
      </div>

      {couponModalOpen && (
        <RedeemCouponModal
          onClose={() => setCouponModalOpen(false)}
          onRedeemed={(newBalance) => updateBalance(newBalance)}
        />
      )}
    </div>
  );
}
