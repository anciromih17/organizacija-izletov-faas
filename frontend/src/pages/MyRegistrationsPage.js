import { useEffect, useRef, useState } from "react";
import { collection, query, where, onSnapshot, orderBy, doc, updateDoc, addDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../firebase";
import { useAuth } from "../AuthContext";

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

function RegistrationRow({ reg }) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const fileRef = useRef();
  const st = STATUS_MAP[reg.status] || { label: reg.status, cls: "badge-pending" };

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg("");
    try {
      // 1. Naloži v Storage
      const storagePath = `trip-documents/${reg.id}/${file.name}`;
      const storageRef = ref(storage, storagePath);
      const snapshot = await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(snapshot.ref);

      // 2. Zapiši dokument v Firestore (ne čakamo na Cloud Function trigger)
      await addDoc(collection(db, "storageDocuments"), {
        registrationId: reg.id,
        fileName: file.name,
        storagePath,
        downloadUrl,
        contentType: file.type || "unknown",
        uploadedAt: serverTimestamp(),
        verified: false,
      });

      // 3. Posodobi prijavo
      await updateDoc(doc(db, "tripRegistrations", reg.id), {
        documentsUploaded: true,
        documentsUpdatedAt: serverTimestamp(),
      });

      // 4. Ustvari obvestilo (z userId za filtriranje)
      await addDoc(collection(db, "notifications"), {
        type: "STORAGE_DOCUMENT_UPLOADED",
        message: `Dokument "${file.name}" je bil uspešno naložen za izlet "${reg.tripName}".`,
        registrationId: reg.id,
        userId: reg.userId,
        createdAt: serverTimestamp(),
        read: false,
      });

      setUploadMsg(`✓ Datoteka "${file.name}" je bila uspešno naložena.`);
    } catch (err) {
      setUploadMsg("Napaka pri nalaganju: " + err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleCancel() {
    if (!window.confirm("Ali res želite odpovedati to prijavo?")) return;
    setCancelling(true);
    try {
      await updateDoc(doc(db, "tripRegistrations", reg.id), { status: "cancelled" });
    } finally {
      setCancelling(false);
    }
  }

  const canCancel = reg.status === "pending";
  const canUpload = reg.status !== "cancelled" && reg.status !== "rejected";

  return (
    <div className="registration-item">
      <div className="reg-item-header" onClick={() => setOpen(o => !o)}>
        <div className="registration-info">
          <h3>{reg.tripName}</h3>
          <p>{reg.travelerName} · Razred: {reg.group} · {fmt(reg.createdAt)}</p>
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
              <div className="detail-label">Potnik</div>
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
              <div className="detail-label">Status</div>
              <div className="detail-value"><span className={`badge ${st.cls}`}>{st.label}</span></div>
            </div>
            <div className="reg-detail-item">
              <div className="detail-label">Datum prijave</div>
              <div className="detail-value">{fmt(reg.createdAt)}</div>
            </div>
            <div className="reg-detail-item">
              <div className="detail-label">Dokumenti</div>
              <div className="detail-value">{reg.documentsUploaded ? "✓ Naloženi" : "Ni naloženih"}</div>
            </div>
          </div>

          {/* Document upload */}
          {canUpload && (
            <div>
              <div className="detail-label" style={{ marginBottom: "0.5rem" }}>
                Prijavnica / dokument
                <span style={{ marginLeft: "0.4rem", fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--text-muted)", fontSize: "0.75rem" }}>
                  — PDF, Word, slika
                </span>
              </div>
              <div className="upload-zone">
                <div>
                  {reg.documentsUploaded
                    ? <p>Dokument je bil naložen. Naložite novega za zamenjavo.</p>
                    : <p>Naložite prijavnico ali drug zahtevani dokument.</p>}
                  {uploadMsg && (
                    <p style={{ marginTop: "0.3rem", color: uploadMsg.startsWith("Napaka") ? "var(--red)" : "var(--green)", fontSize: "0.78rem" }}>
                      {uploadMsg}
                    </p>
                  )}
                </div>
                <div>
                  <input ref={fileRef} type="file" className="upload-input" id={`upload-${reg.id}`} onChange={handleUpload} accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" />
                  <label htmlFor={`upload-${reg.id}`} className="btn btn-ghost btn-sm" style={{ cursor: uploading ? "not-allowed" : "pointer", opacity: uploading ? 0.5 : 1 }}>
                    {uploading ? "Nalagam..." : "Izberi datoteko"}
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          {canCancel && (
            <div className="reg-actions">
              <button className="btn btn-danger btn-sm" onClick={handleCancel} disabled={cancelling}>
                {cancelling ? "..." : "Odpovej prijavo"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MyRegistrationsPage() {
  const { user } = useAuth();
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "tripRegistrations"),
      where("userId", "==", user.uid),
      orderBy("createdAt", "desc")
    );
    return onSnapshot(q, (snap) => {
      setRegistrations(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
  }, [user]);

  if (loading) return <div className="loading">Nalaganje...</div>;

  const counts = { pending: 0, approved: 0, rejected: 0 };
  registrations.forEach(r => { if (r.status in counts) counts[r.status]++; });
  const firstName = user?.email?.split("@")[0] || "Uporabnik";

  return (
    <div>
      <div className="hero-card">
        <div className="hero-label">Vaš pregled</div>
        <h2>Zdravo, {firstName} 👋</h2>
        <p>Kliknite na prijavo za podrobnosti, nalaganje dokumentov ali odjavo</p>
        <div className="hero-icon">🏔</div>
      </div>

      {registrations.length > 0 && (
        <div className="stats-row">
          <div className="stat-card stat-pending">
            <div className="stat-label">V obdelavi</div>
            <div className="stat-value">{counts.pending}</div>
            <div className="stat-sub">čaka na odgovor</div>
          </div>
          <div className="stat-card stat-approved">
            <div className="stat-label">Odobrenih</div>
            <div className="stat-value">{counts.approved}</div>
            <div className="stat-sub">potrjenih prijav</div>
          </div>
          <div className="stat-card stat-rejected">
            <div className="stat-label">Zavrnjenih</div>
            <div className="stat-value">{counts.rejected}</div>
            <div className="stat-sub">ni ustrezalo</div>
          </div>
        </div>
      )}

      <div className="section-label">Vse prijave — {registrations.length}</div>

      {registrations.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">🗺</span>
          <p>Nimate še nobene prijave na izlet.</p>
        </div>
      ) : (
        <div className="registrations-list">
          {registrations.map(reg => <RegistrationRow key={reg.id} reg={reg} />)}
        </div>
      )}
    </div>
  );
}
