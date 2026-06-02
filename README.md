# Izletko – Brezstrežniški sistem za organizacijo izletov
---

## Kazalo

1. [Opis projekta](#1-opis-projekta)
2. [Tehnološki sklad](#2-tehnološki-sklad)
3. [Struktura projekta](#3-struktura-projekta)
4. [Zakaj serverless?](#4-zakaj-serverless)
5. [Avtentikacija in avtorizacija](#5-avtentikacija-in-avtorizacija)
6. [Implementirani dogodki (eventi)](#6-implementirani-dogodki-eventi)
7. [Vse Cloud Functions](#7-vse-cloud-functions)
8. [Firestore podatkovni model](#8-firestore-podatkovni-model)
9. [Frontend – React spletni vmesnik](#9-frontend--react-spletni-vmesnik)
10. [Izpolnjene zahteve naloge](#10-izpolnjene-zahteve-naloge)
11. [Zagon in testiranje](#11-zagon-in-testiranje)
12. [Celotni event-driven tokovi](#12-celotni-event-driven-tokovi)

---

## 1. Opis projekta

**Izletko** je brezstrežniški informacijski sistem za upravljanje izletov. Sistem pokriva celoten življenjski cikel izleta – od administratorjevega ustvarjanja izleta, registracije udeležencev, nalaganja dokumentov, administrativne odobritve do samodejnega pošiljanja potrditvenega emaila.

Sistem je zgrajen na principu **event-driven FaaS arhitekture**: funkcije se ne izvajajo neprestano, temveč se sprožijo samo ob specifičnih dogodkih (HTTP zahteva, sprememba v bazi, upload datoteke, sporočilo v vrsti, urniku).

---

## 2. Tehnološki sklad

| Tehnologija | Vloga v projektu |
|---|---|
| **Firebase Cloud Functions v2** | FaaS – izvajanje poslovne logike |
| **Firestore** | NoSQL baza (BaaS) |
| **Firebase Authentication** | Upravljanje identitet in JWT tokenov |
| **Firebase Storage** | Shramba za dokumente udeležencev |
| **Google Pub/Sub** | Asinhroni messaging sistem (message queue) |
| **Nodemailer + Ethereal** | Pošiljanje potrditvenih emailov (testni SMTP) |
| **Firebase Emulator Suite** | Lokalno razvojno okolje |
| **React + Firebase JS SDK** | Spletni vmesnik (frontend) |
| **Postman** | Testiranje API endpointov |

---

## 3. Struktura projekta

```
organizacija-izletov/
│
├── functions/                  ← BACKEND (Cloud Functions)
│   ├── index.js                ← vse Cloud Functions (12 funkcij)
│   └── package.json            ← odvisnosti: firebase-functions, nodemailer, pubsub
│
├── frontend/                   ← FRONTEND (React aplikacija)
│   ├── public/
│   │   ├── index.html          ← naslov "Izletko", favicon
│   │   └── favicon.svg         ← ikona kompasa
│   └── src/
│       ├── firebase.js         ← inicializacija SDK + povezava z emulatorji
│       ├── AuthContext.js      ← globalni React Context za prijavljenega uporabnika
│       ├── App.js              ← routing, navigacija, profilni dropdown
│       ├── App.css             ← celoten dizajn (dark tema, CSS spremenljivke)
│       ├── index.css           ← globalne pisave (Plus Jakarta Sans, Inter)
│       └── pages/
│           ├── LoginPage.js            ← prijava
│           ├── RegisterPage.js         ← registracija
│           ├── TripRegistrationPage.js ← prijava na izlet (user)
│           ├── MyRegistrationsPage.js  ← moje prijave + upload dokumenta (user)
│           ├── NotificationsPage.js    ← obvestila (user vidi svoja, admin vsa)
│           ├── CreateTripPage.js       ← ustvarjanje izleta (admin)
│           ├── AllTripsPage.js         ← pregled in urejanje izletov (admin)
│           └── AdminPage.js            ← upravljanje prijav + orodja (admin)
│
├── firestore.rules             ← varnostna pravila za Firestore
├── storage.rules               ← varnostna pravila za Storage
├── firebase.json               ← konfiguracija emulatorjev
└── .firebaserc                 ← Firebase projekt ID
```

---

## 4. Zakaj serverless?

Sistem je primeren za serverless FaaS ker:

- **Dogodki so občasni in asinhroni** – ni smiselno imeti strežnika ki čaka 24/7
- **Avtomatsko skaliranje** – ob šolskem vpisu pride 100 prijav hkrati → funkcije se skalirajo same
- **Plačilo po uporabi** – šola plača samo ko se funkcija dejansko izvede
- **Ni upravljanja strežnikov** – ni patchanja OS, loadbalancerjev, SSL certifikatov
- **Triggerji** – vsak del sistema reagira na svoje specifične dogodke neodvisno

---

## 5. Avtentikacija in avtorizacija

### Kako deluje Firebase Authentication

Firebase Authentication skrbi za celoten življenjski cikel identitete:

```
Uporabnik vnese email + geslo
        ↓
Firebase Auth strežnik preveri kredenciale
        ↓
Vrne JWT ID token (podpisan, velja 60 minut)
        ↓
SDK token shrani v brskalnik in ga samodejno osvežuje
        ↓
Ob vsakem klicu onCall funkcije → SDK token doda v HTTP header
        ↓
Firebase Functions SDK token preveri → request.auth je izpolnjen
```

**Ti tokena nikoli ne vidiš ali upravljaš** – Firebase SDK to naredi samodejno.

### Implementacija v kodi

**Frontend – prijava/registracija** (`frontend/src/pages/LoginPage.js`, `RegisterPage.js`):
```js
// Prijava
await signInWithEmailAndPassword(auth, email, password);

// Registracija
await createUserWithEmailAndPassword(auth, email, password);
```

**Frontend – sledenje stanju prijave** (`frontend/src/AuthContext.js`):
```js
onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
        const tokenResult = await firebaseUser.getIdTokenResult();
        setRole(tokenResult.claims.role || null); // prebere custom claim iz JWT
        setUser(firebaseUser);
    }
});
```

`AuthContext.js` je React Context – globalna shramba ki vsaki komponenti v aplikaciji
omogoča dostop do `user` in `role` brez podvajanja kode.

**Backend – zavarovanje funkcij** (`functions/index.js`):
```js
exports.createTripRegistration = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Uporabnik mora biti prijavljen.");
    }
    // request.auth.uid    → UID prijavljenega uporabnika
    // request.auth.token  → dekodirani JWT z vsemi claims
});
```

### Custom Claims – vloge (roles)

JWT token normalno vsebuje samo `uid` in `email`. Mi dodamo polje `role`:

```json
{
  "uid": "abc123",
  "email": "admin@izleti.si",
  "role": "admin"
}
```

**Nastavitev vloge** (samo Admin SDK, samo backend):
```js
// functions/index.js – setUserRole
await admin.auth().setCustomUserClaims(user.uid, { role });
```

Vloge: `admin`, `traveler`, `guide`

**Preverjanje vloge na backenddu:**
```js
function requireRole(request, allowedRoles) {
    const role = request.auth.token.role; // iz JWT – zaupanja vreden
    if (!allowedRoles.includes(role)) {
        throw new HttpsError("permission-denied", "Dostop zavrnjen.");
    }
}

// Uporaba:
exports.processTripRegistrationSecure = onCall(async (request) => {
    requireRole(request, ["admin"]); // samo admin pride naprej
});
```

**Preverjanje vloge na frontenddu** (`frontend/src/App.js`):
```js
// Zaščita poti
function ProtectedRoute({ children, adminOnly = false }) {
    const { user, role } = useAuth();
    if (!user) return <Navigate to="/prijava" />;
    if (adminOnly && role !== "admin") return <Navigate to="/moje-prijave" />;
    return children;
}
```

**Firestore varnostna pravila** (`firestore.rules`):
```js
match /tripRegistrations/{id} {
    allow read: if request.auth != null &&
        (resource.data.userId == request.auth.uid ||
         request.auth.token.role == 'admin');
    allow update: if request.auth != null &&
        request.auth.token.role == 'admin';
}
```

### Trislojno varovanje

```
Sloj 1: Frontend  → zaščitene poti (ProtectedRoute), vloge v UI
Sloj 2: Backend   → request.auth preverjanje v vsaki funkciji
Sloj 3: Firestore → varnostna pravila blokirajo neposreden dostop do baze
```

---

## 6. Implementirani dogodki (eventi)

Naloga zahteva vsaj 4 različne tipe eventov. Implementiranih je **5 različnih tipov**.

---

### EVENT 1 – Uporabniški dogodki

**Kaj:** Akcije ki jih sproži prijavljeni uporabnik ali administrator.

| Funkcija | Tip | Opis |
|---|---|---|
| `createTripRegistration` | `onCall` | Uporabnik se prijavi na izlet |
| `processTripRegistrationSecure` | `onCall` | Admin odobri ali zavrne prijavo |
| `setUserRole` | `onRequest` | Nastavi vlogo uporabnika (admin akcija) |
| `testLogin` | `onRequest` | Generira custom token za testiranje |
| `healthCheck` | `onRequest` | Preveri ali sistem deluje |

**Zakaj onCall in ne onRequest za registracijo?**
`onCall` samodejno preverja Firebase Auth token – ni potrebe po ročnem parsanju headerjev.

---

### EVENT 2 – Podatkovne spremembe (Firestore Triggers)

**Kaj:** Funkcije ki se sprožijo samodejno ob spremembi dokumenta v Firestore bazi.

| Funkcija | Trigger | Kdaj se sproži |
|---|---|---|
| `onTripRegistrationCreated` | `onDocumentCreated` | Ko se ustvari nova prijava (INSERT) |
| `onTripRegistrationUpdated` | `onDocumentUpdated` | Ko se status prijave spremeni (UPDATE) |

**Primer – `onTripRegistrationCreated`:**
```js
exports.onTripRegistrationCreated = onDocumentCreated(
    "tripRegistrations/{registrationId}",
    async (event) => {
        const data = event.data.data();
        await db.collection("notifications").add({
            type: "NEW_REGISTRATION",
            userId: data.userId,
            message: `Nova prijava: ${data.travelerName} za izlet ${data.tripName}`,
        });
    }
);
```

Ko frontend doda dokument v `tripRegistrations` → Firestore samodejno sproži funkcijo → brez dodatnega klica API-ja.

---

### EVENT 3 – Shramba in datoteke (Storage Trigger)

**Kaj:** Funkcija ki se sproži ob nalaganju datoteke v Firebase Storage.

| Funkcija | Trigger | Kdaj se sproži |
|---|---|---|
| `onTripDocumentUploaded` | `onObjectFinalized` | Ko udeleženec naloži dokument v `trip-documents/` |

**Pot v Storagu:** `trip-documents/{registrationId}/{fileName}`

Trigger ob uploadu:
1. Preveri ali registracija obstaja
2. Ustvari zapis v `storageDocuments`
3. Posodobi prijavo: `documentsUploaded: true`
4. Ustvari obvestilo

> **Opomba:** V emulatorju Storage trigger ni vedno zanesljiv, zato frontend po uspešnem
> uploadu Firestore posodobi direktno. V produkciji trigger deluje zanesljivo.

---

### EVENT 4 – Sporočila in obveščanje (Google Pub/Sub)

**Kaj:** Google Pub/Sub je sistem za upravljanje vrst sporočil (message queue) – Googlov ekvivalent Amazon SQS, Apache Kafka ali RabbitMQ.

| Funkcija | Tip | Opis |
|---|---|---|
| `publishTripEvent` | `onRequest` | Objavi sporočilo na Pub/Sub topic |
| `onTripEventPublished` | `onMessagePublished` | Posluša topic in obdela sporočilo |

**Topic:** `trip-events`

**Zakaj Pub/Sub in ne direktni klic?**
Ko uporabnik odda prijavo, `createTripRegistration` objavi sporočilo na Pub/Sub.
`onTripEventPublished` ga prejme in pošlje potrditveni email. Prednosti:
- Prijava se shrani takoj, email se pošlje asinhrono
- Če email ne uspe, prijava ni pokvarjena
- Sistem za email je neodvisen od sistema za registracije

**Celoten tok Pub/Sub + email:**
```
createTripRegistration (onCall)
    ↓ publishMessage({ eventType: "REGISTRATION_CONFIRMED", email, ... })
Pub/Sub topic "trip-events"
    ↓
onTripEventPublished (trigger)
    ↓ sendRegistrationEmail() → Nodemailer → Ethereal SMTP
Email je poslan → previewUrl shranjen v notifications
```

**Nodemailer + Ethereal** – testni SMTP strežnik ki ujame email brez dejanskega pošiljanja.
Preview URL se pojavi v obvestilih in v emulator logih.

---

### EVENT 5 – Časovni dogodki (Scheduled Functions)

**Kaj:** Funkcija ki se sproži samodejno po urniku (cron job).

| Funkcija | Urnik | Opis |
|---|---|---|
| `dailyMissingDocumentsReminder` | Vsak dan ob 08:00 | Preveri vse prijave brez dokumentov |
| `runDailyReminderCheckNow` | `onRequest` (ročni sprožilec) | Isto kot zgoraj, za testiranje |

```js
exports.dailyMissingDocumentsReminder = onSchedule("every day 08:00", async () => {
    const remindersCreated = await checkMissingDocuments();
});
```

`checkMissingDocuments()` pregleda vse aktivne prijave – tiste brez `documentsUploaded: true`
dobijo obvestilo z `userId` → uporabnik ga vidi pri sebi v Obvestilih.

---

## 7. Vse Cloud Functions

| Funkcija | Tip triggera | Event kategorija | Vloga |
|---|---|---|---|
| `healthCheck` | HTTP GET | Uporabniški | Status sistema |
| `setUserRole` | HTTP POST | Uporabniški | Nastavi custom claim vlogo |
| `testLogin` | HTTP GET/POST | Uporabniški | Generira testni token |
| `createTripRegistration` | onCall (zaščiten) | Uporabniški | Registracija na izlet + Pub/Sub |
| `processTripRegistrationSecure` | onCall (admin) | Uporabniški | Odobritev/zavrnitev prijave |
| `publishTripEvent` | HTTP POST | Messaging | Objava na Pub/Sub topic |
| `runDailyReminderCheckNow` | HTTP GET | Časovni (ročni) | Ročni sprožilec opomnika |
| `onTripRegistrationCreated` | Firestore CREATE | Podatkovne spremembe | Obvestilo ob novi prijavi |
| `onTripRegistrationUpdated` | Firestore UPDATE | Podatkovne spremembe | Obvestilo ob spremembi statusa |
| `onTripDocumentUploaded` | Storage FINALIZE | Shramba | Obdelava uploadanega dokumenta |
| `onTripEventPublished` | Pub/Sub | Messaging | Pošiljanje emaila |
| `dailyMissingDocumentsReminder` | Scheduled (cron) | Časovni | Dnevni opomnik za dokumente |

---

## 8. Firestore podatkovni model

### Kolekcija: `trips`
Izleti ki jih ustvari administrator.
```
{
  name: "Triglav – poletna tura",
  destination: "Triglav, Slovenija",
  date: "2026-07-15",
  description: "...",
  maxParticipants: 30,
  active: true,
  createdBy: "uid_admina",
  createdAt: Timestamp
}
```

### Kolekcija: `tripRegistrations`
Prijave udeležencev na izlete.
```
{
  userId: "uid_uporabnika",
  tripName: "Triglav – poletna tura",
  travelerName: "Jana Novak",
  email: "jana@example.com",
  group: "—",
  status: "pending" | "approved" | "rejected" | "cancelled",
  documentsUploaded: true | false,
  documentsUpdatedAt: Timestamp,
  processedAt: Timestamp,
  createdAt: Timestamp
}
```

### Kolekcija: `notifications`
Obvestila za uporabnike in sistem.
```
{
  type: "NEW_REGISTRATION" | "STATUS_CHANGED" | "MISSING_DOCUMENTS" |
        "STORAGE_DOCUMENT_UPLOADED" | "EMAIL_SENT" | "PUBSUB_EVENT_PROCESSED",
  message: "Besedilo obvestila",
  registrationId: "id_prijave",
  userId: "uid_uporabnika" | null,  // null = sistemsko obvestilo (admin)
  read: false,
  previewUrl: "https://ethereal.email/...",  // samo za EMAIL_SENT
  createdAt: Timestamp
}
```

> `userId` je ključno polje – user vidi samo obvestila kjer `userId == user.uid`,
> admin vidi vsa. Vsak označi kot prebrano samo svoja.

### Kolekcija: `storageDocuments`
Metapodatki o naloženih dokumentih.
```
{
  registrationId: "id_prijave",
  fileName: "prijavnica.pdf",
  storagePath: "trip-documents/{registrationId}/prijavnica.pdf",
  downloadUrl: "https://...",
  contentType: "application/pdf",
  uploadedAt: Timestamp,
  verified: false
}
```

### Kolekcija: `users`
Uporabniške vloge (sinhronizirano s custom claims).
```
{ email, role: "admin" | "traveler" | "guide", updatedAt }
```

### Kolekcija: `eventLogs`
Sistemski logi Pub/Sub ereignisse.
```
{ source: "PUBSUB", eventType, registrationId, createdAt, processed: true }
```

---

## 9. Frontend – React spletni vmesnik

### Tehnologije

| Datoteka/lib | Namen |
|---|---|
| `React 18` | UI framework |
| `react-router-dom` | Klientsko usmerjanje (SPA routing) |
| `Firebase JS SDK` | Komunikacija z Auth, Firestore, Functions, Storage |
| `Plus Jakarta Sans` | Display pisava (naslovi) |
| `Inter` | Body pisava |

### Ključne datoteke

**`frontend/src/firebase.js`** – inicializacija in povezava z emulatorji:
```js
export const auth      = getAuth(app);
export const db        = getFirestore(app);
export const functions = getFunctions(app);
export const storage   = getStorage(app);

connectAuthEmulator(auth, "http://127.0.0.1:9099");
connectFirestoreEmulator(db, "127.0.0.1", 8081);
connectFunctionsEmulator(functions, "127.0.0.1", 5001);
connectStorageEmulator(storage, "127.0.0.1", 9199);
```

**`frontend/src/AuthContext.js`** – globalni React Context:
Vsa stran ve kdo je prijavljen in kakšno vlogo ima, brez podvajanja kode.
Prebere `role` iz JWT custom claim ob vsakem spremenjenem auth stanju.

### Strani in vloge

| Stran | Pot | Dostop | Opis |
|---|---|---|---|
| Login | `/prijava` | Javna | Email/password prijava |
| Registracija | `/registracija` | Javna | Nov račun |
| Prijava na izlet | `/prijava-na-izlet` | User | Forma → `createTripRegistration` (onCall) |
| Moje prijave | `/moje-prijave` | User | Pregled + upload dokumenta + odpoved |
| Obvestila | `/obvestila` | Oba | Filtrirana po vlogi + mark all read |
| Ustvari izlet | `/ustvari-izlet` | Admin | Forma → Firestore `trips` |
| Vsi izleti | `/vsi-izleti` | Admin | Grid kartic + uredi + aktivacija |
| Prijave | `/admin` | Admin | Upravljanje prijav + sistemska orodja |

### Komunikacija frontend ↔ backend

```js
// 1. Callable funkcija (z avtentikacijo)
const fn = httpsCallable(functions, "createTripRegistration");
const result = await fn({ tripName, travelerName, email });

// 2. HTTP funkcija (ročni sprožilci)
const res = await fetch("http://127.0.0.1:5001/.../runDailyReminderCheckNow");

// 3. Firestore realtime (onSnapshot – brez klica API)
onSnapshot(query(collection(db, "notifications"), ...), (snap) => {
    setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() })));
});

// 4. Storage upload
const storageRef = ref(storage, `trip-documents/${regId}/${file.name}`);
await uploadBytes(storageRef, file);
const url = await getDownloadURL(storageRef);
```

### Dizajn sistem

- **Tema:** Dark, topla (`#0e0d0b` ozadje z amber/warm akcenti)
- **CSS spremenljivke:** Celoten dizajn temelji na `:root` spremenljivkah
- **Micro-interactions:** `transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1)` povsod
- **Responsive:** Prilagojeno za manjše zaslone (`@media max-width: 600px`)

---

## 10. Izpolnjene zahteve naloge

### Naloga 9 – Brezstrežniški zaledni sistem (FaaS)

| Zahteva naloge | Implementacija | Datoteka |
|---|---|---|
| **≥ 5 glavnih funkcionalnosti** | Registracija, odobritev, dokumenti, obvestila, opomniki, Pub/Sub+email | `functions/index.js` |
| **Avtentikacija** | Firebase Auth, JWT tokeni, email/password | `functions/index.js`, `firestore.rules` |
| **Zavarovanje funkcij** | `request.auth` preverjanje, `requireRole()` | `functions/index.js` vrstica 117, 179 |
| **Uporabniški dogodki** | `createTripRegistration`, `processTripRegistrationSecure`, `setUserRole` | `functions/index.js` |
| **Podatkovne spremembe** | `onTripRegistrationCreated`, `onTripRegistrationUpdated` | `functions/index.js` vrstica 164, 188 |
| **Shramba in datoteke** | `onTripDocumentUploaded` – Storage trigger ob uploadu | `functions/index.js` vrstica 453 |
| **Sporočila in obveščanje** | Google Pub/Sub – `publishTripEvent` + `onTripEventPublished` + email | `functions/index.js` vrstica 377, 404 |
| **Časovni dogodki** | `dailyMissingDocumentsReminder` – cron vsak dan ob 8:00 | `functions/index.js` vrstica 311 |
| **Uvedba in zagon** | Firebase Emulator Suite | `firebase.json` |
| **Testiranje** | Postman za HTTP in onCall funkcije | – |

### Naloga 10 – Frontend

| Zahteva naloge | Implementacija | Datoteka |
|---|---|---|
| **Spletni vmesnik** | React SPA z routing, dark dizajnom | `frontend/src/` |
| **Povezava z backendom** | Firebase JS SDK (Auth, Firestore, Functions, Storage) | `frontend/src/firebase.js` |
| **API klici** | `httpsCallable`, `onSnapshot`, `uploadBytes`, `fetch` | vse `pages/` datoteke |
| **Avtentikacija v UI** | Login/Register strani, zaščitene poti, profilni dropdown | `App.js`, `AuthContext.js` |
| **Vloge v UI** | Admin in user vidita drugačno navigacijo in funkcionalnosti | `App.js` |

---

## 11. Zagon in testiranje

### Zagon lokalnega okolja

**Terminal 1 – backend emulatorji:**
```bash
firebase emulators:start --import=./emulator-data --export-on-exit
```

Dostopno na:
- Emulator UI: `http://localhost:4000`
- Functions: `http://localhost:5001`
- Firestore: `http://localhost:8081`
- Auth: `http://localhost:9099`
- Storage: `http://localhost:9199`
- Pub/Sub: `http://localhost:8085`

**Terminal 2 – frontend:**
```bash
cd frontend
npm start
# → http://localhost:3000
```

### Nastavitev admin vloge (enkrat ob prvem zagonu)

```bash
# Postman ali curl:
POST http://localhost:5001/organizacija-izletov/us-central1/setUserRole
Body: { "email": "admin@test.com", "role": "admin" }
```

Po nastavitvi je potrebna ponovna prijava (token se osveži).

### Testiranje HTTP funkcij s Postmanom

```
GET  http://localhost:5001/organizacija-izletov/us-central1/healthCheck
POST http://localhost:5001/organizacija-izletov/us-central1/setUserRole
GET  http://localhost:5001/organizacija-izletov/us-central1/runDailyReminderCheckNow
POST http://localhost:5001/organizacija-izletov/us-central1/publishTripEvent
     Body: { "registrationId": "test-id", "eventType": "TEST_EVENT" }
```

### Testiranje onCall funkcij s Postmanom

```
POST http://localhost:5001/organizacija-izletov/us-central1/createTripRegistration
Headers:
  Content-Type: application/json
Body:
{
  "data": {
    "tripName": "Triglav",
    "travelerName": "Jana Novak",
    "email": "jana@test.com",
    "group": "—"
  }
}
```

> Za onCall funkcije ki zahtevajo auth je potreben Firebase ID token v headerju.
> Pridobi ga z `testLogin` endpointom.

---

## 12. Celotni event-driven tokovi

### Tok 1: Prijava na izlet + potrditveni email

```
[USER] Izpolni formo → klikne "Oddaj prijavo"
        ↓
createTripRegistration (onCall – preverjena identiteta)
        ├─ Shrani v Firestore (tripRegistrations)
        └─ Pub/Sub publishMessage({ eventType: "REGISTRATION_CONFIRMED" })
                ↓
        onTripRegistrationCreated (Firestore trigger)
                └─ Ustvari notification { type: "NEW_REGISTRATION", userId }
                ↓
        onTripEventPublished (Pub/Sub trigger)
                ├─ sendRegistrationEmail() → Nodemailer → Ethereal
                └─ Ustvari notification { type: "EMAIL_SENT", previewUrl }
                        ↓
        [USER] vidi pikico na Obvestilih → odpre email preview
```

### Tok 2: Admin odobritev/zavrnitev

```
[ADMIN] Odpre razširjeno prijavo → klikne "Odobri"
        ↓
processTripRegistrationSecure (onCall – samo admin vloga)
        └─ Posodobi status v Firestore
                ↓
        onTripRegistrationUpdated (Firestore trigger)
                └─ Ustvari notification { type: "STATUS_CHANGED", userId }
                        ↓
        [USER] vidi obvestilo "Status vaše prijave je spremenjen"
```

### Tok 3: Upload dokumenta

```
[USER] Izbere datoteko → klikne "Izberi datoteko"
        ↓
Frontend: uploadBytes(storage, "trip-documents/{id}/{file}")
        ↓
        ├─ getDownloadURL() → downloadUrl
        ├─ addDoc(storageDocuments, { fileName, downloadUrl, ... })
        ├─ updateDoc(tripRegistrations, { documentsUploaded: true })
        └─ addDoc(notifications, { type: "STORAGE_DOCUMENT_UPLOADED", userId })
                ↓
        [ADMIN] vidi "Dokument ✓" badge + download link v razširjeni prijavi
        [ADMIN] gumb "Odobri" se odklene (prej onemogočen)
```

### Tok 4: Dnevni opomnik za manjkajoče dokumente

```
Cron: vsak dan ob 08:00 (ali ročno: GET /runDailyReminderCheckNow)
        ↓
dailyMissingDocumentsReminder (onSchedule)
        └─ checkMissingDocuments()
                ↓ za vsako prijavo kjer documentsUploaded !== true
                └─ addDoc(notifications, { type: "MISSING_DOCUMENTS", userId })
                        ↓
        [USER] vidi opomnik "Za izlet X še niste naložili dokumentov"
```

### Tok 5: Pub/Sub test (admin orodje)

```
[ADMIN] Klikne "Objavi Pub/Sub" v Sistemskih orodjih
        ↓
POST /publishTripEvent { registrationId, eventType: "MANUAL_ADMIN_TRIGGER" }
        ↓
Pub/Sub topic "trip-events"
        ↓
onTripEventPublished
        ├─ addDoc(eventLogs, { source: "PUBSUB", eventType })
        └─ addDoc(notifications, { type: "PUBSUB_EVENT_PROCESSED" })
```

---

*Izletko – Organizacija izletov | FaaS z Firebase Cloud Functions + React*
