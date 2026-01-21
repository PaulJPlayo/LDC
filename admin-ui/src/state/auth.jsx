import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getCurrentUser, login as loginRequest, logout as logoutRequest } from '../lib/api.js';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [status, setStatus] = useState('checking');
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');

  const refresh = async () => {
    setStatus('checking');
    setError('');
    try {
      const nextUser = await getCurrentUser();
      setUser(nextUser);
      setStatus(nextUser ? 'authenticated' : 'anonymous');
    } catch (err) {
      setStatus('anonymous');
      setUser(null);
      setError('Unable to confirm session. Please sign in again.');
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const login = async (email, password) => {
    setError('');
    await loginRequest(email, password);
    const nextUser = await getCurrentUser();
    setUser(nextUser);
    setStatus(nextUser ? 'authenticated' : 'anonymous');
    return nextUser;
  };

  const logout = async () => {
    setError('');
    try {
      await logoutRequest();
    } catch (err) {
      // If the session is already gone, still clear local state.
    }
    setUser(null);
    setStatus('anonymous');
  };

  const value = useMemo(
    () => ({ status, user, error, login, logout, refresh }),
    [status, user, error]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
};
