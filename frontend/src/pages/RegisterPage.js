import { useState } from "react";
import { Link } from "react-router-dom";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (password.length < 6) { setError("Geslo mora vsebovati vsaj 6 znakov."); return; }
    setLoading(true);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setError(err.code === "auth/email-already-in-use"
        ? "Ta email je že v uporabi."
        : "Napaka pri registraciji. Poskusite znova.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon">🧭</div>
          Izleti
        </div>

        <h1>Ustvarite račun</h1>
        <p className="subtitle">Začnite z organizacijo izletov</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vas@email.com"
              required
              autoComplete="email"
            />
          </div>
          <div className="form-group" style={{ marginBottom: "1.5rem" }}>
            <label>Geslo</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Vsaj 6 znakov"
              required
              autoComplete="new-password"
            />
          </div>
          <button className="btn btn-primary" style={{ width: "100%" }} disabled={loading}>
            {loading ? "Ustvarjam račun..." : "Registracija"}
          </button>
        </form>

        <div className="auth-footer">
          Že imate račun? <Link to="/prijava">Prijava</Link>
        </div>
      </div>
    </div>
  );
}
