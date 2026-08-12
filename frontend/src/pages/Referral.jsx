import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../App.jsx';
import { getReferralStats } from '../api.js';

const HOW_IT_WORKS = [
  {
    title: 'Share your link',
    body: 'Send your referral link to friends. Anyone who opens it and joins is linked to you.',
  },
  {
    title: 'They deposit',
    body: "When someone you referred makes their first deposit, it's recorded against your account.",
  },
  {
    title: 'You earn commission',
    body: 'You automatically receive a commission on their first deposit, credited straight to your balance.',
  },
];

export default function Referral() {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState({ referred_count: 0, total_commission: 0, total_ggr: 0 });
  const [loadingStats, setLoadingStats] = useState(true);

  const botUsername = import.meta.env.VITE_BOT_USERNAME || 'your_bot';
  const referralLink = user?.referral_code
    ? `https://t.me/${botUsername}?start=${user.referral_code}`
    : null;

  const loadStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const res = await getReferralStats();
      setStats(res.data);
    } catch {
      // Non-fatal - keep showing the last known values.
    } finally {
      setLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleCopy = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy your referral link:', referralLink);
    }
  };

  const handleShare = () => {
    if (!referralLink) return;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}`;
    window.open(shareUrl, '_blank');
  };

  return (
    <div className="container" style={{ paddingBottom: 90 }}>
      <div className="card wallet-card">
        <div className="wallet-scroll-header">
          <h3 className="wallet-title">Referral Program</h3>
        </div>

        <div className="wallet-scroll-body">
          <div className="profile-identity-card">
            <span className="profile-avatar">
              {(user?.telegram_first_name || user?.username || '?').trim().charAt(0).toUpperCase()}
            </span>
            <div className="profile-identity-text">
              <strong>{user?.telegram_first_name || user?.username}</strong>
              <span className="field-hint" style={{ margin: 0 }}>
                {user?.telegram_phone || user?.username}
              </span>
            </div>
          </div>

          <div className="balance-sub-grid" style={{ marginBottom: 16 }}>
            <div className="balance-sub-card">
              <span className="balance-sub-label">
                <svg viewBox="0 0 24 24" fill="none" width="13" height="13">
                  <path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M17 19v-1.5a3.5 3.5 0 0 0-2.5-3.35" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  <path d="M14.5 5.1a3 3 0 0 1 0 5.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                REFERRED USERS
              </span>
              <span className="balance-sub-value" style={{ color: '#f4f0ea' }}>
                {loadingStats ? '—' : stats.referred_count}
              </span>
            </div>
            <div className="balance-sub-card">
              <span className="balance-sub-label balance-sub-label-safe">
                <svg viewBox="0 0 24 24" fill="none" width="13" height="13">
                  <rect x="3" y="8" width="18" height="4" rx="1" stroke="currentColor" strokeWidth="1.6" />
                  <rect x="4" y="12" width="16" height="9" rx="1" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M12 8v13" stroke="currentColor" strokeWidth="1.6" />
                </svg>
                COMMISSION (ETB)
              </span>
              <span className="balance-sub-value balance-sub-value-safe">
                {loadingStats ? '—' : stats.total_commission.toFixed(2)}
              </span>
            </div>
            <div className="balance-sub-card">
              <span className="balance-sub-label balance-sub-label-safe">
                <svg viewBox="0 0 24 24" fill="none" width="13" height="13">
                  <path d="M4 17l5-5 3 3 7-8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M15 7h4v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                GGR AMOUNT
              </span>
              <span className="balance-sub-value balance-sub-value-safe">
                ETB {loadingStats ? '—' : stats.total_ggr.toFixed(2)}
              </span>
            </div>
          </div>

          <label className="field-label">Your Referral Link</label>
          {referralLink ? (
            <>
              <div className="referral-link-row">
                <span className="referral-link-text">{referralLink}</span>
                <button type="button" className="icon-btn" onClick={handleCopy} aria-label="Copy referral link">
                  {copied ? (
                    <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                      <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                      <rect x="9" y="9" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                      <path d="M5 15V5a1 1 0 0 1 1-1h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  )}
                </button>
              </div>

              <button type="button" className="btn btn-primary referral-share-btn" onClick={handleShare}>
                <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                  <circle cx="18" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.6" />
                  <circle cx="6" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.6" />
                  <circle cx="18" cy="19" r="2.5" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M8.2 10.8L15.8 6.2M8.2 13.2l7.6 4.6" stroke="currentColor" strokeWidth="1.6" />
                </svg>
                Share with Friends
              </button>
            </>
          ) : (
            <p className="field-hint">Your referral link is being set up. Please check back shortly.</p>
          )}

          <div className="section-label-row" style={{ marginTop: 24 }}>
            <span className="section-label">How Referrals Work</span>
          </div>

          <div className="how-it-works-list">
            {HOW_IT_WORKS.map((step, i) => (
              <div className="how-it-works-item" key={step.title}>
                <span className="how-it-works-num">{i + 1}</span>
                <div>
                  <strong className="how-it-works-title">{step.title}</strong>
                  <p className="field-hint" style={{ margin: '2px 0 0' }}>{step.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
