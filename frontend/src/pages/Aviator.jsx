import React from 'react';
import { useNavigate } from 'react-router-dom';
import GameBoard from '../components/GameBoard.jsx';

// The live Aviator game screen. Reached by tapping the game tile on the
// Dashboard. Keeps its own lightweight header with a back button rather
// than the full Navbar, so the game screen feels focused.
export default function Aviator() {
  const navigate = useNavigate();

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 16px',
          borderBottom: '1px solid #2a2e3e',
        }}
      >
        <button
          className="btn btn-outline"
          onClick={() => navigate('/dashboard')}
          style={{ padding: '6px 12px' }}
        >
          ← Back
        </button>
        <span style={{ fontWeight: 700, color: '#4f8ef7' }}>Aviator</span>
      </div>

      <div className="container">
        <GameBoard />
      </div>
    </div>
  );
}
