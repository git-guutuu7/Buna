const { verifyToken } = require('./auth');
const { query } = require('./database');

/* ==================================================================== */
/*  Wallet realtime balance push + live online user count                */
/*                                                                        */
/*  Every place balance/bonus_balance changes today already re-queries   */
/*  the fresh value after commit (admin approve, game.js bet/cashout,    */
/*  bingo.js stake/payout, cashback.js claim). This module lets any of   */
/*  those call pushBalanceUpdate(userId) right after their own commit to */
/*  push the new numbers straight to that user's wallet page - no        */
/*  polling wait. It does not change what any of those routes compute;   */
/*  it only adds a notification on top.                                  */
/*                                                                        */
/*  The frontend's getSocket() (api.js) already sends the user's JWT in  */
/*  the connection handshake (auth: { token }) for every socket it       */
/*  opens - this module reads that same token to identify the connecting */
/*  user and place them in a private room ("user:<id>") that only their  */
/*  own socket(s) are in, so a balance push is never broadcast to        */
/*  everyone.                                                            */
/*                                                                        */
/*  The same authenticated connections are used to track who's "online"  */
/*  - meaning currently holding at least one open, authenticated socket, */
/*  live and real-time, not a last-seen timestamp. One user can have     */
/*  multiple tabs/devices open at once, so we track distinct user IDs    */
/*  with at least one live socket, not a raw socket count - closing one  */
/*  tab doesn't mark them offline if another is still connected.         */
/* ==================================================================== */

const onlineUserSockets = new Map(); // userId -> Set<socketId>

let ioRef = null;

function attachWalletSocket(io) {
  ioRef = io;

  io.on('connection', (socket) => {
    try {
      const token = socket.handshake?.auth?.token;
      if (!token || typeof token !== 'string') return;
      const payload = verifyToken(token);
      socket.data.userId = payload.sub;
      socket.join(`user:${payload.sub}`);

      if (!onlineUserSockets.has(payload.sub)) {
        onlineUserSockets.set(payload.sub, new Set());
      }
      onlineUserSockets.get(payload.sub).add(socket.id);

      socket.on('disconnect', () => {
        const sockets = onlineUserSockets.get(payload.sub);
        if (!sockets) return;
        sockets.delete(socket.id);
        if (sockets.size === 0) onlineUserSockets.delete(payload.sub);
      });
    } catch {
      // Invalid/expired token - the socket just won't receive pushes and
      // isn't counted as online; the wallet page still has its normal
      // poll as a fallback for balance updates.
    }
  });
}

// Number of distinct users currently holding at least one live,
// authenticated socket connection right now.
function getOnlineUserCount() {
  return onlineUserSockets.size;
}

// Fetches the latest balance fields for a user and pushes them to that
// user's private room. Safe to call from anywhere after a balance-changing
// commit - if the socket server isn't attached yet or the user has no
// open socket, this is a no-op.
async function pushBalanceUpdate(userId) {
  if (!ioRef || !userId) return;
  try {
    const { rows } = await query(
      'SELECT balance, bonus_balance, wagering_required, wagering_target_total FROM users WHERE id = $1',
      [userId]
    );
    const user = rows[0];
    if (!user) return;

    ioRef.to(`user:${userId}`).emit('wallet:balance_updated', {
      balance: user.balance / 100,
      bonus_balance: (user.bonus_balance || 0) / 100,
      wagering_required: (user.wagering_required || 0) / 100,
      wagering_target_total: (user.wagering_target_total || 0) / 100,
    });
  } catch (err) {
    console.error('[wallet] Failed to push balance update', { userId, error: err.message });
  }
}

module.exports = { attachWalletSocket, pushBalanceUpdate, getOnlineUserCount };
