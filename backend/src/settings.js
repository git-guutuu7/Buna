const express = require('express');
const { query } = require('./database');

const router = express.Router();

// GET /api/settings/game-logo - public, no auth required, so the game
// screen can display the current logo for any visitor/player.
router.get('/game-logo', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT value FROM platform_settings WHERE key = 'game_logo_url'`);
    res.json({ url: rows[0]?.value || null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
