const { setGlobalOptions } = require("firebase-functions");
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onMessagePublished } = require("firebase-functions/v2/pubsub");
const { PubSub } = require("@google-cloud/pubsub");
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const nodemailer = require("nodemailer");

admin.initializeApp();
const db = admin.firestore();
const pubsub = new PubSub({ projectId: "organizacija-izletov" });
const TRIP_EVENTS_TOPIC = "trip-events";

// Email pomožna funkcija (Ethereal za testiranje) 
async function sendRegistrationEmail({ to, travelerName, tripName, registrationId }) {
    const testAccount = await nodemailer.createTestAccount();

    const transporter = nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        auth: {
            user: testAccount.user,
            pass: testAccount.pass,
        },
    });

    const info = await transporter.sendMail({
        from: '"Organizacija izletov" <noreply@izleti.si>',
        to,
        subject: `Potrditev prijave – ${tripName}`,
        html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#f9f9f7;border-radius:12px;">
                <h2 style="color:#1a1a1a;margin-bottom:8px;">Vaša prijava je bila sprejeta ✓</h2>
                <p style="color:#555;margin-bottom:24px;">Pozdravljeni, ${travelerName}!</p>
                <p style="color:#555;">Uspešno ste se prijavili na izlet <strong>${tripName}</strong>.</p>
                <div style="background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:16px;margin:24px 0;">
                    <p style="margin:0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">ID prijave</p>
                    <p style="margin:4px 0 0;color:#1a1a1a;font-family:monospace;font-size:14px;">${registrationId}</p>
                </div>
                <p style="color:#555;">Naslednji korak: v sistemu naložite zahtevane dokumente.</p>
                <p style="color:#aaa;font-size:12px;margin-top:32px;">© Izleti — avtomatsko sporočilo, ne odgovarjajte</p>
            </div>
        `,
    });

    // Izpis v ui
    logger.info("Email poslan <i>(preview)</i>:", {
        to,
        tripName,
        registrationId,
        previewUrl: nodemailer.getTestMessageUrl(info),
    });

    return nodemailer.getTestMessageUrl(info);
}

setGlobalOptions({ maxInstances: 10 });

// Health check funkcija
exports.healthCheck = onRequest((req, res) => {
    res.status(200).json({
        system: "organizacija-izletov",
        status: "OK",
        message: "Serverless backend deluje.",
    });
});

// User event - nastavitev uporabniške vloge
exports.setUserRole = onRequest(async (req, res) => {
    try {
        const { email, role } = req.body;

        if (!email || !role) {
            res.status(400).json({
                error: "email in role sta obvezna.",
            });
            return;
        }

        if (!["admin", "traveler", "guide"].includes(role)) {
            res.status(400).json({
                error: "Role mora biti admin, traveler ali guide.",
            });
            return;
        }

        const user = await admin.auth().getUserByEmail(email);

        await admin.auth().setCustomUserClaims(user.uid, {
            role,
        });

        await db.collection("users").doc(user.uid).set({
            email,
            role,
            updatedAt: new Date(),
        });

        res.status(200).json({
            message: `Vloga ${role} je bila nastavljena za ${email}.`,
            uid: user.uid,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: error.message,
        });
    }
});

// User event - prijava na izlet
exports.createTripRegistration = onCall(async (request) => {
    if (!request.auth) { // AVTENTIKACIJA
        throw new HttpsError("unauthenticated", "Uporabnik mora biti prijavljen.");
    }

    const { tripName, travelerName, email, group } = request.data;

    if (!tripName || !travelerName || !email || !group) {
        throw new HttpsError("invalid-argument", "Manjkajo obvezni podatki.");
    }

    const registration = {
        userId: request.auth.uid,
        tripName,
        travelerName,
        email,
        group,
        status: "pending",
        createdAt: new Date(),
    };

    const docRef = await db.collection("tripRegistrations").add(registration);

    // Objavi na Pub/Sub - sproži pošiljanje emaila
    try {
        const topic = await ensureTopicExists(TRIP_EVENTS_TOPIC);
        await topic.publishMessage({
            json: {
                eventType: "REGISTRATION_CONFIRMED",
                registrationId: docRef.id,
                email,
                travelerName,
                tripName,
                createdAt: new Date().toISOString(),
            },
        });
        logger.info("Pub/Sub sporočilo objavljeno za novo prijavo:", docRef.id);
    } catch (pubsubError) {
        logger.warn("Pub/Sub objava ni uspela:", pubsubError.message);
    }

    return {
        message: "Prijava na izlet je bila uspešno oddana.",
        registrationId: docRef.id,
    };
});

// Firestore trigger - nova prijava
exports.onTripRegistrationCreated = onDocumentCreated(
    "tripRegistrations/{registrationId}",
    async (event) => {
        const data = event.data.data();

        logger.info("Nova prijava na izlet:", {
            registrationId: event.params.registrationId,
            tripName: data.tripName,
            travelerName: data.travelerName,
            group: data.group,
        });

        await db.collection("notifications").add({
            type: "NEW_REGISTRATION",
            message: `Nova prijava: ${data.travelerName} za izlet ${data.tripName}`,
            registrationId: event.params.registrationId,
            userId: data.userId || null,
            createdAt: new Date(),
            read: false,
        });
    }
);

// Firestore trigger - sprememba statusa prijave
exports.onTripRegistrationUpdated = onDocumentUpdated(
    "tripRegistrations/{registrationId}",
    async (event) => {
        const before = event.data.before.data();
        const after = event.data.after.data();

        if (before.status === after.status) {
            return;
        }

        logger.info("Status prijave spremenjen:", {
            registrationId: event.params.registrationId,
            beforeStatus: before.status,
            afterStatus: after.status,
        });

        await db.collection("notifications").add({
            type: "STATUS_CHANGED",
            message: `Status vaše prijave za izlet ${after.tripName} je spremenjen iz "${before.status}" v "${after.status}".`,
            registrationId: event.params.registrationId,
            userId: after.userId || null,
            createdAt: new Date(),
            read: false,
        });
    }
);

// User event - funkcija za prijavo (generiranje custom tokena)
exports.testLogin = onRequest(async (req, res) => {
    try {
        const email = req.query.email || req.body.email;

        if (!email) {
            res.status(400).json({
                error: "Email je obvezen. Uporabi ?email=admin@example.com ali body."
            });
            return;
        }

        const user = await admin.auth().getUserByEmail(email);
        const customToken = await admin.auth().createCustomToken(user.uid);

        res.status(200).json({
            uid: user.uid,
            email,
            token: customToken,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: error.message,
        });
    }
});

// AVTENTIKCIJA - Pomožna funkcija za preverjanje uporabniške vloge
function requireRole(request, allowedRoles) {
    if (!request.auth) { // AVTENTIKACIJA
        throw new HttpsError("unauthenticated", "Uporabnik mora biti prijavljen.");
    }

    const role = request.auth.token.role; // AVTORIZACIJA - preverjanje vloge iz custom claimsa

    if (!allowedRoles.includes(role)) {
        throw new HttpsError(
            "permission-denied",
            `Dostop dovoljen samo vlogam: ${allowedRoles.join(", ")}.`
        );
    }

    return role;
}

// User event - Admin potrdi ali zavrne prijavo
exports.processTripRegistrationSecure = onCall(async (request) => {
    requireRole(request, ["admin"]);

    const { registrationId, action } = request.data;

    if (!registrationId || !action) {
        throw new HttpsError(
            "invalid-argument",
            "registrationId in action sta obvezna."
        );
    }

    if (action !== "approve" && action !== "reject") {
        throw new HttpsError(
            "invalid-argument",
            "Action mora biti approve ali reject."
        );
    }

    const registrationRef = db.collection("tripRegistrations").doc(registrationId);
    const doc = await registrationRef.get();

    if (!doc.exists) {
        throw new HttpsError("not-found", "Prijava ne obstaja.");
    }

    await registrationRef.update({
        status: action === "approve" ? "approved" : "rejected",
        processedAt: new Date(),
    });

    return {
        message: action === "approve" ? "Prijava odobrena." : "Prijava zavrnjena.",
        registrationId,
    };
});

// Pomožna funkcija za preverjanje manjkajočih dokumentov in ustvarjanje opomnikov
async function checkMissingDocuments() {
    const snapshot = await db.collection("tripRegistrations").get();

    let remindersCreated = 0;

    for (const doc of snapshot.docs) {
        const registration = doc.data();

        if (registration.documentsUploaded !== true && registration.status !== "cancelled" && registration.status !== "rejected") {
            await db.collection("notifications").add({
                type: "MISSING_DOCUMENTS",
                message: `Za izlet "${registration.tripName}" še niste naložili zahtevanih dokumentov.`,
                registrationId: doc.id,
                userId: registration.userId || null,
                createdAt: new Date(),
                read: false,
            });

            remindersCreated++;
        }
    }

    return remindersCreated;
}

// Scheduled funkcija - dnevni opomnik za manjkajoče dokumente
exports.dailyMissingDocumentsReminder = onSchedule(
    "every day 08:00",
    async () => {
        const remindersCreated = await checkMissingDocuments();

        logger.info("Dnevni pregled manjkajočih dokumentov zaključen.", {
            remindersCreated,
        });
    }
);

// HTTP test scheduled logike - ročni sprožilec dnevnega preverjanja
exports.runDailyReminderCheckNow = onRequest(async (req, res) => {
    try {
        const remindersCreated = await checkMissingDocuments();

        res.status(200).json({
            message: "Ročni test dnevnega preverjanja je bil izveden.",
            remindersCreated,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: error.message,
        });
    }
});

// Pomožna funkcija za zagotavljanje obstoja Pub/Sub teme
async function ensureTopicExists(topicName) {
    const topic = pubsub.topic(topicName);
    const [exists] = await topic.exists();

    if (!exists) {
        await pubsub.createTopic(topicName);
        logger.info(`Pub/Sub topic created: ${topicName}`);
    }

    return topic;
}

// HTTP objava Pub/Sub sporočila
exports.publishTripEvent = onRequest(async (req, res) => {
    try {
        const { registrationId, eventType } = req.body;

        if (!registrationId || !eventType) {
            res.status(400).json({
                error: "registrationId in eventType sta obvezna.",
            });
            return;
        }

        const topic = await ensureTopicExists(TRIP_EVENTS_TOPIC);

        const messageId = await topic.publishMessage({
            json: {
                registrationId,
                eventType,
                createdAt: new Date().toISOString(),
            },
        });

        res.status(200).json({
            message: "Pub/Sub sporočilo je bilo objavljeno.",
            messageId,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: error.message,
        });
    }
});

// Pub/Sub trigger - obdela sporočilo iz vrste
exports.onTripEventPublished = onMessagePublished(
    TRIP_EVENTS_TOPIC,
    async (event) => {
        const messageData = event.data.message.json;

        logger.info("Prejeto Pub/Sub sporočilo:", messageData);

        // Zapiši v event log
        await db.collection("eventLogs").add({
            source: "PUBSUB",
            eventType: messageData.eventType,
            registrationId: messageData.registrationId,
            createdAt: new Date(),
            processed: true,
        });

        // Pošlji email ob potrditvi prijave
        if (messageData.eventType === "REGISTRATION_CONFIRMED") {
            let previewUrl = null;

            try {
                previewUrl = await sendRegistrationEmail({
                    to: messageData.email,
                    travelerName: messageData.travelerName,
                    tripName: messageData.tripName,
                    registrationId: messageData.registrationId,
                });
            } catch (emailError) {
                logger.error("Pošiljanje emaila ni uspelo:", emailError.message);
            }

            await db.collection("notifications").add({
                type: "EMAIL_SENT",
                message: `Potrditveni email je bil poslan na ${messageData.email} za izlet "${messageData.tripName}".${previewUrl ? ` Preview: ${previewUrl}` : ""}`,
                registrationId: messageData.registrationId,
                userId: messageData.userId || null,
                previewUrl: previewUrl || null,
                createdAt: new Date(),
                read: false,
            });
        } else {
            // Za vse ostale event tipe – splošno obvestilo
            await db.collection("notifications").add({
                type: "PUBSUB_EVENT_PROCESSED",
                message: `Obdelan Pub/Sub dogodek: ${messageData.eventType}`,
                registrationId: messageData.registrationId,
                createdAt: new Date(),
                read: false,
            });
        }
    }
);

// Storage trigger ob nalaganju datoteke v Storage - ustvari zapis in posodobi prijavo
exports.onTripDocumentUploaded = onObjectFinalized(async (event) => {
    const file = event.data;

    if (!file.name || !file.name.startsWith("trip-documents/")) {
        logger.info("Datoteka ni v mapi trip-documents, preskočim.");
        return;
    }

    const parts = file.name.split("/");
    const registrationId = parts[1];
    const fileName = parts.slice(2).join("/");

    if (!registrationId || !fileName) {
        logger.warn("Neveljavna pot datoteke.", { path: file.name });
        return;
    }

    const registrationRef = db.collection("tripRegistrations").doc(registrationId);
    const registrationDoc = await registrationRef.get();

    if (!registrationDoc.exists) {
        logger.warn("Prijava za naložen dokument ne obstaja.", { registrationId });
        return;
    }

    const docRef = await db.collection("storageDocuments").add({
        registrationId,
        fileName,
        storagePath: file.name,
        contentType: file.contentType || "unknown",
        bucket: file.bucket,
        uploadedAt: new Date(),
        verified: false,
    });

    await registrationRef.update({
        documentsUploaded: true,
        documentsUpdatedAt: new Date(),
    });

    await db.collection("notifications").add({
        type: "STORAGE_DOCUMENT_UPLOADED",
        message: `Dokument "${fileName}" je bil uspešno naložen za izlet.`,
        registrationId,
        userId: registrationDoc.data().userId || null,
        documentId: docRef.id,
        createdAt: new Date(),
        read: false,
    });

    logger.info("Storage dokument uspešno obdelan.", {
        registrationId,
        documentId: docRef.id,
    });
});