const admin = require("firebase-admin");

// Initialize Firebase Admin with environment variables or service account file
let credential;
if (process.env.FIREBASE_PRIVATE_KEY) {
  // Use environment variables (for production/Render)
  credential = admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  });
} else {
  // Use service account file (for local development)
  const serviceAccount = require("../serviceAccountKey.json");
  credential = admin.credential.cert(serviceAccount);
}

admin.initializeApp({
  credential: credential,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "alpa-13361.firebasestorage.app"
});

const db = admin.firestore();
const storage = admin.storage();
const auth = admin.auth();

module.exports = { admin, db, storage, auth };

