import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../App.jsx';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <nav className="navbar">
      <div className="brand">✈ Aviator</div>
      <div className="links">
        {user && (
          <>
            <Link to="/dashboard">Dashboard</Link>
            {user.role === 'admin' && <Link to="/admin">Admin Panel</Link>}
            <span style={{ color: '#9aa0b4' }}>
              {user.username} · ${Number(user.balance || 0).toFixed(2)}
            </span>
            <button className="btn btn-outline" onClick={handleLogout}>
              Log out
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
