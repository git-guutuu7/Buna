import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar.jsx';
import {
  getAllUsers,
  setUserActive,
  adjustUserBalance,
  getPendingTransactions,
  getAllTransactions,
  approveTransaction,
  rejectTransaction,
  getStatsOverview,
  getStatsUsers,
  setGameLogo,
  getGameLogo,
  getAdminSettings,
  setSignupBonus,
  setBingoFee,
  sendBroadcast,
  getBroadcastHistory,
  uploadBroadcastImage,
  createCoupon,
  getCoupons,
  setCouponActive,
} from '../api.js';

function useAsyncList(fetcher, deps) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetcher();
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load data');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, reload };
}

const STAT_ICONS = {
  users: (
    <svg viewBox="0 0 24 24" fill="none" width="17" height="17">
      <circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.5 19a5.6 5.6 0 0 1 11 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M15.5 5.3a3.2 3.2 0 0 1 0 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M15 12.6c2.4.5 4 1.9 4.5 3.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  deposit: (
    <svg viewBox="0 0 24 24" fill="none" width="17" height="17">
      <path d="M12 4v13M6 11l6 6 6-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  withdraw: (
    <svg viewBox="0 0 24 24" fill="none" width="17" height="17">
      <path d="M12 20V7M6 13l6-6 6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  winnings: (
    <svg viewBox="0 0 24 24" fill="none" width="17" height="17">
      <path d="M8 6h8l-1 5a3 3 0 0 1-6 0L8 6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M12 14v3M9 20h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  result: (
    <svg viewBox="0 0 24 24" fill="none" width="17" height="17">
      <path d="M4 17l5-5 3 3 7-8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 7h4v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  online: (
    <svg viewBox="0 0 24 24" fill="none" width="17" height="17">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </svg>
  ),
  bingo: (
    <svg viewBox="0 0 24 24" fill="none" width="17" height="17">
      <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4 10h16M10 4v16" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="7" cy="7" r="1.1" fill="currentColor" />
      <circle cx="15" cy="15" r="1.1" fill="currentColor" />
    </svg>
  ),
};

function StatCard({ label, value, tone = 'neutral', icon }) {
  return (
    <div className={`admin-stat-card tone-${tone}`}>
      <span className="admin-stat-icon">{STAT_ICONS[icon]}</span>
      <div className="admin-stat-body">
        <div className="admin-stat-label">{label}</div>
        <div className="admin-stat-value">{value}</div>
      </div>
    </div>
  );
}

function OverviewTab() {
  const { data, loading, error, reload } = useAsyncList(() => getStatsOverview(), []);
  const [logoUrl, setLogoUrl] = useState('');
  const [currentLogo, setCurrentLogo] = useState(null);
  const [logoSaving, setLogoSaving] = useState(false);
  const [logoMessage, setLogoMessage] = useState(null);

  const [settingsLoading, setSettingsLoading] = useState(true);
  const [signupBonusInput, setSignupBonusInput] = useState('');
  const [signupBonusSaving, setSignupBonusSaving] = useState(false);
  const [signupBonusMessage, setSignupBonusMessage] = useState(null);

  const [bingoStakeInput, setBingoStakeInput] = useState('');
  const [bingoFeeInput, setBingoFeeInput] = useState('');
  const [bingoFeeSaving, setBingoFeeSaving] = useState(false);
  const [bingoFeeMessage, setBingoFeeMessage] = useState(null);

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const res = await getAdminSettings();
      setSignupBonusInput(String(res.data.signup_bonus_birr));
      setBingoStakeInput(String(res.data.bingo_stake_birr));
      setBingoFeeInput(String(res.data.bingo_platform_fee_birr));
    } catch {
      // Non-fatal - fields just stay empty and the admin can still type
      // fresh values in.
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    getGameLogo()
      .then((res) => setCurrentLogo(res.data.url))
      .catch(() => {});
    loadSettings();
  }, [loadSettings]);

  const handleSaveLogo = async (e) => {
    e.preventDefault();
    setLogoMessage(null);
    if (!logoUrl.trim()) return;
    setLogoSaving(true);
    try {
      await setGameLogo(logoUrl.trim());
      setCurrentLogo(logoUrl.trim());
      setLogoUrl('');
      setLogoMessage('Game logo updated.');
    } catch (err) {
      setLogoMessage(err.response?.data?.error || 'Could not update logo');
    } finally {
      setLogoSaving(false);
    }
  };

  const handleSaveSignupBonus = async (e) => {
    e.preventDefault();
    setSignupBonusMessage(null);
    const amount = parseFloat(signupBonusInput);
    if (isNaN(amount) || amount < 0) {
      setSignupBonusMessage('Enter 0 or a positive number');
      return;
    }
    setSignupBonusSaving(true);
    try {
      await setSignupBonus(amount);
      setSignupBonusMessage(
        amount === 0
          ? 'Signup bonus disabled. New signups will not receive a bonus.'
          : `Signup bonus set to ${amount} ETB. Applies to new signups from now on.`
      );
    } catch (err) {
      setSignupBonusMessage(err.response?.data?.error || 'Could not update signup bonus');
    } finally {
      setSignupBonusSaving(false);
    }
  };

  const handleSaveBingoFee = async (e) => {
    e.preventDefault();
    setBingoFeeMessage(null);
    const stake = parseFloat(bingoStakeInput);
    const fee = parseFloat(bingoFeeInput);
    if (isNaN(stake) || stake <= 0) {
      setBingoFeeMessage('Enter a positive stake amount');
      return;
    }
    if (isNaN(fee) || fee < 0) {
      setBingoFeeMessage('Enter 0 or a positive platform fee');
      return;
    }
    if (fee >= stake) {
      setBingoFeeMessage('Platform fee must be less than the stake amount');
      return;
    }
    setBingoFeeSaving(true);
    try {
      await setBingoFee(stake, fee);
      setBingoFeeMessage('Bingo pricing updated. Takes effect starting with the next round.');
    } catch (err) {
      setBingoFeeMessage(err.response?.data?.error || 'Could not update bingo pricing');
    } finally {
      setBingoFeeSaving(false);
    }
  };

  if (loading) return <p className="admin-muted-text">Loading overview...</p>;
  if (error) return <div className="error-text">{error}</div>;

  const platformResult = data.platformResult ?? 0;

  return (
    <div>
      <div className="admin-stats-grid">
        <StatCard label="Total Users" value={data.totalUsers ?? 0} tone="neutral" icon="users" />
        <StatCard
          label="Total Deposited"
          value={`${(data.totalDeposited ?? 0).toFixed(2)} ETB`}
          tone="positive"
          icon="deposit"
        />
        <StatCard
          label="Total Withdrawn"
          value={`${(data.totalWithdrawn ?? 0).toFixed(2)} ETB`}
          tone="negative"
          icon="withdraw"
        />
        <StatCard
          label="Total User Winnings"
          value={`${(data.totalUserWinnings ?? 0).toFixed(2)} ETB`}
          tone="warning"
          icon="winnings"
        />
        <StatCard
          label="Platform Result"
          value={`${platformResult >= 0 ? '+' : ''}${platformResult.toFixed(2)} ETB`}
          tone={platformResult >= 0 ? 'positive' : 'negative'}
          icon="result"
        />
        <StatCard label="Online Now" value={data.onlineUsers ?? 0} tone="neutral" icon="online" />
        <StatCard
          label="Bingo Platform Earnings"
          value={`${(data.bingoPlatformEarnings ?? 0).toFixed(2)} ETB`}
          tone="positive"
          icon="bingo"
        />
      </div>
      <button className="btn btn-outline admin-refresh-btn" onClick={reload}>
        Refresh
      </button>

      <div className="admin-section-card">
        <h4 className="admin-section-title">Game Logo</h4>
        <p className="admin-muted-text">
          Set the image URL shown as the Buna Games logo. Upload your image to any image host
          first, then paste the resulting URL here.
        </p>
        {currentLogo && (
          <div className="admin-logo-preview">
            <img src={currentLogo} alt="Current game logo" />
          </div>
        )}
        <form onSubmit={handleSaveLogo} className="admin-inline-form">
          <input
            className="input"
            type="url"
            placeholder="https://example.com/logo.png"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            style={{ flex: 1, minWidth: 200, marginBottom: 0 }}
          />
          <button className="btn btn-primary" type="submit" disabled={logoSaving}>
            {logoSaving ? 'Saving...' : 'Save Logo'}
          </button>
        </form>
        {logoMessage && <p className="admin-muted-text" style={{ marginTop: 8 }}>{logoMessage}</p>}
      </div>

      <div className="admin-section-card">
        <h4 className="admin-section-title">Signup Bonus</h4>
        <p className="admin-muted-text">
          ETB amount granted to every new user on signup, locked until they wager 100x that amount.
          Set to 0 to disable the signup bonus entirely. Changes apply to new signups only -
          existing users keep whatever bonus they already received.
        </p>
        {settingsLoading ? (
          <p className="admin-muted-text">Loading...</p>
        ) : (
          <form onSubmit={handleSaveSignupBonus} className="admin-inline-form">
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              placeholder="10"
              value={signupBonusInput}
              onChange={(e) => setSignupBonusInput(e.target.value)}
              style={{ flex: 1, minWidth: 120, marginBottom: 0 }}
            />
            <button className="btn btn-primary" type="submit" disabled={signupBonusSaving}>
              {signupBonusSaving ? 'Saving...' : 'Save'}
            </button>
          </form>
        )}
        {signupBonusMessage && <p className="admin-muted-text" style={{ marginTop: 8 }}>{signupBonusMessage}</p>}
      </div>

      <div className="admin-section-card">
        <h4 className="admin-section-title">Bingo Pricing</h4>
        <p className="admin-muted-text">
          Stake per cartela and the platform's cut of it. Changes take effect starting with the
          next round that opens - a round already in progress keeps the pricing it started with.
        </p>
        {settingsLoading ? (
          <p className="admin-muted-text">Loading...</p>
        ) : (
          <form onSubmit={handleSaveBingoFee} className="admin-inline-form" style={{ flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label className="field-label" style={{ margin: 0 }}>Stake (ETB)</label>
              <input
                className="input"
                type="number"
                min="1"
                step="0.01"
                placeholder="10"
                value={bingoStakeInput}
                onChange={(e) => setBingoStakeInput(e.target.value)}
                style={{ width: 110, marginBottom: 0 }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label className="field-label" style={{ margin: 0 }}>Platform Fee (ETB)</label>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                placeholder="2"
                value={bingoFeeInput}
                onChange={(e) => setBingoFeeInput(e.target.value)}
                style={{ width: 110, marginBottom: 0 }}
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={bingoFeeSaving} style={{ alignSelf: 'flex-end' }}>
              {bingoFeeSaving ? 'Saving...' : 'Save'}
            </button>
          </form>
        )}
        {bingoFeeMessage && <p className="admin-muted-text" style={{ marginTop: 8 }}>{bingoFeeMessage}</p>}
      </div>
    </div>
  );
}

function BalanceEditForm({ user, onDone, onCancel }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const numericAmount = parseFloat(amount);
    if (!numericAmount || numericAmount === 0) {
      setError('Enter a non-zero amount (negative to deduct)');
      return;
    }
    if (!reason.trim()) {
      setError('A reason is required');
      return;
    }
    setSaving(true);
    try {
      await adjustUserBalance(user.id, numericAmount, reason.trim());
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update balance');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <input
        className="input"
        type="number"
        step="0.01"
        placeholder="+50 or -50"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        style={{ width: 110, marginBottom: 0 }}
        autoFocus
      />
      <input
        className="input"
        type="text"
        placeholder="Reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        style={{ width: 160, marginBottom: 0 }}
      />
      <button className="btn btn-success" type="submit" disabled={saving}>
        {saving ? 'Saving...' : 'Save'}
      </button>
      <button className="btn btn-outline" type="button" onClick={onCancel} disabled={saving}>
        Cancel
      </button>
      {error && <div className="error-text" style={{ width: '100%' }}>{error}</div>}
    </form>
  );
}

function UsersTab() {
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const { data, loading, error, reload } = useAsyncList(() => getStatsUsers(1, search), [search]);
  const [editingId, setEditingId] = useState(null);

  const toggleActive = async (user) => {
    try {
      await setUserActive(user.id, !user.isActive);
      reload();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update user');
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setSearch(searchInput.trim());
  };

  if (loading) return <p className="admin-muted-text">Loading users...</p>;
  if (error) return <div className="error-text">{error}</div>;

  return (
    <div>
      <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input
          className="input"
          type="text"
          placeholder="Search by username or name"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{ flex: 1, minWidth: 200, marginBottom: 0 }}
        />
        <button className="btn btn-primary" type="submit">
          Search
        </button>
        {search && (
          <button
            className="btn btn-outline"
            type="button"
            onClick={() => {
              setSearchInput('');
              setSearch('');
            }}
          >
            Clear
          </button>
        )}
      </form>

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Name</th>
              <th>Balance</th>
              <th>Total Won</th>
              <th>Status</th>
              <th>Joined</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(data.users || []).length === 0 ? (
              <tr>
                <td colSpan={7} className="admin-muted-text" style={{ textAlign: 'center' }}>
                  No users found.
                </td>
              </tr>
            ) : (
              data.users.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{u.telegram_first_name || '—'}</td>
                  <td>{u.balance.toFixed(2)} ETB</td>
                  <td style={{ color: '#4ade80' }}>{u.totalWon.toFixed(2)} ETB</td>
                  <td>
                    <span className={`badge ${u.isActive ? 'badge-approved' : 'badge-rejected'}`}>
                      {u.isActive ? 'active' : 'banned'}
                    </span>
                  </td>
                  <td>{new Date(u.created_at).toLocaleDateString()}</td>
                  <td style={{ minWidth: editingId === u.id ? 320 : undefined }}>
                    {editingId === u.id ? (
                      <BalanceEditForm
                        user={u}
                        onDone={() => {
                          setEditingId(null);
                          reload();
                        }}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-outline" onClick={() => toggleActive(u)}>
                          {u.isActive ? 'Ban' : 'Unban'}
                        </button>
                        <button className="btn btn-outline" onClick={() => setEditingId(u.id)}>
                          Edit Balance
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PendingTab() {
  const { data, loading, error, reload } = useAsyncList(() => getPendingTransactions(), []);
  const [busyId, setBusyId] = useState(null);

  const handleApprove = async (tx) => {
    const isDeposit = tx.type === 'deposit';
    const promptText = isDeposit
      ? `Confirm the Telebirr reference you verified in the business account for this deposit:\n(User submitted: ${tx.telebirr_reference_submitted || 'none'})`
      : `Enter the Telebirr reference for the transfer you just sent to ${tx.telebirr_phone || 'the user'}:`;

    const reference = window.prompt(promptText, isDeposit ? tx.telebirr_reference_submitted || '' : '');
    if (reference === null) return;
    if (!reference.trim()) {
      alert('A Telebirr reference is required to approve this transaction.');
      return;
    }

    setBusyId(tx.id);
    try {
      await approveTransaction(tx.id, reference.trim());
      reload();
    } catch (err) {
      alert(err.response?.data?.error || 'Approval failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (id) => {
    const reason = window.prompt('Reason for rejection (optional):') || '';
    setBusyId(id);
    try {
      await rejectTransaction(id, reason);
      reload();
    } catch (err) {
      alert(err.response?.data?.error || 'Rejection failed');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <p className="admin-muted-text">Loading pending requests...</p>;
  if (error) return <div className="error-text">{error}</div>;

  const items = data.transactions || [];

  if (items.length === 0) return <p className="admin-muted-text">No pending requests.</p>;

  return (
    <div style={{ overflowX: 'auto' }}>
      <div className="admin-notice">
        Deposits: verify the Telebirr reference against the real Telebirr business account before
        approving. Withdrawals: send the money via Telebirr <strong>first</strong>, then approve using
        the reference from that transfer as proof.
      </div>
      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Type</th>
            <th>Amount</th>
            <th>Telebirr</th>
            <th>Note</th>
            <th>Requested</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id}>
              <td>{t.user ? `${t.user.username} (${t.user.email})` : 'Unknown'}</td>
              <td style={{ textTransform: 'capitalize' }}>{t.type}</td>
              <td>{t.amount.toFixed(2)} ETB</td>
              <td style={{ fontSize: 13 }}>
                {t.type === 'deposit'
                  ? `Ref: ${t.telebirr_reference_submitted || '—'}`
                  : `To: ${t.telebirr_phone || '—'}`}
              </td>
              <td>{t.note || '—'}</td>
              <td>{new Date(t.created_at).toLocaleString()}</td>
              <td style={{ display: 'flex', gap: 6 }}>
                <button
                  className="btn btn-success"
                  disabled={busyId === t.id}
                  onClick={() => handleApprove(t)}
                >
                  Approve
                </button>
                <button
                  className="btn btn-danger"
                  disabled={busyId === t.id}
                  onClick={() => handleReject(t.id)}
                >
                  Reject
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryTab() {
  const { data, loading, error } = useAsyncList(() => getAllTransactions(), []);

  if (loading) return <p className="admin-muted-text">Loading history...</p>;
  if (error) return <div className="error-text">{error}</div>;

  const items = data.transactions || [];

  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Type</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Telebirr ref (sent/verified)</th>
            <th>Handled by</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id}>
              <td>{t.user ? t.user.username : 'Unknown'}</td>
              <td style={{ textTransform: 'capitalize' }}>{t.type}</td>
              <td>{t.amount.toFixed(2)} ETB</td>
              <td>
                <span className={`badge badge-${t.status}`}>{t.status}</span>
              </td>
              <td style={{ fontSize: 12 }}>{t.telebirr_reference_admin || '—'}</td>
              <td>{t.approved_by || '—'}</td>
              <td>{new Date(t.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BroadcastTab() {
  const { data, loading, error, reload } = useAsyncList(() => getBroadcastHistory(), []);
  const [message, setMessage] = useState('');
  const [buttonText, setButtonText] = useState('Play Buna Games');
  const [buttonUrl, setButtonUrl] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleImageSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setResult({ error: 'Image must be under 5MB' });
      return;
    }

    setImageFile(file);
    setUploadedImageUrl(null);
    setResult(null);
    setImagePreview(URL.createObjectURL(file));
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setUploadedImageUrl(null);
  };

  const handleSend = async () => {
    setResult(null);
    if (!message.trim()) {
      setResult({ error: 'Enter a message to send' });
      return;
    }

    setSending(true);
    try {
      let imageUrl = uploadedImageUrl;

      if (imageFile && !imageUrl) {
        setUploading(true);
        const uploadRes = await uploadBroadcastImage(imageFile);
        imageUrl = uploadRes.data.url;
        setUploadedImageUrl(imageUrl);
        setUploading(false);
      }

      const res = await sendBroadcast(message.trim(), buttonText.trim() || null, buttonUrl.trim() || null, imageUrl);
      setResult({
        success: `Broadcast started - sending to ${res.data.totalRecipients} users. Check history below shortly for results.`,
      });
      setMessage('');
      removeImage();
      setConfirmOpen(false);
      setTimeout(reload, 3000);
    } catch (err) {
      setResult({ error: err.response?.data?.error || 'Failed to send broadcast' });
      setUploading(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <div className="admin-section-card" style={{ marginBottom: 16 }}>
        <h4 className="admin-section-title">Compose Broadcast</h4>
        <p className="admin-muted-text">
          This sends a message to every active user who has started the bot. This cannot be
          undone once sent - double-check before confirming.
        </p>

        <textarea
          className="input"
          rows={4}
          placeholder={imagePreview ? 'Caption for the image...' : 'Message text...'}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
        />

        <div style={{ marginBottom: 12 }}>
          {imagePreview ? (
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <img
                src={imagePreview}
                alt="Broadcast preview"
                style={{ maxHeight: 160, borderRadius: 8, display: 'block' }}
              />
              <button
                type="button"
                onClick={removeImage}
                className="btn btn-danger"
                style={{ position: 'absolute', top: 6, right: 6, padding: '2px 8px', fontSize: 12 }}
              >
                Remove
              </button>
            </div>
          ) : (
            <label className="btn btn-outline" style={{ display: 'inline-block', cursor: 'pointer' }}>
              Attach Image (optional)
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleImageSelect}
                style={{ display: 'none' }}
              />
            </label>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input"
            type="text"
            placeholder="Button text (optional)"
            value={buttonText}
            onChange={(e) => setButtonText(e.target.value)}
            style={{ flex: 1, minWidth: 150 }}
          />
          <input
            className="input"
            type="url"
            placeholder="Button link / Mini App URL (optional)"
            value={buttonUrl}
            onChange={(e) => setButtonUrl(e.target.value)}
            style={{ flex: 2, minWidth: 200 }}
          />
        </div>

        {result?.error && <div className="error-text">{result.error}</div>}
        {result?.success && <div className="success-text">{result.success}</div>}

        {!confirmOpen ? (
          <button
            className="btn btn-primary"
            onClick={() => setConfirmOpen(true)}
            disabled={!message.trim()}
            style={{ width: '100%' }}
          >
            Review & Send
          </button>
        ) : (
          <div className="admin-confirm-box">
            <p className="admin-confirm-text">
              Send this {imagePreview ? 'image + message' : 'message'} to ALL active users now? This can't be undone.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-success" onClick={handleSend} disabled={sending} style={{ flex: 1 }}>
                {uploading ? 'Uploading image...' : sending ? 'Sending...' : 'Confirm & Send'}
              </button>
              <button className="btn btn-outline" onClick={() => setConfirmOpen(false)} disabled={sending} style={{ flex: 1 }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <h4 className="admin-section-title" style={{ marginTop: 24 }}>Recent Broadcasts</h4>
      {loading ? (
        <p className="admin-muted-text">Loading...</p>
      ) : error ? (
        <div className="error-text">{error}</div>
      ) : (data.broadcasts || []).length === 0 ? (
        <p className="admin-muted-text">No broadcasts sent yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Message</th>
                <th>Recipients</th>
                <th>Sent / Failed</th>
                <th>By</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {data.broadcasts.map((b) => (
                <tr key={b.id}>
                  <td>
                    {b.imageUrl && (
                      <img src={b.imageUrl} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4 }} />
                    )}
                  </td>
                  <td style={{ maxWidth: 240, whiteSpace: 'normal' }}>{b.message}</td>
                  <td>{b.totalRecipients}</td>
                  <td>
                    <span style={{ color: '#4ade80' }}>{b.successfulSends}</span>
                    {' / '}
                    <span style={{ color: b.failedSends > 0 ? '#f87171' : '#7a7a85' }}>{b.failedSends}</span>
                  </td>
                  <td>{b.sentBy || '—'}</td>
                  <td>{new Date(b.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CreateCouponForm({ onCreated }) {
  const [code, setCode] = useState('');
  const [type, setType] = useState('free');
  const [amount, setAmount] = useState('');
  const [maxClaims, setMaxClaims] = useState('');
  const [depositWindow, setDepositWindow] = useState('week');
  const [minDeposit, setMinDeposit] = useState('');
  const [requireFirstDeposit, setRequireFirstDeposit] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!code.trim()) return setError('Enter a code');
    if (!amount || Number(amount) <= 0) return setError('Enter a valid amount');
    if (!maxClaims || Number(maxClaims) <= 0) return setError('Enter a valid number of claims');
    if (type === 'deposit_gated' && (!minDeposit || Number(minDeposit) <= 0)) {
      return setError('Enter a minimum deposit for a deposit-gated coupon');
    }

    setSaving(true);
    try {
      await createCoupon({
        code: code.trim(),
        type,
        amount: Number(amount),
        maxClaims: Number(maxClaims),
        depositWindow: type === 'deposit_gated' ? depositWindow : undefined,
        minDeposit: type === 'deposit_gated' ? Number(minDeposit) : undefined,
        requireFirstDeposit: type === 'deposit_gated' ? requireFirstDeposit : undefined,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
      setCode('');
      setAmount('');
      setMaxClaims('');
      setMinDeposit('');
      setExpiresAt('');
      setRequireFirstDeposit(false);
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create coupon');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="admin-section-card">
      <h4 className="admin-section-title">Create Coupon</h4>

      <div className="admin-form-row">
        <div>
          <label className="field-label">Code</label>
          <input
            className="input"
            type="text"
            placeholder="e.g. WELCOME50"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            style={{ textTransform: 'uppercase' }}
          />
        </div>
        <div>
          <label className="field-label">Amount (ETB)</label>
          <input
            className="input"
            type="number"
            step="0.01"
            placeholder="50"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label">Max Claims</label>
          <input
            className="input"
            type="number"
            placeholder="100"
            value={maxClaims}
            onChange={(e) => setMaxClaims(e.target.value)}
          />
        </div>
      </div>

      <label className="field-label">Type</label>
      <div className="admin-type-toggle">
        <button
          type="button"
          className={`admin-type-btn ${type === 'free' ? 'active' : ''}`}
          onClick={() => setType('free')}
        >
          Free (anyone can claim)
        </button>
        <button
          type="button"
          className={`admin-type-btn ${type === 'deposit_gated' ? 'active' : ''}`}
          onClick={() => setType('deposit_gated')}
        >
          Deposit-gated
        </button>
      </div>

      {type === 'deposit_gated' && (
        <div className="admin-form-row" style={{ marginTop: 10 }}>
          <div>
            <label className="field-label">Deposit Window</label>
            <select className="input" value={depositWindow} onChange={(e) => setDepositWindow(e.target.value)}>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="year">This Year</option>
            </select>
          </div>
          <div>
            <label className="field-label">Min Deposit (ETB)</label>
            <input
              className="input"
              type="number"
              step="0.01"
              placeholder="100"
              value={minDeposit}
              onChange={(e) => setMinDeposit(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#cbbda6' }}>
              <input
                type="checkbox"
                checked={requireFirstDeposit}
                onChange={(e) => setRequireFirstDeposit(e.target.checked)}
              />
              First deposit only
            </label>
          </div>
        </div>
      )}

      <label className="field-label">Expires At (optional)</label>
      <input
        className="input"
        type="datetime-local"
        value={expiresAt}
        onChange={(e) => setExpiresAt(e.target.value)}
        style={{ maxWidth: 260 }}
      />

      {error && <div className="error-text">{error}</div>}

      <button className="btn btn-primary" type="submit" disabled={saving} style={{ marginTop: 12 }}>
        {saving ? 'Creating...' : 'Create Coupon'}
      </button>
    </form>
  );
}

function CouponsTab() {
  const { data, loading, error, reload } = useAsyncList(() => getCoupons(), []);

  const toggleActive = async (coupon) => {
    try {
      await setCouponActive(coupon.id, !coupon.active);
      reload();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update coupon');
    }
  };

  return (
    <div>
      <CreateCouponForm onCreated={reload} />

      <h4 className="admin-section-title" style={{ marginTop: 24 }}>Existing Coupons</h4>

      {loading ? (
        <p className="admin-muted-text">Loading coupons...</p>
      ) : error ? (
        <div className="error-text">{error}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Claims</th>
                <th>Conditions</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(data.coupons || []).length === 0 ? (
                <tr>
                  <td colSpan={7} className="admin-muted-text" style={{ textAlign: 'center' }}>
                    No coupons yet.
                  </td>
                </tr>
              ) : (
                data.coupons.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 700 }}>{c.code}</td>
                    <td>{c.type === 'free' ? 'Free' : 'Deposit-gated'}</td>
                    <td>{c.amount.toFixed(2)} ETB</td>
                    <td>
                      {c.claimsUsed} / {c.maxClaims}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {c.type === 'deposit_gated' ? (
                        <>
                          Min {c.minDeposit?.toFixed(2)} ETB, {c.depositWindow}
                          {c.requireFirstDeposit ? ' (first deposit only)' : ''}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <span className={`badge ${c.active ? 'badge-approved' : 'badge-rejected'}`}>
                        {c.active ? 'active' : 'paused'}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-outline" onClick={() => toggleActive(c)}>
                        {c.active ? 'Pause' : 'Release'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const ADMIN_TABS = [
  {
    id: 'overview',
    label: 'Overview',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
        <path d="M4 19V10M10 19V5M16 19v-7M22 19H2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'pending',
    label: 'Pending Requests',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'users',
    label: 'Users',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
        <circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M3.5 19a5.6 5.6 0 0 1 11 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M15.5 5.3a3.2 3.2 0 0 1 0 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M15 12.6c2.4.5 4 1.9 4.5 3.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'history',
    label: 'Transaction History',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
        <rect x="3" y="5" width="18" height="15" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'broadcast',
    label: 'Broadcast',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
        <path d="M4 10v4a1 1 0 0 0 1 1h2l5 4V5L7 9H5a1 1 0 0 0-1 1Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M17 9.5a3.5 3.5 0 0 1 0 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M19.5 7a7 7 0 0 1 0 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'coupons',
    label: 'Coupons',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
        <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1.5a1.5 1.5 0 0 0 0 3V15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1.5a1.5 1.5 0 0 0 0-3V9Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M10 7v10" stroke="currentColor" strokeWidth="1.8" strokeDasharray="1.6 2" strokeLinecap="round" />
      </svg>
    ),
  },
];

export default function Admin() {
  const [tab, setTab] = useState('overview');
  const navigate = useNavigate();

  return (
    <div>
      <Navbar />
      <div className="container admin-panel">
        <div className="admin-panel-topbar">
          <h2 className="admin-panel-heading">Admin Panel</h2>
          <button className="btn btn-outline admin-back-btn" onClick={() => navigate('/dashboard')}>
            <svg viewBox="0 0 24 24" fill="none" width="15" height="15">
              <path d="M14.5 5L8 12l6.5 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to User View
          </button>
        </div>

        <div className="admin-panel-card">
          <div className="admin-tabs">
            {ADMIN_TABS.map((t) => (
              <button
                type="button"
                key={t.id}
                className={`admin-tab ${tab === t.id ? 'active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                <span className="admin-tab-icon">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>

          <div className="admin-tab-panel">
            {tab === 'overview' && <OverviewTab />}
            {tab === 'pending' && <PendingTab />}
            {tab === 'users' && <UsersTab />}
            {tab === 'history' && <HistoryTab />}
            {tab === 'broadcast' && <BroadcastTab />}
            {tab === 'coupons' && <CouponsTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
