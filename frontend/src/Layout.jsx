import React from 'react';
import BottomNav from './components/BottomNav.jsx';

// Wraps any authenticated page's content with the persistent bottom nav.
// The page's own content scrolls normally; BottomNav is fixed to the
// bottom of the viewport via its own CSS.
export default function Layout({ children }) {
  return (
    <div style={{ minHeight: '100vh' }}>
      {children}
      <BottomNav />
    </div>
  );
}
