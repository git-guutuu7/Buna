import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginUser, registerUser } from '../api.js';
import { useAuth } from '../App.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  // Referral code, if this link was opened as /login?ref=CODE.
  const referralCode = new URLSearchParams(window.location.search).get('ref');

  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg(null);

    if (mode === 'register' && password !== confirmPassword) {
      setErrorMsg('Passwords do not match');
      return;
    }

    setSubmitting(true);
    try {
      const res =
        mode === 'login'
          ? await loginUser(username.trim(), password)
          : await registerUser(username.trim(), phone.trim(), password, referralCode);

      login(res.data.user, res.data.token);
      navigate('/dashboard');
    } catch (err) {
      setErrorMsg(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: 420, marginTop: '15vh' }}>
      <div className="card">
        <h2 style={{ marginTop: 0, textAlign: 'center' }}>Buna Games</h2>

        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <button
            type="button"
            className={`btn ${mode === 'login' ? 'btn-primary' : ''}`}
            style={{ flex: 1 }}
            onClick={() => {
              setMode('login');
              setErrorMsg(null);
            }}
          >
            Log In
          </button>
          <button
            type="button"
            className={`btn ${mode === 'register' ? 'btn-primary' : ''}`}
            style={{ flex: 1 }}
            onClick={() => {
              setMode('register');
              setErrorMsg(null);
            }}
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 14, color: '#9aa0b4' }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              maxLength={30}
              className="input"
              style={{ width: '100%' }}
              autoComplete="username"
            />
          </div>

          {mode === 'register' && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', marginBottom: 6, fontSize: 14, color: '#9aa0b4' }}>
                Phone Number
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                placeholder="+251912345678"
                pattern="^\+251\d{9}$"
                title="Enter a valid Ethiopian phone number, e.g. +251912345678"
                className="input"
                style={{ width: '100%' }}
                autoComplete="tel"
              />
            </div>
          )}

          <div style={{ marginBottom: mode === 'register' ? 14 : 20 }}>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 14, color: '#9aa0b4' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="input"
              style={{ width: '100%' }}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          {mode === 'register' && (
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', marginBottom: 6, fontSize: 14, color: '#9aa0b4' }}>
                Confirm Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                className="input"
                style={{ width: '100%' }}
                autoComplete="new-password"
              />
            </div>
          )}

          {errorMsg && (
            <div className="error-text" style={{ marginBottom: 14 }}>
              {errorMsg}
            </div>
          )}

          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={submitting}>
            {submitting ? 'Please wait...' : mode === 'login' ? 'Log In' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
