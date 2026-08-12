import React, { useState, useEffect, useCallback, useRef } from 'react';
import { requestDeposit, requestWithdraw, getMyTransactions, getBalance } from '../api.js';
import { useAuth } from '../App.jsx';

const MIN_DEPOSIT = 10;
const MIN_WITHDRAW = 200;
const WAGERING_MULTIPLIER = 100;

const PAYMENT_METHODS = [
  {
    id: 'telebirr',
    label: 'Telebirr',
    logo: 'https://www.ethiotelecom.et/wp-content/uploads/2025/10/telebirr-logo-01.png',
  },
  {
    id: 'cbebirr',
    label: 'CBE Birr',
    logo: 'https://ethiopianlogos.com/logos/cbe_birr_normal/cbe_birr_normal.png',
  },
];

// Agents accept deposits on behalf of the platform; each has one account
// per payment method. Currently only one agent is active.
const AGENTS = [
  {
    id: 'gutu',
    name: 'Gutu',
    accounts: { telebirr: '0992000962', cbebirr: '0992000962' },
  },
];

const DEPOSIT_WINDOW_SECONDS = 15 * 60;

function formatCountdown(totalSeconds) {
  const clamped = Math.max(totalSeconds, 0);
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function PaymentMethodGrid({ selected, onSelect }) {
  return (
    <div className="pm-grid">
      {PAYMENT_METHODS.map((m) => (
        <button
          type="button"
          key={m.id}
          className={`pm-card ${selected === m.id ? 'active' : ''}`}
          onClick={() => onSelect(m.id)}
        >
          <span className="pm-card-logo">
            <img src={m.logo} alt={m.label} />
          </span>
          <span className="pm-card-label">{m.label}</span>
        </button>
      ))}
    </div>
  );
}

// Step 1 — amount + payment method
function DepositAmountStep({ amount, setAmount, method, setMethod, onContinue }) {
  const [error, setError] = useState(null);

  const handleContinue = (e) => {
    e.preventDefault();
    const numericAmount = parseFloat(amount);
    if (!numericAmount || numericAmount <= 0) {
      setError('Enter a valid amount');
      return;
    }
    if (numericAmount < MIN_DEPOSIT) {
      setError(`Minimum deposit is ${MIN_DEPOSIT} ETB`);
      return;
    }
    if (!method) {
      setError('Select a payment method');
      return;
    }
    setError(null);
    onContinue();
  };

  return (
    <form onSubmit={handleContinue}>
      <div className="amount-field">
        <span className="amount-field-currency">ETB</span>
        <input
          className="amount-field-input"
          type="number"
          step="0.01"
          min={MIN_DEPOSIT}
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          autoFocus
        />
      </div>
      <p className="field-hint">Minimum deposit is {MIN_DEPOSIT} ETB</p>

      <div className="section-label-row">
        <span className="section-label">Select Payment Method</span>
        <span className="section-label-count">{PAYMENT_METHODS.length} Available</span>
      </div>
      <PaymentMethodGrid selected={method} onSelect={setMethod} />

      {error && <div className="error-text">{error}</div>}
      <button className="btn btn-primary" type="submit" style={{ width: '100%', marginTop: 8 }}>
        Continue
      </button>
    </form>
  );
}

// Step 2 — instructions to pay the agent's account, with a countdown
function DepositInstructionsStep({ amount, method, agent, onCompleted }) {
  const [secondsLeft, setSecondsLeft] = useState(DEPOSIT_WINDOW_SECONDS);
  const [copied, setCopied] = useState(false);
  const methodMeta = PAYMENT_METHODS.find((m) => m.id === method);
  const accountNumber = agent.accounts[method];

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleCopy = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy this value:', value);
    }
  };

  return (
    <div className="deposit-instructions">
      <p className="field-hint">Please follow the steps below to complete your deposit.</p>

      <div className="countdown-box">
        <span className="countdown-label">COMPLETE PAYMENT BEFORE</span>
        <span className="countdown-value">{formatCountdown(secondsLeft)} remaining</span>
      </div>

      <div className="instruction-step">
        <span className="instruction-step-num">1</span>
        <span className="instruction-step-title">Transfer Exact Amount</span>
      </div>
      <div className="amount-display-row">
        <div>
          <span className="field-hint" style={{ margin: 0 }}>TOTAL AMOUNT</span>
          <div className="amount-display-value">ETB {amount}</div>
        </div>
        <button type="button" className="icon-btn" onClick={() => handleCopy(amount)} aria-label="Copy amount">
          ⧉
        </button>
      </div>

      <div className="instruction-step">
        <span className="instruction-step-num">2</span>
        <span className="instruction-step-title">Recipient Information</span>
      </div>
      <div className="recipient-info-block">
        <div className="recipient-info-row">
          <span className="recipient-info-label">Bank Name</span>
          <span className="recipient-info-value">{methodMeta?.label?.toUpperCase()}</span>
        </div>
        <div className="recipient-info-row">
          <span className="recipient-info-label">Account Name</span>
          <span className="recipient-info-value">{agent.name.toUpperCase()}</span>
        </div>
        <div className="recipient-info-row">
          <span className="recipient-info-label">Account Number</span>
          <span className="recipient-info-value">
            {accountNumber}
            <button type="button" className="btn btn-outline copy-inline-btn" onClick={() => handleCopy(accountNumber)}>
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </span>
        </div>
      </div>

      <div className="instruction-step">
        <span className="instruction-step-num">3</span>
        <span className="instruction-step-title">Submit Proof</span>
      </div>
      <p className="field-hint">
        After completing the transfer, tap below to enter your transaction reference or upload your receipt.
      </p>

      <button className="btn btn-primary" type="button" onClick={onCompleted} style={{ width: '100%' }}>
        I Have Completed Payment
      </button>
    </div>
  );
}

