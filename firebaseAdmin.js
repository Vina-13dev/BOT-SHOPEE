// firebaseAdmin.js — Firebase Admin compartilhado pelo caçador e pelo backend.
// A service account NUNCA deve ser colocada no front-end.

const admin = require('firebase-admin');

function getFirebaseAdmin() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
      throw new Error('Variável FIREBASE_SERVICE_ACCOUNT não configurada.');
    }

    const serviceAccount = JSON.parse(raw);
    const options = { credential: admin.credential.cert(serviceAccount) };
    const bucket = process.env.FIREBASE_STORAGE_BUCKET;
    if (bucket) options.storageBucket = bucket;

    admin.initializeApp(options);
  }
  return admin;
}

function getFirestoreAdmin() {
  return getFirebaseAdmin().firestore();
}

function getAuthAdmin() {
  return getFirebaseAdmin().auth();
}

function getStorageBucket() {
  const adminApp = getFirebaseAdmin();
  const bucket = process.env.FIREBASE_STORAGE_BUCKET;
  return bucket ? adminApp.storage().bucket(bucket) : adminApp.storage().bucket();
}

async function verificarIdToken(idToken) {
  if (!idToken) throw new Error('Token Firebase não informado.');
  return getAuthAdmin().verifyIdToken(idToken);
}

module.exports = { getFirestoreAdmin, getAuthAdmin, getStorageBucket, verificarIdToken };
