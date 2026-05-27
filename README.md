# Organizacija izletov – Serverless backend sistem (FaaS)

## Opis projekta

Projekt predstavlja brezstrežniški ("serverless") zaledni sistem za organizacijo šolskih izletov in upravljanje prijav potnikov. Sistem je implementiran z uporabo:

- Firebase Cloud Functions (FaaS)
- Firebase Firestore (BaaS / NoSQL baza)
- Firebase Authentication
- Firebase Storage
- Google Pub/Sub
- Firebase Emulator Suite

Cilj projekta je prikazati uporabo različnih vrst dogodkov (eventov) v FaaS arhitekturi ter implementirati varen in event-driven backend sistem brez upravljanja lastnih strežnikov.

---

# Ideja sistema

Sistem omogoča:
- prijavo uporabnikov na izlete,
- administrativno odobritev prijav,
- nalaganje dokumentov,
- avtomatsko ustvarjanje obvestil,
- dnevne opomnike za manjkajoče dokumente,
- obdelavo dogodkov preko Pub/Sub messaging sistema.

Celoten sistem temelji na event-driven arhitekturi:
- uporabniški dogodki,
- spremembe v podatkovni bazi,
- scheduled dogodki,
- Pub/Sub messaging dogodki,
- Storage dogodki.

---

# Zakaj je sistem primeren za serverless arhitekturo?

Sistem je zelo primeren za serverless/FaaS pristop, ker:
- funkcije tečejo samo ob dogodkih,
- ni potrebe po stalno delujočem strežniku,
- dogodki se pojavljajo občasno in asinhrono,
- sistem uporablja veliko triggerjev,
- avtomatsko skaliranje omogoča obdelavo več prijav hkrati,
- plačilo bi v realnem okolju potekalo po dejanski uporabi funkcij.

---

# Uporabljene tehnologije

| Tehnologija | Namen |
|---|---|
| Firebase Cloud Functions | FaaS funkcije |
| Firestore | NoSQL baza podatkov |
| Firebase Authentication | prijava uporabnikov |
| Firebase Storage | nalaganje dokumentov |
| Google Pub/Sub | messaging sistem |
| Firebase Emulator Suite | lokalno testiranje |
| Postman | testiranje endpointov |

---

# Glavne funkcionalnosti sistema

## 1. Registracija uporabnika na izlet
Uporabnik odda prijavo na izlet preko zaščitene callable funkcije.

Funkcija:

```text
createTripRegistration
```

Ob oddaji:
- se ustvari Firestore dokument,
- sproži se Firestore trigger,
- ustvari se notification.

---

## 2. Administrativna odobritev/zavrnitev prijave
Administrator lahko prijavo:
- odobri,
- zavrne.

Funkcija:

```text
processTripRegistrationSecure
```

Funkcija uporablja:
- authentication,
- role-based authorization,
- custom claims.

---

## 3. Notification sistem
Sistem avtomatsko ustvarja obvestila ob:
- novi prijavi,
- spremembi statusa,
- nalaganju dokumentov,
- Pub/Sub dogodkih,
- manjkajočih dokumentih.

Collection:

```text
notifications
```

---

## 4. Dnevni scheduled reminderji
Scheduled funkcija dnevno preverja:
- ali imajo potniki naložene dokumente.

Funkcija:

```text
dailyMissingDocumentsReminder
```

Če dokumenti manjkajo:
- se avtomatsko ustvari notification.

---

## 5. Nalaganje dokumentov
Uporabnik naloži dokument v Firebase Storage.

Storage trigger:

```text
onTripDocumentUploaded
```

Ob uploadu:
- se ustvari zapis v Firestore,
- prijava se označi kot dokumentirana,
- ustvari se notification.

---

## 6. Pub/Sub messaging sistem
Sistem uporablja Pub/Sub za asinhrono obdelavo dogodkov.

Funkcije:

```text
publishTripEvent
onTripEventPublished
```

Pub/Sub:
- objavi sporočilo,
- background trigger obdela dogodek,
- ustvari log in notification.

---

# Implementirani eventi

## 1. Uporabniški dogodki
Dogodek:

```text
Uporabnik odda prijavo na izlet
```

Funkcija:

```text
createTripRegistration
```

Pokrita zahteva:

```text
Uporabniški dogodki
```

---

## 2. Podatkovne spremembe
Firestore triggerji:

```text
onTripRegistrationCreated
onTripRegistrationUpdated
```

Sprožijo se ob:
- INSERT,
- UPDATE.

Pokrita zahteva:

```text
Podatkovne spremembe
```

---

## 3. Storage dogodki
Storage trigger:

```text
onTripDocumentUploaded
```

