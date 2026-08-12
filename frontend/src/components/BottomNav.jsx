import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

// Persistent bottom navigation bar. Highlights the active tab based on the
// current route. Renders on every authenticated page via App.jsx's layout.
// Icons are plain inline SVGs (not emoji) so they render identically
// across every device/OS instead of depending on the platform's emoji set.

function GamesIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M7 7h10a4 4 0 0 1 4 4v2a4 4 0 0 1-4 4h-1.5l-1.5 2h-4l-1.5-2H7a4 4 0 0 1-4-4v-2a4 4 0 0 1 4-4Z"
        stroke={active ? '#ff3b4e' : '#7a7a85'}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9 11v2M8 12h2" stroke={active ? '#ff3b4e' : '#7a7a85'} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="16" cy="10.5" r="0.9" fill={active ? '#ff3b4e' : '#7a7a85'} />
      <circle cx="17.6" cy="12.3" r="0.9" fill={active ? '#ff3b4e' : '#7a7a85'} />
    </svg>
  );
}

function WalletIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="6" width="18" height="13" rx="2.5" stroke={active ? '#ff3b4e' : '#7a7a85'} strokeWidth="1.8" />
      <path d="M3 10h18" stroke={active ? '#ff3b4e' : '#7a7a85'} strokeWidth="1.8" />
      <path d="M7 6V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1" stroke={active ? '#ff3b4e' : '#7a7a85'} strokeWidth="1.8" />
      <circle cx="16.5" cy="14.5" r="1.1" fill={active ? '#ff3b4e' : '#7a7a85'} />
    </svg>
  );
}

function SupportIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 13a8 8 0 0 1 16 0"
        stroke={active ? '#ff3b4e' : '#7a7a85'}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <rect x="3" y="13" width="4" height="6" rx="1.5" stroke={active ? '#ff3b4e' : '#7a7a85'} strokeWidth="1.8" />
      <rect x="17" y="13" width="4" height="6" rx="1.5" stroke={active ? '#ff3b4e' : '#7a7a85'} strokeWidth="1.8" />
      <path
        d="M7 19v1a3 3 0 0 0 3 3h2"
        stroke={active ? '#ff3b4e' : '#7a7a85'}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ProfileIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="3.5" stroke={active ? '#ff3b4e' : '#7a7a85'} strokeWidth="1.8" />
      <path
        d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"
        stroke={active ? '#ff3b4e' : '#7a7a85'}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

const TABS = [
  { key: 'games', label: 'Games', path: '/dashboard', Icon: GamesIcon },
  { key: 'wallet', label: 'Wallet', path: '/wallet', Icon: WalletIcon },
  { key: 'support', label: 'Support', path: '/support', Icon: SupportIcon },
  { key: 'profile', label: 'Profile', path: '/profile', Icon: ProfileIcon },
];

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path) => {
    if (path === '/dashboard') {
      return location.pathname === '/dashboard' || location.pathname.startsWith('/dashboard/');
    }
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  return (
    <nav className="bottom-nav">
      {TABS.map(({ key, label, path, Icon }) => {
        const active = isActive(path);
        return (
          <button
            key={key}
            className={`bottom-nav-item ${active ? 'active' : ''}`}
            onClick={() => navigate(path)}
          >
            <span className="bottom-nav-icon">
              <Icon active={active} />
            </span>
            <span className="bottom-nav-label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
