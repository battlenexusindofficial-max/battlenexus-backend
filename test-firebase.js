// test-firebase-simple.js
// Run with: node test-firebase-simple.js

const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

console.log("🔧 Testing Firebase Admin...");
console.log("Admin version:", admin.SDK_VERSION);

// Check if admin.credential exists
console.log("admin.credential exists:", !!admin.credential);
console.log(
  "admin.credential.cert exists:",
  typeof admin.credential.cert === "function",
);

// Try to load service account
const serviceAccountPath = path.resolve(
  process.cwd(),
  "serviceAccountKey.json",
);
console.log(`📁 Looking for service account at: ${serviceAccountPath}`);

if (fs.existsSync(serviceAccountPath)) {
  console.log("✅ Service account file found");
  try {
    const serviceAccount = JSON.parse(
      fs.readFileSync(serviceAccountPath, "utf8"),
    );
    console.log("✅ Service account parsed successfully");
    console.log("📦 Project ID:", serviceAccount.project_id);
    console.log("👤 Client Email:", serviceAccount.client_email);

    // Try to initialize
    console.log("🔥 Initializing Firebase...");
    const app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });

    console.log("✅ Firebase initialized successfully!");
    console.log("📦 App name:", app.name);

    // Test Firestore
    const db = admin.firestore();
    console.log("✅ Firestore instance created");

    // Test connection
    db.collection("users")
      .limit(1)
      .get()
      .then(() => {
        console.log("✅ Firestore connection successful!");
        process.exit(0);
      })
      .catch((error) => {
        console.error("❌ Firestore connection failed:", error.message);
        process.exit(1);
      });
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error("Stack:", error.stack);
    process.exit(1);
  }
} else {
  console.error("❌ Service account file not found!");
  console.log("Please download serviceAccountKey.json from Firebase Console");
  process.exit(1);
}
