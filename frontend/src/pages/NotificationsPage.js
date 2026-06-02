import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query, where, writeBatch, doc } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";

const TYPE_META = {
  NEW_REGISTRATION:          { label: "Nova prijava",          color: "var(--blue)" },
  STATUS_CHANGED:            { label: "Sprememba statusa",     color: "var(--amber)" },
  MISSING_DOCUMENTS:         { label: "Manjkajoči dokumenti",  color: "var(--red)" },
  PUBSUB_EVENT_PROCESSED:    { label: "Pub/Sub dogodek",       color: "var(--text-muted)" },
  STORAGE_DOCUMENT_UPLOADED: { label: "Dokument naložen",      color: "var(--green)" },
  EMAIL_SENT:                { label: "Email poslan",          color: "var(--green)" },
};

function fmtDT(ts) {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleString("sl-SI", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function NotificationsPage() {
  const { user, role } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState("vse");
  const [marking, setMarking]   = useState(false);
  const isAdmin = role === "admin";

  useEffect(() => {
    if (!user) return;
    const q = isAdmin
      ? query(collection(db, "notifications"), orderBy("createdAt", "desc"))
      : query(collection(db, "notifications"), where("userId", "==", user.uid), orderBy("createdAt", "desc"));

    return onSnapshot(q, (snap) => {
      setNotifications(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
  }, [user, isAdmin]);

  async function markAllRead() {
    // Admin označi samo sistemska obvestila (brez userId)
    // User označi samo svoja (userId == user.uid)
    const unread = notifications.filter(n =>
      n.read === false &&
      (isAdmin ? !n.userId : n.userId === user.uid)
    );
    if (unread.length === 0) return;
    setMarking(true);
    try {
      // Firestore batch – max 500 dokumentov naenkrat
      const chunks = [];
      for (let i = 0; i < unread.length; i += 500) chunks.push(unread.slice(i, i + 500));
      for (const chunk of chunks) {
        const batch = writeBatch(db);
        chunk.forEach(n => batch.update(doc(db, "notifications", n.id), { read: true }));
        await batch.commit();
      }
    } finally {
      setMarking(false);
    }
  }

  if (loading) return <div className="loading">Nalaganje...</div>;

  const unreadCount = notifications.filter(n => n.read === false).length;
  const filtered = filter === "vse"
    ? notifications
    : notifications.filter((n) => n.type === filter);
  const types = [...new Set(notifications.map((n) => n.type))];

  return (
    <div>
      <div className="hero-card">
        <div className="hero-label">{isAdmin ? "Sistem" : "Vaša obvestila"}</div>
        <h2>Obvestila</h2>
        <p>
          {isAdmin
            ? "Vsa sistemska obvestila v realnem času"
            : "Obvestila vezana na vaše prijave — posodablja se samodejno"}
        </p>
        <div className="hero-icon">🔔</div>
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
        {/* Filter chips */}
        <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
          <button
            className="stat-chip"
            onClick={() => setFilter("vse")}
            style={{
              cursor: "pointer",
              border: filter === "vse" ? "1px solid var(--border-md)" : "1px solid var(--border)",
              color: filter === "vse" ? "var(--text-primary)" : "var(--text-secondary)",
              background: filter === "vse" ? "var(--bg-4)" : "var(--bg-3)",
            }}
          >
            Vsa ({notifications.length})
          </button>
          {types.map((t) => {
            const meta = TYPE_META[t] || { label: t, color: "var(--text-muted)" };
            return (
              <button
                key={t}
                className="stat-chip"
                onClick={() => setFilter(t)}
                style={{
                  cursor: "pointer",
                  border: filter === t ? "1px solid var(--border-md)" : "1px solid var(--border)",
                  color: filter === t ? meta.color : "var(--text-secondary)",
                  background: filter === t ? "var(--bg-4)" : "var(--bg-3)",
                }}
              >
                {meta.label}
              </button>
            );
          })}
        </div>

        {/* Read all */}
        {unreadCount > 0 && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={markAllRead}
            disabled={marking}
            style={{ flexShrink: 0 }}
          >
            {marking ? "Označujem..." : `✓ Označi vse kot prebrano (${unreadCount})`}
          </button>
        )}
      </div>

      <div className="section-label">{filtered.length} obvestil</div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">🔔</span>
          <p>{isAdmin ? "Ni obvestil." : "Nimate še nobenih obvestil."}</p>
        </div>
      ) : (
        filtered.map((n) => {
          const meta = TYPE_META[n.type] || { label: n.type, color: "var(--text-muted)" };
          return (
            <div
              key={n.id}
              className="notification-item"
              style={{ borderLeft: n.read === false ? `3px solid ${meta.color}` : "1px solid var(--border)" }}
            >
              <div className="notification-type" style={{ color: meta.color }}>
                {meta.label}
                {n.read === false && (
                  <span style={{ marginLeft: "0.5rem", display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: meta.color, verticalAlign: "middle" }} />
                )}
              </div>
              <p>{n.message}</p>
              {n.previewUrl && (
                <a
                  href={n.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="doc-link"
                  style={{ marginTop: "0.5rem", display: "inline-flex" }}
                >
                  ✉ Odpri email preview
                </a>
              )}
              <div className="time">{fmtDT(n.createdAt)}</div>
            </div>
          );
        })
      )}
    </div>
  );
}
