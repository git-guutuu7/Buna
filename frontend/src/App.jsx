import React, { createContext, useContext, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';

import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Aviator from './pages/Aviator.jsx';
import WalletPage from './pages/WalletPage.jsx';
import Support from './pages/Support.jsx';
import Profile from './pages/Profile.jsx';
import Referral from './pages/Referral.jsx';
import Admin from './pages/Admin.jsx';
import Bingo from './pages/Bingo.jsx';
import Layout from './Layout.jsx';
import ChannelGate from './components/ChannelGate.jsx';

export const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });

  const login = (userData, token) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  const updateBalance = (balance) => {
    setUser((prev) => {
      const next = { ...prev, balance };
      localStorage.setItem('user', JSON.stringify(next));
      return next;
    });
  };

  const updateUser = (patch) => {
    setUser((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem('user', JSON.stringify(next));
      return next;
    });
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, updateBalance, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

function ProtectedRoute({ children, adminOnly = false, withNav = true }) {
  const { user } = useAuth();
  const location = useLocation();

  // Preserve the query string (e.g. ?ref=CODE from a referral link) across
  // this redirect - otherwise Login.jsx never sees it and referral signups
  // never get linked to a referrer.
  if (!user) return <Navigate to={`/login${location.search}`} replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/dashboard" replace />;

  // Admins are exempt from the join-gate so they can never lock
  // themselves out of the admin panel over this check.
  if (!adminOnly && (!user.channels_verified || !user.bot_link_clicked)) {
    return <ChannelGate />;
  }

  return withNav ? <Layout>{children}</Layout> : children;
}

// Redirects "/" to "/dashboard" while preserving any query string, so a
// referral link opened at the site root (e.g. "/?ref=CODE") still has
// ?ref=CODE attached once ProtectedRoute bounces the user on to /login.
function RootRedirect() {
  const location = useLocation();
  return <Navigate to={`/dashboard${location.search}`} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<Login />} />

          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard/aviator"
            element={
              <ProtectedRoute withNav={false}>
                <Aviator />
              </ProtectedRoute>
            }
          />
          <Route
            path="/wallet"
            element={
              <ProtectedRoute>
                <WalletPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/support"
            element={
              <ProtectedRoute>
                <Support />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/referral"
            element={
              <ProtectedRoute>
                <Referral />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute adminOnly withNav={false}>
                <Admin />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard/bingo"
            element={
              <ProtectedRoute withNav={false}>
                <Bingo />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
