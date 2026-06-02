import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { getStorage, connectStorageEmulator } from "firebase/storage";

const firebaseConfig = {
  apiKey: "demo-key",
  authDomain: "organizacija-izletov.firebaseapp.com",
  projectId: "organizacija-izletov",
  storageBucket: "organizacija-izletov.appspot.com",
  messagingSenderId: "123456789",
  appId: "demo-app-id",
};

const app = initializeApp(firebaseConfig);

export const auth      = getAuth(app);
export const db        = getFirestore(app);
export const functions = getFunctions(app);
export const storage   = getStorage(app);

connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
connectFirestoreEmulator(db, "127.0.0.1", 8081);
connectFunctionsEmulator(functions, "127.0.0.1", 5001);
connectStorageEmulator(storage, "127.0.0.1", 9199);