// Step 4 — submit reference number / receipt for admin verification
function CompleteOrderStep({ amount, reference, setReference, note, setNote, error, submitting, onSubmit, onCancel }) {
  return (
    <form onSubmit={onSubmit} className="complete-order">
      <span className="chip chip-amount">ETB {amount}</span>

      <div className="notice-box">
        <span>Add reference number or upload receipt</span>
      </div>

      <label className="field-label">Reference Number</label>
      <input
        className="input"
        type="text"
        placeholder="Enter transaction reference"
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        autoFocus
      />

      <label className="field-label">Note (optional)</label>
      <input
        className="input"
        type="text"
        placeholder="Add a note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      {error && <div className="error-text">{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button type="button" className="btn btn-outline" onClick={onCancel} disabled={submitting} style={{ flex: 1 }}>
          Cancel
        </button>
        <button className="btn btn-primary" type="submit" disabled={submitting} style={{ flex: 1 }}>
          {submitting ? 'Submitting...' : 'Confirm Update'}
        </button>
      </div>
    </form>
  );
}

// Orchestrates the 4-step deposit flow.
// Centered modal overlay that dims the wallet page behind it - matches
// the popup-per-step pattern used for the deposit flow.
function DepositModal({ title, onClose, children }) {
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="deposit-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="deposit-modal-card">
        <div className="deposit-modal-header">
          <h4 className="deposit-modal-title">{title}</h4>
          <button type="button" className="deposit-modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="deposit-modal-body">{children}</div>
      </div>
    </div>
  );
}

function DepositWizard({ onSubmitted, onClose }) {
  const [step, setStep] = useState(1);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('telebirr');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Only one agent is currently active, so it's selected automatically -
  // there's nothing for the user to choose.
  const agent = AGENTS[0];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!reference.trim()) {
      setError('Enter the transaction reference for your payment');
      return;
    }
    setSubmitting(true);
    try {
      await requestDeposit(parseFloat(amount), reference.trim(), note);
      setStep(1);
      setAmount('');
      setReference('');
      setNote('');
      onSubmitted('Deposit request submitted. An admin will verify your payment shortly.');
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const stepTitles = {
    1: 'Deposit Amount',
    2: 'Deposit Instructions',
    3: 'Complete Order',
  };

  return (
    <DepositModal title={stepTitles[step]} onClose={onClose}>
      {step === 1 && (
        <DepositAmountStep
          amount={amount}
          setAmount={setAmount}
          method={method}
          setMethod={setMethod}
          onContinue={() => setStep(2)}
        />
      )}
      {step === 2 && agent && (
        <DepositInstructionsStep
          amount={amount}
          method={method}
          agent={agent}
          onCompleted={() => setStep(3)}
        />
      )}
      {step === 3 && (
        <CompleteOrderStep
          amount={amount}
          reference={reference}
          setReference={setReference}
          note={note}
          setNote={setNote}
          error={error}
          submitting={submitting}
          onSubmit={handleSubmit}
          onCancel={() => setStep(2)}
        />
      )}
    </DepositModal>
  );
}

