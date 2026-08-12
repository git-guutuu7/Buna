import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { requestDeposit, getMyTransactions } from '../api.js';
import { useAuth } from '../App.jsx';
import './TransactionPages.css';

export default function Deposit() {
  const { user, updateBalance } = useAuth();
  const navigate = useNavigate();
  const [amount, setAmount] = useState('');
  const [telebirrRef, setTelebirrRef] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [loadingTx, setLoadingTx] = useState(true);

  const loadTransactions = useCallback(async () => {
    setLoadingTx(true);
    try {
      const res = await getMyTransactions();
      setTransactions(res.data.transactions.filter(t => t.type === 'deposit'));
    } catch (err) {
      // Non-fatal
    } finally {
      setLoadingTx(false);
    }
  }, []);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    setError(null);

    const numericAmount = parseFloat(amount);
    if (!numericAmount || numericAmount <= 0) {
      setError('Enter a valid amount greater than 0');
      return;
    }

    if (!telebirrRef.trim()) {
      setError('Enter the Telebirr transaction reference for your payment');
      return;
    }

    setSubmitting(true);
    try {
      await requestDeposit(numericAmount, telebirrRef.trim(), note);
      setMessage('Deposit request submitted successfully. An admin will verify your payment shortly.');
      setAmount('');
      setTelebirrRef('');
      setNote('');
      loadTransactions();
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="transaction-page">
      <div className="transaction-header">
        <button className="back-btn" onClick={() => navigate('/dashboard')}>
          Back
        </button>
        <h1>Deposit Funds</h1>
        <div style={{ width: '40px' }}></div>
      </div>

      <div className="transaction-container">
        <div className="transaction-card">
          <div className="card-header">
            <h2>Add Funds to Your Account</h2>
            <p>please wait</p>
          </div>

          <form onSubmit={handleSubmit} className="transaction-form">
            <div className="form-group">
              <label>Amount (ETB)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Enter amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>Telebirr Transaction Reference</label>
              <input
                type="text"
                placeholder="Enter transaction reference (required)"
                value={telebirrRef}
                onChange={(e) => setTelebirrRef(e.target.value)}
                required
              />
              <small>This is the reference number from your Telebirr payment</small>
            </div>

            <div className="form-group">
              <label>Note (Optional)</label>
              <textarea
                placeholder="Add any additional notes"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows="3"
              />
            </div>

            {error && <div className="alert alert-error">{error}</div>}
            {message && <div className="alert alert-success">{message}</div>}

            <button 
              type="submit" 
              disabled={submitting}
              className="submit-btn"
            >
              {submitting ? 'Submitting...' : 'Request Deposit'}
            </button>
          </form>

          <div className="info-box">
            <h3>How to Deposit</h3>
            <ol>
              <li>operator telebirr: 0992000962</li>
              li>operator telebirr name: Gutu</li>
              <li>Send payment to the operator's Telebirr account</li>
              <li>Copy the transaction reference from your Telebirr receipt</li>
              <li>Paste it in the form above</li>
              <li>An admin will verify and credit your account</li>
            </ol>
          </div>
        </div>

        {/* Recent Deposits */}
        <div className="recent-transactions">
          <h3>Recent Deposits</h3>
          {loadingTx ? (
            <p>Loading...</p>
          ) : transactions.length === 0 ? (
            <p className="no-data">No deposits yet</p>
          ) : (
            <div className="tx-list">
              {transactions.map((t) => (
                <div key={t.id} className="tx-item">
                  <div className="tx-info">
                    <div className="tx-amount">{(t.amount).toFixed(2)} ETB</div>
                    <div className="tx-date">{new Date(t.created_at).toLocaleDateString()}</div>
                  </div>
                  <div className={`tx-status status-${t.status}`}>
                    {t.status.charAt(0).toUpperCase() + t.status.slice(1)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
