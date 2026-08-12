import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { telegramLogin } from '../api.js';
import { useAuth } from '../App.jsx';

// This app runs inside Telegram as a Mini App. On load, the Telegram Web
// App SDK gives us a signed `initData` string containing the user's
// Telegram identity. Referral codes reach us in one of two ways:
//   1. `tg.initDataUnsafe.start_param` - only populated when the Mini
//      App is opened via a Direct Link (t.me/bot/app?startapp=CODE) or
//      the Attachment Menu.
//   2. A `?ref=CODE` query parameter on the Mini App URL itself - this
//      is how bot.js delivers it, because this bot opens the Mini App
//      via an inline `web_app`-type button (after the phone-share
//      step), and that launch method does NOT populate start_param at
//      all (a Telegram Bot API limitation, not a bug here).
// We check both so referral tracking keeps working if the launch method
// ever changes, and send whichever is present to the backend - it
// verifies initData's signature and, for brand-new users only, links
// them to whoever owns that referral code (see auth.js's /telegram route).
export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState('checking');
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;

    if (!tg || !tg.initData) {
      setStatus('not-telegram');
      return;
    }

    tg.ready();
    tg.expand();

    const startParam = tg.initDataUnsafe?.start_param || null;
    const refQueryParam = new URLSearchParams(window.location.search).get('ref');
    const referralCode = startParam || refQueryParam || null;

    telegramLogin(tg.initData, referralCode)
      .then((res) => {
        login(res.data.user, res.data.token);
        setStatus('success');
        navigate('/dashboard');
      })
      .catch((err) => {
        setStatus('error');
        setErrorMsg(err.response?.data?.error || 'Could not verify your Telegram account. Please try again.');
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="container" style={{ maxWidth: 420, marginTop: '15vh', textAlign: 'center' }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Buna Games</h2>

        {status === 'checking' && <p style={{ color: '#9aa0b4' }}>Signing you in with Telegram...</p>}

        {status === 'not-telegram' && (
          <>
            <p style={{ color: '#9aa0b4' }}>
              This app only works inside Telegram. Please open it through your Telegram bot.
            </p>
            <p style={{ fontSize: 13, color: '#5b6178' }}>
              If you're testing outside Telegram, use Telegram Desktop or the Telegram app and
              open the Mini App from your bot's menu button.
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="error-text">{errorMsg}</div>
            <button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 12 }}>
              Try Again
            </button>
          </>
        )}

        {status === 'success' && <p className="success-text">Signed in! Redirecting...</p>}
      </div>
    </div>
  );
}
