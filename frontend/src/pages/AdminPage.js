import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query, getDocs, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";

const FUNCTIONS_BASE = "http://127.0.0.1:5001/organizacija-izletov/us-central1";

const STATUS_MAP = {
  pending:   { label: "V obdelavi", cls: "badge-pending" },
  approved:  { label: "Odobreno",   cls: "badge-approved" },
  rejected:  { label: "Zavrnjeno",  cls: "badge-rejected" },
  cancelled: { label: "Odpovedano", cls: "badge-cancelled" },
};

function fmt(ts) {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleDateString("sl-SI", { day: "numeric", month: "short", year: "numeric" });
}

function AdminRegistrationRow({ reg, onAction, processing }) {
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const st = STATUS_MAP[reg.status] || { label: reg.status, cls: "badge-pending" };

  async function loadDocuments() {
    if (docs.length > 0 || !reg.documentsUploaded) return;
    setLoadingDocs(true);
    try {
      const snap = await getDocs(query(
        collection(db, "storageDocuments"),
        where("registrationId", "==", reg.id)
      ));
      setDocs(snap.docs.map(d => d.data()));
    } finally {
      setLoadingDocs(false);
    }
  }

  function handleToggle() {
    setOpen(o => {
      if (!o) loadDocuments();
      return !o;
    });
  }

  const docMissing = !reg.documentsUploaded;
  const canApprove = reg.status !== "approved" && reg.status !== "cancelled" && !docMissing;
  const canReject  = reg.status !== "rejected" && reg.status !== "cancelled";

  return (
    <div className="registration-item">
      <div className="reg-item-header" onClick={handleToggle}>
        <div className="registration-info">
          <h3>{reg.tripName}</h3>
          <p>
            <strong style={{ color: "var(--text-primary)", fontWeight: 600 }}>{reg.travelerName}</strong>
            {" · "}{reg.email}{" · "}{reg.group}
          </p>
          <p style={{ marginTop: "0.15rem" }}>{fmt(reg.createdAt)}</p>
        </div>
        <div className="reg-item-right">
          {reg.documentsUploaded && <span className="badge badge-info">Dokument ✓</span>}
          <span className={`badge ${st.cls}`}>{st.label}</span>
          <span className={`reg-chevron ${open ? "open" : ""}`}>▾</span>
        </div>
      </div>

      {open && (
        <div className="reg-item-body">
          <div className="reg-detail-grid">
            <div className="reg-detail-item">
              <div className="detail-label">Ime in priimek</div>
              <div className="detail-value">{reg.travelerName}</div>
            </div>
            <div className="reg-detail-item">
              <div className="detail-label">Email</div>
              <div className="detail-value">{reg.email}</div>
            </div>
            <div className="reg-detail-item">
              <div className="detail-label">Razred / skupina</div>
              <div className="detail-value">{reg.group}</div>
            </div>
            <div className="reg-detail-item">
              <div className="detail-label">Datum prijave</div>
              <div className="detail-value">{fmt(reg.createdAt)}</div>
            </div>
            {reg.processedAt && (
              <div className="reg-detail-item">
                <div className="detail-label">Obdelano</div>
                <div className="detail-value">{fmt(reg.processedAt)}</div>
              </div>
            )}
          </div>

          {/* Documents */}
          <div>
            <div className="detail-label" style={{ marginBottom: "0.5rem" }}>Priloženi dokumenti</div>
            {!reg.documentsUploaded ? (
              <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Udeleženec še ni naložil dokumentov.</p>
            ) : loadingDocs ? (
              <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Nalagam...</p>
            ) : docs.length === 0 ? (
              <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Dokumenti so bili naloženi, a jih ni mogoče prikazati.</p>
            ) : (
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {docs.map((d, i) => (
                  d.downloadUrl
                    ? <a key={i} href={d.downloadUrl} target="_blank" rel="noreferrer" className="doc-link">⬇ {d.fileName}</a>
                    : <span key={i} className="badge badge-info">{d.fileName}</span>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="reg-actions">
            {/* Varovalo – dokument manjka */}
            {docMissing && reg.status !== "cancelled" && reg.status !== "approved" && (
              <div style={{
                display: "flex", alignItems: "center", gap: "0.5rem",
                padding: "0.5rem 0.85rem",
                background: "var(--amber-muted)",
                border: "1px solid rgba(251,191,36,0.2)",
                borderRadius: "var(--radius-sm)",
                fontSize: "0.8rem", color: "var(--amber)",
                width: "100%", marginBottom: "0.5rem",
              }}>
                ⚠ Odobritev ni mogoča — udeleženec še ni naložil dokumenta.
              </div>
            )}

            {canApprove && (
              <button className="btn btn-success" onClick={() => onAction(reg.id, "approve")} disabled={!!processing}>
                {processing === reg.id + "approve" ? "..." : "Odobri"}
              </button>
            )}
            {/* Approve gumb onemogočen z vizualnim namigom */}
            {docMissing && reg.status === "pending" && (
              <button className="btn btn-success" disabled title="Najprej mora udeleženec naložiti dokument" style={{ opacity: 0.35, cursor: "not-allowed" }}>
                Odobri
              </button>
            )}
            {canReject && (
              <button className="btn btn-danger" onClick={() => onAction(reg.id, "reject")} disabled={!!processing}>
                {processing === reg.id + "reject" ? "..." : "Zavrni"}
              </button>
            )}
            {reg.status === "cancelled" && (
              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Udeleženec je odpovedal prijavo.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AdminToolbar() {
  const [reminderLoading, setReminderLoading] = useState(false);
  const [toolMsg, setToolMsg] = useState({ text: "", type: "" });

  async function runReminder() {
    setReminderLoading(true);
    setToolMsg({ text: "", type: "" });
    try {
      const res = await fetch(`${FUNCTIONS_BASE}/runDailyReminderCheckNow`);
      const data = await res.json();
      setToolMsg({
        text: `Preverjanje zaključeno — ustvarjenih ${data.remindersCreated} opomnikov za manjkajoče dokumente.`,
        type: "success",
      });
    } catch (err) {
      setToolMsg({ text: "Napaka pri klicu funkcije: " + err.message, type: "error" });
    } finally {
      setReminderLoading(false);
    }
  }


  return (
    <div className="card" style={{ marginBottom: "1.5rem" }}>
      <h2 style={{ marginBottom: "0.75rem" }}>Sistemska orodja</h2>
      <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginBottom: "1.25rem" }}>
        Ročni sprožilci Cloud Functions za testiranje in administrativne akcije.
      </p>

      {toolMsg.text && (
        <div className={`alert alert-${toolMsg.type === "error" ? "error" : "success"}`} style={{ marginBottom: "1rem" }}>
          {toolMsg.text}
        </div>
      )}

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        {/* Gumb 1: dnevni opomnik */}
        <div style={{ flex: 1, minWidth: "240px", background: "var(--bg-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "1rem" }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent-warm)", marginBottom: "0.35rem" }}>
            Dnevni opomnik
          </div>
          <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginBottom: "0.85rem", lineHeight: 1.5 }}>
            Pokliči in preveri vse prijave brez dokumentov in pošlji obvestila.
          </p>
          <button className="btn btn-primary btn-sm" onClick={runReminder} disabled={reminderLoading}>
            {reminderLoading ? "Preverjam..." : "▶ Zaženi preverjanje"}
          </button>
        </div>

      </div>
    </div>
  );
}

export default function AdminPage() {
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(null);
  const [message, setMessage] = useState({ text: "", type: "" });

  useEffect(() => {
    const q = query(collection(db, "tripRegistrations"), orderBy("createdAt", "desc"));
    return onSnapshot(q, snap => {
      setRegistrations(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
  }, []);

  async function handleAction(registrationId, action) {
    setProcessing(registrationId + action);
    setMessage({ text: "", type: "" });
    try {
      const fn = httpsCallable(functions, "processTripRegistrationSecure");
      const res = await fn({ registrationId, action });
      setMessage({ text: res.data.message, type: "success" });
    } catch (err) {
      setMessage({ text: err.message, type: "error" });
    } finally {
      setProcessing(null);
    }
  }

  if (loading) return <div className="loading">Nalaganje...</div>;

  const pending   = registrations.filter(r => r.status === "pending");
  const approved  = registrations.filter(r => r.status === "approved");
  const rejected  = registrations.filter(r => r.status === "rejected");
  const cancelled = registrations.filter(r => r.status === "cancelled");

  return (
    <div>
      <div className="hero-card">
        <div className="hero-label">Admin</div>
        <h2>Upravljanje prijav</h2>
        <p>Kliknite na prijavo za podrobnosti, dokumente in odobritev</p>
        <div className="hero-icon">📋</div>
      </div>

      <div className="stats-row">
        <div className="stat-card stat-pending">
          <div className="stat-label">V obdelavi</div>
          <div className="stat-value">{pending.length}</div>
          <div className="stat-sub">čaka na odločitev</div>
        </div>
        <div className="stat-card stat-approved">
          <div className="stat-label">Odobrenih</div>
          <div className="stat-value">{approved.length}</div>
          <div className="stat-sub">potrjenih</div>
        </div>
        <div className="stat-card stat-rejected">
          <div className="stat-label">Zavrnjenih</div>
          <div className="stat-value">{rejected.length}</div>
          <div className="stat-sub">ni ustrezalo</div>
        </div>
      </div>

      <AdminToolbar />

      {message.text && (
        <div className={`alert alert-${message.type === "error" ? "error" : "success"}`}>
          {message.text}
        </div>
      )}

      {/* Pending */}
      <div style={{ marginBottom: "2.5rem" }}>
        <div className="section-label">Čakajo na odobritev — {pending.length}</div>
        {pending.length === 0 ? (
          <div className="empty-state" style={{ padding: "2rem" }}>
            <span className="empty-icon">✓</span>
            <p>Vse prijave so obdelane.</p>
          </div>
        ) : (
          <div className="registrations-list">
            {pending.map(reg => (
              <AdminRegistrationRow key={reg.id} reg={reg} onAction={handleAction} processing={processing} />
            ))}
          </div>
        )}
      </div>

      {/* Processed */}
      {(approved.length + rejected.length + cancelled.length) > 0 && (
        <div>
          <div className="section-label">Obdelane — {approved.length + rejected.length + cancelled.length}</div>
          <div className="registrations-list">
            {[...approved, ...rejected, ...cancelled].map(reg => (
              <AdminRegistrationRow key={reg.id} reg={reg} onAction={handleAction} processing={processing} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
