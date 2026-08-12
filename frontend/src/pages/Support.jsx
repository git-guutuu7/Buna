import React from 'react';

// Basic support page. Replace the contact target below with your real
// support channel (Telegram username, phone number, email, etc.) once
// decided.
export default function Support() {
  return (
    <div className="container" style={{ paddingBottom: 90 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Support</h2>
        <p style={{ color: '#9aa0b4' }}>
          Need help with a deposit, withdrawal, or something else? Reach out and we'll get back to you.
        </p>
        <a
          className="btn btn-primary"
          href="https://t.me/Helen23mjd"
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'inline-block', textDecoration: 'none', marginTop: 10 }}
        >
          Contact Support on Telegram
        </a>
        <a
          className="btn btn-primary"
          href="https://t.me/buna_games_best"
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'inline-block', textDecoration: 'none', marginTop: 10, marginLeft: 10 }}
        >
          Join Our Telegram Channel
        </a>
      </div>
    </div>
  );
}
