import { createContext, useState, useEffect } from 'react';
import API from '../api';
import { useNavigate } from 'react-router-dom';

const noopAsync = async (..._args) => {};
const noop = () => {};

// Safe default prevents runtime crashes if a component renders
// before provider wiring/HMR settles.
export const AuthContext = createContext({
  user: null,
  login: noopAsync,
  logout: noop,
});

/** Read persisted session synchronously so the first paint keeps protected routes (fixes refresh → login flash). */
function readStoredSessionUser() {
  if (typeof window === 'undefined') return null;
  try {
    // Prefer sessionStorage so a fresh login without "remember me" wins over stale localStorage
    const token = sessionStorage.getItem('token') || localStorage.getItem('token');
    const role = sessionStorage.getItem('role') || localStorage.getItem('role');
    const firstName = sessionStorage.getItem('firstName') || localStorage.getItem('firstName');
    const lastName = sessionStorage.getItem('lastName') || localStorage.getItem('lastName');
    const email = sessionStorage.getItem('email') || localStorage.getItem('email');
    if (token && role) return { token, role, firstName, lastName, email };
  } catch {
    return null;
  }
  return null;
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(readStoredSessionUser);
  const navigate = useNavigate();

  useEffect(() => {
    setUser(readStoredSessionUser());
  }, []);

  const login = async (email, password, rememberMe = false) => {
    const { data } = await API.post('/auth/login', { email, password });
    // Clear both storages so we never mix an old token with a new role (fixes 403 / wrong dashboard)
    const keys = ['token', 'role', 'firstName', 'lastName', 'email'];
    keys.forEach((k) => {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    });
    const storage = rememberMe ? localStorage : sessionStorage;
    storage.setItem('token', data.token);
    storage.setItem('role', data.role);
    storage.setItem('firstName', data.firstName);
    storage.setItem('lastName', data.lastName);
    storage.setItem('email', data.email);
    setUser({ token: data.token, role: data.role, firstName: data.firstName, lastName: data.lastName, email: data.email });

    if (data.role === 'admin') navigate('/admin-dashboard');
    else if (data.role === 'clinician') navigate('/clinician-dashboard');
    else if (data.role === 'therapist') navigate('/therapist-dashboard');
    else if (data.role === 'parent') navigate('/parent-dashboard');
    else if (data.role === 'lab') navigate('/lab-dashboard');
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('firstName');
    localStorage.removeItem('lastName');
    localStorage.removeItem('email');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('role');
    sessionStorage.removeItem('firstName');
    sessionStorage.removeItem('lastName');
    sessionStorage.removeItem('email');
    setUser(null);
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