function WithdrawForm({ onSubmitted }) {
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const numericAmount = parseFloat(amount);
    if (!numericAmount || numericAmount <= 0) {
      setError('Enter a valid amount');
      return;
    }
    if (numericAmount < MIN_WITHDRAW) {
      setError(`Minimum withdrawal is ${MIN_WITHDRAW} ETB`);
      return;
    }
    if (!phone.trim()) {
      setError('Enter the Telebirr phone number to receive your withdrawal');
      return;
    }

    setSubmitting(true);
    try {
      await requestWithdraw(numericAmount, phone.trim(), note);
      setAmount('');
      setPhone('');
      setNote('');
      onSubmitted('Withdrawal request submitted. An admin will send the funds shortly.');
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="amount-field">
        <span className="amount-field-currency">ETB</span>
        <input
          className="amount-field-input"
          type="number"
          step="0.01"
          min={MIN_WITHDRAW}
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <p className="field-hint">Minimum withdrawal is {MIN_WITHDRAW} ETB</p>

      <label className="field-label">Telebirr Phone Number</label>
      <input
        className="input"
        type="text"
        placeholder="Phone number to receive funds"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />

      <label className="field-label">Note (optional)</label>
      <input
        className="input"
        type="text"
        placeholder="Add a note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      {error && <div className="error-text">{error}</div>}
      <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: '100%' }}>
        {submitting ? 'Submitting...' : 'Withdraw Request'}
      </button>
    </form>
  );
}

