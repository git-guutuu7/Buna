// One-time setup script: generates 100 standard 75-ball bingo cartelas and
// inserts them into bingo_cartelas. Safe to re-run - skips any
// cartela_number that already exists.
//
// Run manually once from the backend: node src/scripts/generate-bingo-cartelas.js

require('dotenv').config();
const { query, pool } = require('../database');

// Standard 75-ball column ranges: B=1-15, I=16-30, N=31-45, G=46-60, O=61-75.
// Each column draws 5 unique numbers from its range; the N column's middle
// cell (grid index 12) is the free space, represented as 0.
const COLUMN_RANGES = [
  [1, 15],   // B
  [16, 30],  // I
  [31, 45],  // N
  [46, 60],  // G
  [61, 75],  // O
];

function pickUnique(min, max, count) {
  const pool = [];
  for (let n = min; n <= max; n++) pool.push(n);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

// Returns a flat 25-element array, row-major (index = row * 5 + col).
// Column order is B, I, N, G, O - so grid[row*5 + col] belongs to
// COLUMN_RANGES[col].
function generateCartela() {
  const columns = COLUMN_RANGES.map(([min, max]) => pickUnique(min, max, 5));
  const grid = new Array(25).fill(0);
  for (let col = 0; col < 5; col++) {
    for (let row = 0; row < 5; row++) {
      if (col === 2 && row === 2) {
        grid[row * 5 + col] = 0; // free space, center of N column
      } else {
        grid[row * 5 + col] = columns[col][row];
      }
    }
  }
  return grid;
}

async function main() {
  const { rows: existing } = await query('SELECT cartela_number FROM bingo_cartelas');
  const existingNumbers = new Set(existing.map((r) => r.cartela_number));

  let created = 0;
  for (let n = 1; n <= 100; n++) {
    if (existingNumbers.has(n)) continue;
    const numbers = generateCartela();
    await query('INSERT INTO bingo_cartelas (cartela_number, numbers) VALUES ($1, $2)', [
      n,
      JSON.stringify(numbers),
    ]);
    created++;
  }

  console.log(`[bingo] Cartela generation complete. Created ${created} new cartela(s), ${existingNumbers.size} already existed.`);
  await pool.end();
}

main().catch((err) => {
  console.error('[bingo] Failed to generate cartelas', err);
  process.exit(1);
});
