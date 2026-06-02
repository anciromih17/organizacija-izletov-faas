import { useState } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";
import { useNavigate } from "react-router-dom";

export default function CreateTripPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", destination: "", date: "", description: "", maxParticipants: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await addDoc(collection(db, "trips"), {
        ...form,
        maxParticipants: Number(form.maxParticipants),
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        active: true,
      });
      navigate("/vsi-izleti");
    } catch (err) {
      setError("Napaka: " + err.message);
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Ustvari izlet</h1>
        <p>Dodajte nov izlet — po shranjevanju bo takoj na voljo za prijave</p>
      </div>

      <div className="card">
        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Ime izleta</label>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder="npr. Triglav – poletna tura"
              required
            />
          </div>

          <div className="form-group">
            <label>Destinacija</label>
            <input
              name="destination"
              value={form.destination}
              onChange={handleChange}
              placeholder="npr. Triglav, Slovenija"
              required
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div className="form-group">
              <label>Datum izleta</label>
              <input
                type="date"
                name="date"
                value={form.date}
                onChange={handleChange}
                required
              />
            </div>
            <div className="form-group">
              <label>Maks. udeležencev</label>
              <input
                type="number"
                name="maxParticipants"
                value={form.maxParticipants}
                onChange={handleChange}
                placeholder="npr. 30"
                min="1"
                required
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: "1.75rem" }}>
            <label>Opis <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--text-muted)", fontSize: "0.78rem" }}>(neobvezno)</span></label>
            <input
              name="description"
              value={form.description}
              onChange={handleChange}
              placeholder="Kratek opis izleta za udeležence..."
            />
          </div>

          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? "Shranjujem..." : "Ustvari izlet"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => navigate("/vsi-izleti")}>
              Prekliči
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