export default function Wallet() {
  const { user, updateBalance } = useAuth();
  const [tab, setTab] = useState('deposit');
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [message, setMessage] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loadingTx, setLoadingTx] = useState(true);

  const [displayBalance, setDisplayBalance] = useState(user?.balance ?? 0);
  const [balanceUpdating, setBalanceUpdating] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const balanceRef = useRef(displayBalance);

  const refreshBalance = useCallback(async () => {
    try {
      const res = await getBalance();
      const fresh = res.data.balance;
      if (fresh !== balanceRef.current) {
        setBalanceUpdating(true);
        setDisplayBalance(fresh);
        balanceRef.current = fresh;
        updateBalance(fresh);
        setTimeout(() => setBalanceUpdating(false), 350);
      }
    } catch {
      // Non-fatal - keep showing the last known value.
    }
  }, [updateBalance]);

  const handleManualRefresh = useCallback(async () => {
    if (manualRefreshing) return;
    setManualRefreshing(true);
    await refreshBalance();
    // Keep the spin visible briefly even on very fast responses, so the
    // action reads as having actually happened.
    setTimeout(() => setManualRefreshing(false), 500);
  }, [manualRefreshing, refreshBalance]);

  const loadTransactions = useCallback(async () => {
    setLoadingTx(true);
    try {
      const res = await getMyTransactions();
      setTransactions(res.data.transactions);
    } catch {
      // Non-fatal.
    } finally {
      setLoadingTx(false);
    }
  }, []);

  useEffect(() => {
    refreshBalance();
    loadTransactions();
    const interval = setInterval(refreshBalance, 10000);
    return () => clearInterval(interval);
  }, [refreshBalance, loadTransactions]);

  const handleSubmitted = (successMessage) => {
    setMessage(successMessage);
    loadTransactions();
    refreshBalance();
  };

  const switchTab = (next) => {
    if (next === 'deposit') {
      setDepositModalOpen(true);
      return;
    }
    setTab(next);
    setMessage(null);
  };

  const pendingCount = transactions.filter((t) => t.status === 'pending').length;

  // Never assume a bonus - only show what the backend actually reports.
  // If bonus_balance is missing or zero, this is 0, not a hardcoded
  // fallback figure - showing fake numbers when a field is momentarily
  // missing from the user object is exactly the bug that shipped before.
  const bonusBalance = user?.bonus_balance ?? 0;
  const wageringTarget = user?.wagering_target_total ?? 0;
  const wageringRemaining = user?.wagering_required ?? 0;
  // Progress is derived (total - remaining), never a separately-invented
  // number - there is no "wagering_progress" field anywhere in the
  // backend, so reading one directly always silently returned 0.
  const wageringProgress = Math.max(wageringTarget - wageringRemaining, 0);
  const wageringPercent = wageringTarget > 0 ? Math.min((wageringProgress / wageringTarget) * 100, 100) : 100;
  const wageringComplete = wageringRemaining <= 0;

  return (
    <div className="card wallet-card">
      <div className="wallet-scroll-header">
        <h3 className="wallet-title">My Wallet</h3>

        <div className="balance-panel">
          <div className="balance-panel-header">
            <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
              <rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
              <path d="M3 10h18" stroke="currentColor" strokeWidth="1.6" />
              <path d="M15 14h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <span>Total Balance</span>
            <button
              type="button"
              className={`balance-refresh-btn ${manualRefreshing ? 'spinning' : ''}`}
              onClick={handleManualRefresh}
              aria-label="Refresh balance"
              disabled={manualRefreshing}
            >
              <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
                <path
                  d="M20 11A8 8 0 1 0 18.5 16"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <path d="M20 5v6h-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <div className={`balance-panel-value ${balanceUpdating ? 'balance-pulse' : ''}`}>
            <span className="balance-currency">ETB</span>
            {Number(displayBalance || 0).toFixed(2)}
          </div>
          <div className="balance-sub-grid">
            <div className="balance-sub-card">
              <span className="balance-sub-label balance-sub-label-safe">
                <svg viewBox="0 0 24 24" fill="none" width="13" height="13">
                  <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                </svg>
                WITHDRAWABLE
              </span>
              <span className="balance-sub-value balance-sub-value-safe">
                ETB {Number(displayBalance || 0).toFixed(2)}
              </span>
            </div>
            <div className="balance-sub-card">
              <span className="balance-sub-label balance-sub-label-locked">BONUS/LOCKED</span>
              <span className="balance-sub-value balance-sub-value-locked">
                ETB {Number(bonusBalance || 0).toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        <div className="wallet-tabs">
          <button
            type="button"
            className={`wallet-tab ${tab === 'deposit' ? 'active' : ''}`}
            onClick={() => switchTab('deposit')}
          >
            ↙ Deposit
          </button>
          <button
            type="button"
            className={`wallet-tab ${tab === 'withdraw' ? 'active' : ''}`}
            onClick={() => switchTab('withdraw')}
          >
            ↗ Withdraw
          </button>
        </div>
      </div>

      <div className="wallet-scroll-body">
        {message && <div className="success-text" style={{ marginTop: 12 }}>{message}</div>}

        {!wageringComplete && (
          <div className="bonus-banner">
            <span className="bonus-banner-icon">
              <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
                <rect x="3" y="8" width="18" height="4" rx="1" stroke="currentColor" strokeWidth="1.6" />
                <rect x="4" y="12" width="16" height="9" rx="1" stroke="currentColor" strokeWidth="1.6" />
                <path d="M12 8v13" stroke="currentColor" strokeWidth="1.6" />
                <path d="M12 8c-1.2-2.6-2.8-4-4.2-4A2.2 2.2 0 0 0 5.6 6.2c0 1 .8 1.8 2 1.8H12Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                <path d="M12 8c1.2-2.6 2.8-4 4.2-4a2.2 2.2 0 0 1 2.2 2.2c0 1-.8 1.8-2 1.8H12Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="bonus-banner-text">
              You received a <strong>{Number(bonusBalance || 0).toFixed(0)} ETB</strong> registration bonus. Wager{' '}
              <strong>{WAGERING_MULTIPLIER}x</strong> the bonus (ETB {wageringTarget.toFixed(0)}) to unlock it for withdrawal.
            </span>
          </div>
        )}

        {tab === 'withdraw' && !wageringComplete && (
          <div className="wagering-block">
            <div className="wagering-block-header">
              <span className="wagering-block-title">WAGERING PROGRESS</span>
              <span className="wagering-block-fraction">
                ETB {wageringProgress.toFixed(0)} / {wageringTarget.toFixed(0)}
              </span>
            </div>
            <div className="wagering-progress-track">
              <div className="wagering-progress-fill" style={{ width: `${wageringPercent}%` }} />
            </div>
            <p className="wagering-block-hint">
              ETB {wageringRemaining.toFixed(0)} more in wagering needed before your bonus balance becomes withdrawable.
            </p>
          </div>
        )}

        <div className="wallet-panel-body">
          <WithdrawForm onSubmitted={handleSubmitted} />
        </div>

        <div className="wallet-history-header">
          <h4 className="wallet-history-title">History</h4>
          {pendingCount > 0 && <span className="chip chip-pending">{pendingCount} PENDING</span>}
        </div>

        {loadingTx ? (
          <p className="field-hint">Loading...</p>
        ) : transactions.length === 0 ? (
          <p className="field-hint">No transactions yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Reference</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id}>
                    <td style={{ textTransform: 'capitalize' }}>{t.type}</td>
                    <td>{t.amount.toFixed(2)} ETB</td>
                    <td>
                      <span className={`badge badge-${t.status}`}>{t.status}</span>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {t.type === 'deposit' && t.telebirr_reference_submitted && (
                        <div>Ref: {t.telebirr_reference_submitted}</div>
                      )}
                      {t.type === 'withdraw' && t.telebirr_phone && <div>To: {t.telebirr_phone}</div>}
                      {t.telebirr_reference_admin && <div style={{ color: '#9aa0b4' }}>Sent ref: {t.telebirr_reference_admin}</div>}
                    </td>
                    <td>{new Date(t.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {depositModalOpen && (
        <DepositWizard onSubmitted={handleSubmitted} onClose={() => setDepositModalOpen(false)} />
      )}
    </div>
  );
}
