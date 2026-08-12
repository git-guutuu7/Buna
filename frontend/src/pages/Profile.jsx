import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App.jsx';

function initials(name) {
  if (!name) return '?';
  return name.trim().charAt(0).toUpperCase();
}

export default function Profile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const displayName = user?.telegram_first_name || user?.username || 'Player';

  return (
    <div className="container" style={{ paddingBottom: 90 }}>
      <div className="card wallet-card profile-card">
        <div className="wallet-scroll-header">
          <h3 className="wallet-title">Profile</h3>
        </div>

        <div className="wallet-scroll-body">
          <div className="profile-identity-card">
            <span className="profile-avatar">{initials(displayName)}</span>
            <div className="profile-identity-text">
              <strong>{displayName}</strong>
              <span className="field-hint" style={{ margin: 0 }}>
                {user?.username}
                {user?.telegram_phone ? ` • ${user.telegram_phone}` : ''}
              </span>
            </div>
          </div>

          <div className="balance-panel">
            <div className="balance-panel-header">
              <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                <rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
                <path d="M3 10h18" stroke="currentColor" strokeWidth="1.6" />
                <path d="M15 14h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <span>Account Balance</span>
            </div>
            <div className="balance-panel-value">
              <span className="balance-currency">ETB</span>
              {Number(user?.balance || 0).toFixed(2)}
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate('/wallet')}
              style={{ width: '100%', marginTop: 14 }}
            >
              Open Wallet
            </button>
          </div>

          <button
            type="button"
            className="profile-referral-banner"
            onClick={() => navigate('/referral')}
          >
            <span className="profile-referral-banner-icon">
              <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
                <rect x="3" y="8" width="18" height="4" rx="1" stroke="currentColor" strokeWidth="1.6" />
                <rect x="4" y="12" width="16" height="9" rx="1" stroke="currentColor" strokeWidth="1.6" />
                <path d="M12 8v13" stroke="currentColor" strokeWidth="1.6" />
                <path d="M12 8c-1.2-2.6-2.8-4-4.2-4A2.2 2.2 0 0 0 5.6 6.2c0 1 .8 1.8 2 1.8H12Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                <path d="M12 8c1.2-2.6 2.8-4 4.2-4a2.2 2.2 0 0 1 2.2 2.2c0 1-.8 1.8-2 1.8H12Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="profile-referral-banner-text">
              <strong>Invite Friends & Earn</strong>
              <span>Share your link and earn commission on every referral</span>
            </span>
            <span className="profile-referral-banner-arrow">›</span>
          </button>

          {user?.role === 'admin' && (
            <button
              className="btn btn-outline"
              onClick={() => navigate('/admin')}
              style={{ marginTop: 12, width: '100%' }}
            >
              Switch to Admin Panel
            </button>
          )}

          <button className="btn btn-outline" onClick={handleLogout} style={{ marginTop: 10, width: '100%' }}>
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
