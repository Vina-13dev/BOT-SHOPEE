// lib/firebaseAdmin.js
// Inicializa o Firebase Admin SDK usando a service account guardada no secret
// do GitHub FIREBASE_SERVICE_ACCOUNT (cole o JSON completo, baixado em
// Firebase Console > Configurações do projeto > Contas de serviço > Gerar
// nova chave privada).
//
// Usado SOMENTE pelo script do Bot Caçador (scripts/buscarOfertas.js), que
// roda no GitHub Actions. O server.js do Railway não depende disso — assim
// o backend web continua leve e sem precisar de credencial de admin.

const admin = require("firebase-admin");

function getFirestoreAdmin() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
      throw new Error(
        "Variável FIREBASE_SERVICE_ACCOUNT não configurada (cole o JSON da service account como Secret no GitHub)."
      );
    }
    const serviceAccount = JSON.parse(raw);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  return admin.firestore();
}

module.exports = { getFirestoreAdmin };
