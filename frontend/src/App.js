import { useEffect, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, NavLink } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { AuthProvider, useAuth } from "./AuthContext";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import TripRegistrationPage from "./pages/TripRegistrationPage";
import MyRegistrationsPage from "./pages/MyRegistrationsPage";
import AdminPage from "./pages/AdminPage";
import NotificationsPage from "./pages/NotificationsPage";
import CreateTripPage from "./pages/CreateTripPage";
import AllTripsPage from "./pages/AllTripsPage";
import { auth, db } from "./firebase";
import { signOut } from "firebase/auth";
import "./App.css";

function useUnreadCount(user, role) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!user) return;
    const isAdmin = role === "admin";
    const q = isAdmin
      ? query(collection(db, "notifications"), where("read", "==", false), where("userId", "==", null))
      : query(collection(db, "notifications"), where("read", "==", false), where("userId", "==", user.uid));
    return onSnapshot(q, (snap) => setCount(snap.size));
  }, [user, role]);
  return count;
}

function ProfileDropdown({ user, role, onClose }) {
  const initials = user.email ? user.email[0].toUpperCase() : "?";
  const roleClass = `profile-role-${role || "user"}`;
  const roleLabel = role || "Uporabnik";
  return (
    <div className="profile-dropdown">
      <div className="profile-dropdown-header">
        <p>Prijavljeni kot</p>
        <strong>{user.email}</strong>
        <div><span className={`profile-role-badge ${roleClass}`}>{roleLabel}</span></div>
      </div>
      <button className="dropdown-logout-btn" onClick={() => { signOut(auth); onClose(); }}>
        ↩ Odjava
      </button>
    </div>
  );
}

function Navigation() {
  const { user, role } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const wrapperRef = useRef(null);
  const unread = useUnreadCount(user, role);
  const isAdmin = role === "admin";

  useEffect(() => {
    function onClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setDropdownOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (!user) return null;

  const initials = user.email ? user.email[0].toUpperCase() : "?";

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <div className="brand-icon">🧭</div>
        Izletko
      </div>

      <div className="navbar-center navbar-links">
        {isAdmin ? (
          <>
            <NavLink to="/ustvari-izlet">Ustvari izlet</NavLink>
            <NavLink to="/vsi-izleti">Vsi izleti</NavLink>
            <NavLink to="/obvestila" style={{ position: "relative" }}>
              Obvestila
              {unread > 0 && <span className="nav-dot" />}
            </NavLink>
            <NavLink to="/admin">Prijave</NavLink>
          </>
        ) : (
          <>
            <NavLink to="/prijava-na-izlet">Prijava na izlet</NavLink>
            <NavLink to="/moje-prijave">Moje prijave</NavLink>
            <NavLink to="/obvestila" style={{ position: "relative" }}>
              Obvestila
              {unread > 0 && <span className="nav-dot" />}
            </NavLink>
          </>
        )}
      </div>

      <div className="navbar-right">
        <div className="profile-wrapper" ref={wrapperRef}>
          <button className="profile-btn" onClick={() => setDropdownOpen(o => !o)}>
            <div className="profile-avatar">{initials}</div>
            <span className="profile-email">{user.email}</span>
            <span className={`profile-chevron ${dropdownOpen ? "open" : ""}`}>▾</span>
          </button>
          {dropdownOpen && (
            <ProfileDropdown user={user} role={role} onClose={() => setDropdownOpen(false)} />
          )}
        </div>
      </div>
    </nav>
  );
}

function ProtectedRoute({ children, adminOnly = false }) {
  const { user, role } = useAuth();
  if (user === undefined) return <div className="loading">Nalaganje...</div>;
  if (!user) return <Navigate to="/prijava" replace />;
  if (adminOnly && role !== "admin") return <Navigate to="/moje-prijave" replace />;
  return children;
}

function AppRoutes() {
  const { user, role } = useAuth();
  if (user === undefined) return <div className="loading">Nalaganje...</div>;
  const defaultPath = role === "admin" ? "/vsi-izleti" : "/moje-prijave";

  return (
    <>
      <Navigation />
      <main className="main-content">
        <Routes>
          <Route path="/prijava"      element={user ? <Navigate to={defaultPath} replace /> : <LoginPage />} />
          <Route path="/registracija" element={user ? <Navigate to={defaultPath} replace /> : <RegisterPage />} />
          <Route path="/ustvari-izlet" element={<ProtectedRoute adminOnly><CreateTripPage /></ProtectedRoute>} />
          <Route path="/vsi-izleti"    element={<ProtectedRoute adminOnly><AllTripsPage /></ProtectedRoute>} />
          <Route path="/admin"         element={<ProtectedRoute adminOnly><AdminPage /></ProtectedRoute>} />
          <Route path="/prijava-na-izlet" element={<ProtectedRoute><TripRegistrationPage /></ProtectedRoute>} />
          <Route path="/moje-prijave"     element={<ProtectedRoute><MyRegistrationsPage /></ProtectedRoute>} />
          <Route path="/obvestila"        element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to={user ? defaultPath : "/prijava"} replace />} />
        </Routes>
      </main>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
