const { setGlobalOptions } = require("firebase-functions");
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onMessagePublished } = require("firebase-functions/v2/pubsub");
const { PubSub } = require("@google-cloud/pubsub");
const { onObjectFinalized } = require("firebase-functions/v2/storage");

admin.initializeApp();
const db = admin.firestore();
const pubsub = new PubSub({ projectId: "organizacija-izletov" });
const TRIP_EVENTS_TOPIC = "trip-events";

setGlobalOptions({ maxInstances: 10 });

// 1. Health check funkcija
exports.healthCheck = onRequest((req, res) => {
    res.status(200).json({
        system: "organizacija-izletov",
        status: "OK",
        message: "Serverless backend deluje.",
    });
});

// 2. Nastavitev uporabniške vloge
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

// 3. Zavarovana callable funkcija - prijava na izlet
exports.createTripRegistration = onCall(async (request) => {
    if (!request.auth) {
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

    return {
        message: "Prijava na izlet je bila uspešno oddana.",
        registrationId: docRef.id,
    };
});

// 4. Firestore trigger - nova prijava
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
            createdAt: new Date(),
            read: false,
        });
    }
);

// 5. Firestore trigger - sprememba statusa prijave
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
            message: `Status prijave za ${after.travelerName} je spremenjen iz ${before.status} v ${after.status}.`,
            registrationId: event.params.registrationId,
            createdAt: new Date(),
            read: false,
        });
    }
);

// Testna funkcija za prijavo (generiranje custom tokena)
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

// Pomožna funkcija za preverjanje uporabniške vloge
function requireRole(request, allowedRoles) {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Uporabnik mora biti prijavljen.");
    }

    const role = request.auth.token.role;

    if (!allowedRoles.includes(role)) {
        throw new HttpsError(
            "permission-denied",
            `Dostop dovoljen samo vlogam: ${allowedRoles.join(", ")}.`
        );
    }

    return role;
}

// 6. Admin potrdi ali zavrne prijavo
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

        if (registration.documentsUploaded !== true) {
            await db.collection("notifications").add({
                type: "MISSING_DOCUMENTS",
                message: `Potnik ${registration.travelerName} za izlet ${registration.tripName} še nima naloženih dokumentov.`,
                registrationId: doc.id,
                createdAt: new Date(),
                read: false,
            });

            remindersCreated++;
        }
    }

    return remindersCreated;
}

// 7. Scheduled funkcija - dnevni opomnik za manjkajoče dokumente
exports.dailyMissingDocumentsReminder = onSchedule(
    "every day 08:00",
    async () => {
        const remindersCreated = await checkMissingDocuments();

        logger.info("Dnevni pregled manjkajočih dokumentov zaključen.", {
            remindersCreated,
        });
    }
);

// 8. HTTP test scheduled logike - ročni sprožilec dnevnega preverjanja
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

// 9. HTTP objava Pub/Sub sporočila
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

// 10. Pub/Sub trigger - obdela sporočilo iz vrste
exports.onTripEventPublished = onMessagePublished(
    TRIP_EVENTS_TOPIC,
    async (event) => {
        const messageData = event.data.message.json;

        logger.info("Prejeto Pub/Sub sporočilo:", messageData);

        await db.collection("eventLogs").add({
            source: "PUBSUB",
            eventType: messageData.eventType,
            registrationId: messageData.registrationId,
            createdAt: new Date(),
            processed: true,
        });

        await db.collection("notifications").add({
            type: "PUBSUB_EVENT_PROCESSED",
            message: `Obdelan Pub/Sub dogodek: ${messageData.eventType}`,
            registrationId: messageData.registrationId,
            createdAt: new Date(),
            read: false,
        });
    }
);

// 11. Storage trigger ob nalaganju datoteke v Storage - ustvari zapis in posodobi prijavo
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
        message: `V Storage je bil naložen dokument ${fileName} za prijavo ${registrationId}.`,
        registrationId,
        documentId: docRef.id,
        createdAt: new Date(),
        read: false,
    });

    logger.info("Storage dokument uspešno obdelan.", {
        registrationId,
        documentId: docRef.id,
    });
});