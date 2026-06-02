import { useState, useEffect } from "react";
import { httpsCallable } from "firebase/functions";
import { collection, onSnapshot, query, where, orderBy } from "firebase/firestore";
import { functions, db } from "../firebase";

export default function TripRegistrationPage() {
  const [trips, setTrips] = useState([]);
  const [form, setForm] = useState({ tripName: "", travelerName: "", email: "", group: "—" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    const q = query(
      collection(db, "trips"),
      where("active", "==", true),
      orderBy("date", "asc")
    );
    return onSnapshot(q, (snapshot) => {
      setTrips(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, []);

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const fn = httpsCallable(functions, "createTripRegistration");
      const result = await fn(form);
      setSuccess(`Prijava oddana. ID: ${result.data.registrationId}`);
      setForm({ tripName: "", travelerName: "", email: "", group: "" });
    } catch (err) {
      setError(err.message || "Napaka pri pošiljanju prijave.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Prijava na izlet</h1>
        <p>Izberite izlet in izpolnite podatke udeleženca</p>
      </div>

      <div className="card">
        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        {trips.length === 0 && !success && (
          <div className="alert alert-warning">
            Trenutno ni razpisanih izletov. Preverite kasneje.
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Izlet</label>
            <select name="tripName" value={form.tripName} onChange={handleChange} required disabled={trips.length === 0}>
              <option value="">Izberi izlet</option>
              {trips.map((trip) => (
                <option key={trip.id} value={trip.name}>
                  {trip.name} — {trip.date}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Ime in priimek</label>
            <input
              name="travelerName"
              value={form.travelerName}
              onChange={handleChange}
              placeholder="Jana Novak"
              required
            />
          </div>

          <div className="form-group">
            <label>Email udeleženca</label>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="jana@example.com"
              required
            />
          </div>

          <button className="btn btn-primary" style={{ marginTop: "0.5rem" }} type="submit" disabled={loading || trips.length === 0}>
            {loading ? "Pošiljam..." : "Oddaj prijavo"}
          </button>
        </form>
      </div>
    </div>
  );
}
