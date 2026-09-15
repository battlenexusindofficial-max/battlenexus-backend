// battlenexus-backend/src/services/firebase.service.js

const path = require("path");
const fs = require("fs");

// Import firebase-admin properly
let admin;
try {
  admin = require("firebase-admin");
  console.log("✅ firebase-admin loaded successfully");
} catch (error) {
  console.error("❌ Failed to load firebase-admin:", error.message);
  throw error;
}

// ============================================================
// FIREBASE ADMIN INITIALIZATION
// ============================================================

let firebaseApp = null;
let firestore = null;
let isInitialized = false;

/**
 * Initialize Firebase Admin SDK
 */
const initializeFirebase = () => {
  try {
    if (isInitialized && firebaseApp) {
      console.log("✅ Firebase Admin already initialized");
      return { app: firebaseApp, db: firestore };
    }

    const projectId = process.env.FIREBASE_PROJECT_ID || "battlenexus-4ca0d";
    console.log(`📦 Firebase Project ID: ${projectId}`);

    const serviceAccountPath = path.resolve(
      process.cwd(),
      "serviceAccountKey.json",
    );
    console.log(`🔍 Looking for service account at: ${serviceAccountPath}`);

    if (!fs.existsSync(serviceAccountPath)) {
      console.error(
        `❌ Service account file not found at: ${serviceAccountPath}`,
      );
      throw new Error("Service account file not found");
    }

    const serviceAccount = JSON.parse(
      fs.readFileSync(serviceAccountPath, "utf8"),
    );
    console.log(`✅ Service account loaded from: ${serviceAccountPath}`);
    console.log(`👤 Client Email: ${serviceAccount.client_email}`);

    if (
      !serviceAccount.project_id ||
      !serviceAccount.private_key ||
      !serviceAccount.client_email
    ) {
      throw new Error("Invalid service account: missing required fields");
    }

    console.log("🔥 Initializing Firebase Admin SDK...");

    try {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: projectId,
        databaseURL:
          process.env.FIREBASE_DATABASE_URL ||
          `https://${projectId}.firebaseio.com`,
      });
      console.log("✅ Firebase Admin SDK initialized successfully");
    } catch (error) {
      if (error.message.includes("already exists")) {
        firebaseApp = admin.apps[0];
        console.log("✅ Using existing Firebase app");
      } else {
        throw error;
      }
    }

    firestore = admin.firestore();
    firestore.settings({
      ignoreUndefinedProperties: true,
    });

    isInitialized = true;

    console.log("🔍 Testing Firestore connection...");
    firestore
      .collection("users")
      .limit(1)
      .get()
      .then(() => console.log("✅ Firestore connection successful"))
      .catch((error) =>
        console.warn("⚠️ Firestore connection test failed:", error.message),
      );

    return { app: firebaseApp, db: firestore };
  } catch (error) {
    console.error("❌ Firebase initialization failed:", error.message);
    throw new Error(`Firebase initialization failed: ${error.message}`);
  }
};

// ============================================================
// FIREBASE SERVICE FUNCTIONS
// ============================================================

const getFirebaseApp = () => {
  if (!firebaseApp || !isInitialized) {
    const { app, db } = initializeFirebase();
    firebaseApp = app;
    firestore = db;
  }
  return { app: firebaseApp, db: firestore };
};

/**
 * Update wallet balance for a user
 */
const updateWalletBalance = async (firebaseUid, newBalance) => {
  try {
    console.log(`🔄 Updating wallet balance for user: ${firebaseUid}`);
    console.log(`💰 New balance: ${newBalance}`);

    const { db } = getFirebaseApp();
    const userRef = db.collection("users").doc(firebaseUid);

    await userRef.update({
      walletBalance: newBalance,
      walletUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`✅ Wallet balance updated for user: ${firebaseUid}`);
    return true;
  } catch (error) {
    console.error("❌ Firebase update error:", error.message);
    throw new Error(`Failed to update wallet balance: ${error.message}`);
  }
};

/**
 * Add a transaction record - FIXED VERSION
 */
const addTransaction = async (transactionData) => {
  try {
    console.log(`📝 Adding transaction for user: ${transactionData.uid}`);
    console.log(
      `📝 Transaction data:`,
      JSON.stringify(transactionData, null, 2),
    );

    const { db } = getFirebaseApp();

    // Create a new document with auto-generated ID
    const transactionRef = db.collection("walletTransactions").doc();

    // Prepare the transaction data with all required fields
    const data = {
      uid: transactionData.uid,
      title: transactionData.title || "Wallet Transaction",
      subtitle: transactionData.subtitle || "Transaction",
      amount: transactionData.amount || 0,
      type: transactionData.type || "deposit",
      status: transactionData.status || "SUCCESS",
      source: transactionData.source || "REAL_MONEY",
      balanceAfter: transactionData.balanceAfter || 0,
      requestId:
        transactionData.requestId ||
        `txn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      description: transactionData.description || "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    console.log(`📝 Saving transaction with ID: ${transactionRef.id}`);
    await transactionRef.set(data);

    console.log(
      `✅ Transaction added successfully with ID: ${transactionRef.id}`,
    );
    return transactionRef.id;
  } catch (error) {
    console.error("❌ Firebase transaction add error:", error.message);
    console.error("Stack:", error.stack);
    throw new Error(`Failed to add transaction: ${error.message}`);
  }
};

const getUser = async (firebaseUid) => {
  try {
    const { db } = getFirebaseApp();
    const userRef = db.collection("users").doc(firebaseUid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return null;
    }

    return userDoc.data();
  } catch (error) {
    console.error("❌ Firebase getUser error:", error.message);
    throw new Error(`Failed to get user: ${error.message}`);
  }
};

const updateUser = async (firebaseUid, data) => {
  try {
    const { db } = getFirebaseApp();
    const userRef = db.collection("users").doc(firebaseUid);
    await userRef.update(data);
    return true;
  } catch (error) {
    console.error("❌ Firebase updateUser error:", error.message);
    throw new Error(`Failed to update user: ${error.message}`);
  }
};

const initializeUserWallet = async (firebaseUid, email, displayName) => {
  try {
    console.log(`🔧 Initializing wallet for user: ${firebaseUid}`);

    const { db } = getFirebaseApp();
    const userRef = db.collection("users").doc(firebaseUid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      await userRef.set({
        uid: firebaseUid,
        email: email || null,
        displayName: displayName || null,
        walletBalance: 0,
        walletUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`✅ Wallet created for user: ${firebaseUid}`);
    } else {
      console.log(`✅ Wallet already exists for user: ${firebaseUid}`);
    }

    return true;
  } catch (error) {
    console.error("❌ Firebase initializeUserWallet error:", error.message);
    throw new Error(`Failed to initialize wallet: ${error.message}`);
  }
};

module.exports = {
  initializeFirebase,
  getFirebaseApp,
  updateWalletBalance,
  addTransaction,
  getUser,
  updateUser,
  initializeUserWallet,
};
