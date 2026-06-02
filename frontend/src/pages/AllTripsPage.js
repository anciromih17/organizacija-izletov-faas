import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query, doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Link } from "react-router-dom";

const GRADIENTS = [
  "trip-card-header-gradient-0","trip-card-header-gradient-1",
  "trip-card-header-gradient-2","trip-card-header-gradient-3","trip-card-header-gradient-4",
];
const EMOJIS = ["⛰","🏕","🌲","🗺","🧗","🌄","🏞","🎒"];

function hash(str, len) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffff;
  return h % len;
}

function EditModal({ trip, onClose }) {
  const [form, setForm] = useState({
    name: trip.name || "",
    destination: trip.destination || "",
    date: trip.date || "",
    description: trip.description || "",
    maxParticipants: trip.maxParticipants || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await updateDoc(doc(db, "trips", trip.id), {
        ...form,
        maxParticipants: Number(form.maxParticipants),
      });
      onClose();
    } catch (err) {
      setError("Napaka: " + err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <h2>Uredi izlet</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSave}>
          <div className="form-group">
            <label>Ime izleta</label>
            <input name="name" value={form.name} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label>Destinacija</label>
            <input name="destination" value={form.destination} onChange={handleChange} required />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div className="form-group">
              <label>Datum</label>
              <input type="date" name="date" value={form.date} onChange={handleChange} required />
            </div>
            <div className="form-group">
              <label>Maks. udeležencev</label>
              <input type="number" name="maxParticipants" value={form.maxParticipants} onChange={handleChange} min="1" required />
            </div>
          </div>
          <div className="form-group">
            <label>Opis</label>
            <input name="description" value={form.description} onChange={handleChange} placeholder="Kratek opis..." />
          </div>
          <div className="modal-footer">
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? "Shranjujem..." : "Shrani spremembe"}
            </button>
            <button className="btn btn-ghost" type="button" onClick={onClose}>Prekliči</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TripCard({ trip, onToggle, onEdit }) {
  const emoji = EMOJIS[hash(trip.id + "e", EMOJIS.length)];
  const gradClass = GRADIENTS[hash(trip.id, GRADIENTS.length)];

  return (
    <div className="trip-card" style={{ opacity: trip.active ? 1 : 0.55 }}>
      <div className={`trip-card-header ${gradClass}`}>
        <span className="trip-card-emoji">{emoji}</span>
        <h3>{trip.name}</h3>
      </div>
      <div className="trip-card-body">
        <div className="trip-card-meta">
          {trip.destination       && <span>📍 {trip.destination}</span>}
          {trip.date              && <span>📅 {trip.date}</span>}
          {trip.maxParticipants   && <span>👥 Max {trip.maxParticipants}</span>}
        </div>
        {trip.description && (
          <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.85rem", lineHeight: 1.5 }}>
            {trip.description}
          </p>
        )}
        <div className="trip-card-footer">
          <span className={`badge ${trip.active ? "badge-approved" : "badge-rejected"}`}>
            {trip.active ? "Aktiven" : "Neaktiven"}
          </span>
          <div className="trip-card-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => onEdit(trip)}>Uredi</button>
            <button className={`btn btn-sm ${trip.active ? "btn-danger" : "btn-success"}`} onClick={() => onToggle(trip)}>
              {trip.active ? "Deaktiviraj" : "Aktiviraj"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AllTripsPage() {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editTrip, setEditTrip] = useState(null);

  useEffect(() => {
    const q = query(collection(db, "trips"), orderBy("createdAt", "desc"));
    return onSnapshot(q, snap => {
      setTrips(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
  }, []);

  async function toggleActive(trip) {
    await updateDoc(doc(db, "trips", trip.id), { active: !trip.active });
  }

  if (loading) return <div className="loading">Nalaganje...</div>;

  const active   = trips.filter(t => t.active);
  const inactive = trips.filter(t => !t.active);

  return (
    <div>
      <div className="hero-card">
        <div className="hero-label">Upravljanje</div>
        <h2>Razpisani izleti</h2>
        <p>Urejanje, aktivacija in pregled vseh izletov</p>
        <div className="hero-icon">🗺</div>
      </div>

      <div className="stats-row">
        <div className="stat-card stat-total">
          <div className="stat-label">Skupaj</div>
          <div className="stat-value">{trips.length}</div>
          <div className="stat-sub">vsi izleti</div>
        </div>
        <div className="stat-card stat-active">
          <div className="stat-label">Aktivnih</div>
          <div className="stat-value">{active.length}</div>
          <div className="stat-sub">na voljo za prijavo</div>
        </div>
        <div className="stat-card stat-rejected">
          <div className="stat-label">Neaktivnih</div>
          <div className="stat-value">{inactive.length}</div>
          <div className="stat-sub">začasno skritih</div>
        </div>
      </div>

      {trips.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">🏕</span>
          <p>Ni ustvarjenih izletov. <Link to="/ustvari-izlet" style={{ color: "var(--accent-warm)" }}>Ustvari prvega →</Link></p>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <div style={{ marginBottom: "2.5rem" }}>
              <div className="section-label">Aktivni — {active.length}</div>
              <div className="trip-grid">
                {active.map(t => <TripCard key={t.id} trip={t} onToggle={toggleActive} onEdit={setEditTrip} />)}
              </div>
            </div>
          )}
          {inactive.length > 0 && (
            <div>
              <div className="section-label">Neaktivni — {inactive.length}</div>
              <div className="trip-grid">
                {inactive.map(t => <TripCard key={t.id} trip={t} onToggle={toggleActive} onEdit={setEditTrip} />)}
              </div>
            </div>
          )}
        </>
      )}

      {editTrip && <EditModal trip={editTrip} onClose={() => setEditTrip(null)} />}
    </div>
  );
}
