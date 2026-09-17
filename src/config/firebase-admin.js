// backend/src/config/firebase-admin.js

const admin = require("firebase-admin");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

console.log("🔄 Initializing Firebase Admin...");

let firebaseApp = null;

const normalizePrivateKey = (value) => {
  let privateKey = value.trim();

  // Remove wrapping quotes if present
  while (
    privateKey.length >= 2 &&
    ((privateKey.startsWith('"') && privateKey.endsWith('"')) ||
      (privateKey.startsWith("'") && privateKey.endsWith("'")))
  ) {
    privateKey = privateKey.slice(1, -1).trim();
  }

  // Convert literal \n from Render environment variable into real newlines
  privateKey = privateKey.replace(/\\n/g, "\n").replace(/\r/g, "");

  if (
    !privateKey.includes("-----BEGIN PRIVATE KEY-----") ||
    !privateKey.includes("-----END PRIVATE KEY-----")
  ) {
    throw new Error(
      "FIREBASE_PRIVATE_KEY must contain a complete PEM private key",
    );
  }

  try {
    crypto.createPrivateKey(privateKey);
  } catch (error) {
    throw new Error(`FIREBASE_PRIVATE_KEY is not valid PEM: ${error.message}`);
  }

  return privateKey;
};

try {
  const keyPath = path.resolve(__dirname, "../../serviceAccountKey.json");
  const serviceAccount = process.env.FIREBASE_PRIVATE_KEY
    ? {
        project_id: process.env.FIREBASE_PROJECT_ID,
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        private_key: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
      }
    : fs.existsSync(keyPath)
      ? require(keyPath)
      : null;

  if (!serviceAccount) {
    throw new Error("Firebase credentials are not configured");
  }

  console.log("✅ Service account loaded successfully");
  console.log(`📁 Project ID: ${serviceAccount.project_id}`);
  console.log(`📧 Client Email: ${serviceAccount.client_email}`);

  // ⭐ Debug admin object
  console.log("📦 admin keys:", Object.keys(admin));
  console.log("📦 admin.cert type:", typeof admin.cert);
  console.log("📦 admin.auth type:", typeof admin.auth);
  console.log("📦 admin.credential type:", typeof admin.credential);

  // ⭐ Use admin.credential.cert (standard way)
  if (admin.credential && typeof admin.credential.cert === "function") {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: "https://battlenexus-4ca0d-default-rtdb.firebaseio.com/",
    });
    console.log("✅ Firebase Admin initialized with credential.cert");
  }
  // ⭐ Fallback: use admin.cert
  else if (typeof admin.cert === "function") {
    firebaseApp = admin.initializeApp({
      credential: admin.cert(serviceAccount),
      databaseURL: "https://battlenexus-4ca0d-default-rtdb.firebaseio.com/",
    });
    console.log("✅ Firebase Admin initialized with cert");
  }
  // ⭐ Fallback: use applicationDefault
  else {
    console.log("🔄 Trying applicationDefault...");
    process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;
    firebaseApp = admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: "https://battlenexus-4ca0d-default-rtdb.firebaseio.com/",
    });
    console.log("✅ Firebase Admin initialized with applicationDefault");
  }

  console.log(`📦 Firebase Admin version: ${admin.SDK_VERSION}`);
} catch (error) {
  console.error("❌ Firebase Admin initialization failed:", error.message);
  console.error("❌ Error stack:", error.stack);
  process.exit(1);
}

// ⭐ Export admin and firebaseApp
module.exports = { admin, firebaseApp };