Sproži se ob:

```text
upload datoteke v Firebase Storage
```

Pokrita zahteva:

```text
Shramba in datoteke
```

---

## 4. Messaging dogodki
Pub/Sub trigger:

```text
onTripEventPublished
```

Sproži se ob:

```text
prejemu Pub/Sub sporočila
```

Pokrita zahteva:

```text
Sporočila in obveščanje
```

---

## 5. Časovni dogodki
Scheduled funkcija:

```text
dailyMissingDocumentsReminder
```

Sproži se:

```text
vsak dan ob 08:00
```

Pokrita zahteva:

```text
Časovni dogodki
```

---

# Authentication in Authorization

## Authentication
Sistem uporablja:

```text
Firebase Authentication
```

Zaščitene callable funkcije preverjajo:

```js
if (!request.auth)
```

S tem zagotovimo:
- da so uporabniki prijavljeni,
- da anonimni dostop ni mogoč.

---

## Authorization (role-based access)
Sistem uporablja:

```text
custom claims
```

Vloge:
- admin
- traveler
- guide

Pomožna funkcija:

```text
requireRole()
```

Primer:

```text
Samo admin lahko odobri prijavo.
```

---

# Event-driven flow sistema

## Flow registracije

```text
Uporabnik odda prijavo
        ↓
createTripRegistration
        ↓
Firestore INSERT
        ↓
onTripRegistrationCreated
        ↓
notification created
```

---

## Flow admin approval

```text
Admin odobri prijavo
        ↓
processTripRegistrationSecure
        ↓
Firestore UPDATE
        ↓
onTripRegistrationUpdated
        ↓
notification created
```

---

## Flow nalaganja dokumenta

```text
Upload datoteke v Storage
        ↓
onTripDocumentUploaded
        ↓
storageDocuments zapis
        ↓
tripRegistrations update
        ↓
notification created
```

---

## Flow Pub/Sub messaging

```text
publishTripEvent
        ↓
Pub/Sub topic
        ↓
onTripEventPublished
        ↓
eventLogs zapis
        ↓
notification created
```

---

## Flow scheduled reminderjev

```text
dailyMissingDocumentsReminder
        ↓
pregled prijav
        ↓
manjkajoči dokumenti
        ↓
notification created
```

---

# Firestore kolekcije

| Kolekcija | Namen |
|---|---|
| tripRegistrations | prijave na izlete |
| notifications | uporabniška obvestila |
| users | uporabniške vloge |
| storageDocuments | naloženi dokumenti |
| eventLogs | sistemski/event logi |

---

# Razlika med notifications in eventLogs

## notifications
Predstavljajo:

```text
poslovna obvestila uporabnikom
```

Primer:
- nova prijava,
- status odobren,
- dokument naložen.

---

## eventLogs
Predstavljajo:

```text
tehnične sistemske dogodke
```

Uporabljajo se za:
- debugging,
- auditing,
- analytics,
- spremljanje Pub/Sub dogodkov.

---

# Emulatorji

Uporabljeni emulatorji:
- Authentication Emulator
- Functions Emulator
- Firestore Emulator
- Pub/Sub Emulator
- Storage Emulator

Zagon:

```bash
firebase emulators:start
```

---

# Testiranje

Sistem je bil testiran z uporabo:

```text
Postman
```

Testirane so bile:
- HTTP funkcije,
- callable funkcije,
- auth tokeni,
- role-based authorization,
- Pub/Sub messaging,
- scheduled funkcije,
- Storage upload triggerji.

---

# Izpolnjene zahteve naloge

| Zahteva | Status |
|---|---|
| FaaS funkcije | ✅ |
| Firebase/serverless arhitektura | ✅ |
| Vsaj 5 funkcionalnosti | ✅ |
| Authentication | ✅ |
| Zavarovane funkcije | ✅ |
| Uporabniški dogodki | ✅ |
| Podatkovne spremembe | ✅ |
| Storage dogodki | ✅ |
| Messaging/PubSub dogodki | ✅ |
| Časovni dogodki | ✅ |
| Event-driven arhitektura | ✅ |
| Emulatorji | ✅ |
| Postman testiranje | ✅ |

---

# Zaključek

Projekt uspešno demonstrira uporabo:
- serverless arhitekture,
- event-driven pristopa,
- Firebase Cloud Functions,
- Firestore triggerjev,
- Storage dogodkov,
- Pub/Sub messaging sistema,
- scheduled funkcij,
- authentication in authorization mehanizmov.

Sistem je modularen, skalabilen in primeren za obdelavo asinhronih dogodkov brez potrebe po upravljanju strežniške infrastrukture.

