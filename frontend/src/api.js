import axios from 'axios';
import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

const api = axios.create({ baseURL: API_URL });

// Attach the stored JWT to every outgoing request.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// If the server says our token is invalid/expired, clear it so the app
// redirects back to the login screen instead of looping on 401s.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response && err.response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
    return Promise.reject(err);
  }
);

export function getSocket() {
  const token = localStorage.getItem('token');
  return io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket'],
  });
}

/* ---------------------------- Auth ---------------------------- */
// Telegram Mini App auth is the only login path - the frontend sends
// Telegram's signed initData (plus an optional referral code captured
// from the bot's deep-link start parameter), the backend verifies it and
// issues a JWT.
export const telegramLogin = (initData, referralCode = null) =>
  api.post('/auth/telegram', { initData, referral_code: referralCode });
export const getMe = () => api.get('/auth/me');
export const verifyChannels = () => api.get('/auth/verify-channels');
export const markBotLinkClicked = () => api.post('/auth/mark-bot-link-clicked');

/* --------------------------- Wallet ---------------------------- */
export const getBalance = () => api.get('/wallet/balance');
export const requestDeposit = (amount, telebirr_reference, note) =>
  api.post('/wallet/deposit', { amount, telebirr_reference, note });
export const requestWithdraw = (amount, telebirr_phone, note) =>
  api.post('/wallet/withdraw', { amount, telebirr_phone, note });
export const getMyTransactions = (page = 1) => api.get(`/wallet/transactions?page=${page}`);

/* --------------------------- Referral ---------------------------- */
export const getReferralStats = () => api.get('/referral/stats');

/* --------------------------- Cashback ------------------------------ */
export const getCashbackStatus = () => api.get('/cashback/status');
export const claimCashback = () => api.post('/cashback/claim');

/* --------------------------- Bingo ---------------------------------- */
export const getBingoState = () => api.get('/bingo/state');
export const getBingoCartelas = () => api.get('/bingo/cartelas');
export const stakeBingoCartelas = (cartelaNumbers) => api.post('/bingo/stake', { cartela_numbers: cartelaNumbers });
export const getBingoHistory = () => api.get('/bingo/history');

/* ---------------------------- Game ------------------------------ */
export const placeBet = (amount, slot = 1, autoCashoutAt = null) =>
  api.post('/game/bet', { amount, slot, auto_cashout_at: autoCashoutAt });
export const cashOut = (slot = 1) => api.post('/game/cashout', { slot });
export const getRoundHistory = () => api.get('/game/history');
export const getMyBets = () => api.get('/game/my-bets');
export const getAutoBetSettings = () => api.get('/game/auto-bet');
export const setAutoBetSettings = (slot, enabled, amount, autoCashoutAt) =>
  api.put(`/game/auto-bet/${slot}`, { enabled, amount, auto_cashout_at: autoCashoutAt });
export const verifyRound = (roundId) => api.get(`/game/verify/${roundId}`);

/* --------------------------- Settings (public) ------------------- */
export const getGameLogo = () => api.get('/settings/game-logo');

/* --------------------------- Admin: users ------------------------ */
export const getAllUsers = (page = 1) => api.get(`/admin/users?page=${page}`);
export const setUserActive = (id, isActive) => api.patch(`/admin/users/${id}/status`, { isActive });

/* --------------------------- Admin: transactions ------------------ */
export const getPendingTransactions = (type) =>
  api.get(`/admin/transactions/pending${type ? `?type=${type}` : ''}`);
export const getAllTransactions = (page = 1, filters = {}) => {
  const params = new URLSearchParams({ page, ...filters }).toString();
  return api.get(`/admin/transactions?${params}`);
};
export const approveTransaction = (id, telebirr_reference) =>
  api.post(`/admin/transactions/${id}/approve`, { telebirr_reference });
export const rejectTransaction = (id, reason) => api.post(`/admin/transactions/${id}/reject`, { reason });

/* --------------------------- Admin: stats & logo ------------------- */
export const getStatsOverview = () => api.get('/admin/stats/overview');
export const getStatsUsers = (page = 1, search = '') => {
  const params = new URLSearchParams({ page });
  if (search) params.set('search', search);
  return api.get(`/admin/stats/users?${params.toString()}`);
};
export const setGameLogo = (url) => api.put('/admin/settings/game-logo', { url });
export const getAdminSettings = () => api.get('/admin/settings');
export const setSignupBonus = (amount) => api.put('/admin/settings/signup-bonus', { amount });
export const setBingoFee = (stakeAmount, platformFee) =>
  api.put('/admin/settings/bingo-fee', { stake_amount: stakeAmount, platform_fee: platformFee });
export const adjustUserBalance = (id, amount, reason) =>
  api.patch(`/admin/users/${id}/balance`, { amount, reason });

/* --------------------------- Admin: broadcast ---------------------- */
export const sendBroadcast = (message, buttonText, buttonUrl, imageUrl) =>
  api.post('/admin/broadcast', {
    message,
    button_text: buttonText || null,
    button_url: buttonUrl || null,
    image_url: imageUrl || null,
  });

export const getBroadcastHistory = () => api.get('/admin/broadcast/history');

// Uploads an image file (from a file input) to the backend, which stores
// it in Supabase Storage and returns a public URL. Uses FormData/
// multipart since this is a real file, not JSON.
export const uploadBroadcastImage = (file) => {
  const formData = new FormData();
  formData.append('image', file);
  return api.post('/admin/upload-image', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

/* --------------------------- Coupons ------------------------------- */
export const redeemCoupon = (code) => api.post('/coupons/redeem', { code });

// Admin coupon management
export const createCoupon = (payload) => api.post('/coupons/admin', payload);
export const getCoupons = () => api.get('/coupons/admin');
export const setCouponActive = (id, active) => api.patch(`/coupons/admin/${id}/active`, { active });

export default api;
