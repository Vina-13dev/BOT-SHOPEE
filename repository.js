// src/automations/repository.js
// Toda leitura/escrita no Firestore relacionada às automações do
// Instagram passa por aqui — nada de automação é escrito direto do
// navegador (ver firestore.rules).

const { getFirestoreAdmin } = require("../firebase/admin");

const COL_AUTOMATIONS = "instagram_automations";
const COL_PROCESSED = "instagram_processed_comments";
const COL_METRICS = "instagram_metrics";

function colAutomations() { return getFirestoreAdmin().collection(COL_AUTOMATIONS); }
function colProcessed() { return getFirestoreAdmin().collection(COL_PROCESSED); }
function colMetrics() { return getFirestoreAdmin().collection(COL_METRICS); }

// ---------- Automações ----------

async function listarAutomationsAtivasPorMedia(mediaId) {
  const snap = await colAutomations()
    .where("mediaId", "==", mediaId)
    .where("enabled", "==", true)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function listarAutomationsPorDono(ownerUid) {
  const snap = await colAutomations().where("ownerUid", "==", ownerUid).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function buscarAutomation(id) {
  const doc = await colAutomations().doc(id).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

async function criarAutomation(ownerUid, dados) {
  const agora = new Date().toISOString();
  const doc = {
    ownerUid,
    instagramAccountId: dados.instagramAccountId || process.env.INSTAGRAM_USER_ID || null,
    mediaId: dados.mediaId,
    mediaPermalink: dados.mediaPermalink || null,
    mediaType: dados.mediaType || null,
    mediaCaption: dados.mediaCaption || null,
    mediaThumbnail: dados.mediaThumbnail || null,
    nomeInterno: dados.nomeInterno || "Automação sem nome",
    enabled: dados.enabled !== false,
    triggers: Array.isArray(dados.triggers) ? dados.triggers : [],
    respostaPublica: dados.respostaPublica === true, // desligado por padrão
    createdAt: agora,
    updatedAt: agora,
  };
  const ref = await colAutomations().add(doc);
  return { id: ref.id, ...doc };
}

async function atualizarAutomation(id, ownerUid, dados) {
  const ref = colAutomations().doc(id);
  const atual = await ref.get();
  if (!atual.exists) throw Object.assign(new Error("Automação não encontrada."), { status: 404 });
  if (atual.data().ownerUid !== ownerUid) throw Object.assign(new Error("Sem permissão."), { status: 403 });

  const patch = { ...dados, ownerUid, updatedAt: new Date().toISOString() };
  delete patch.id; delete patch.createdAt;
  await ref.set(patch, { merge: true });
  return { id, ...atual.data(), ...patch };
}

async function excluirAutomation(id, ownerUid) {
  const ref = colAutomations().doc(id);
  const atual = await ref.get();
  if (!atual.exists) return;
  if (atual.data().ownerUid !== ownerUid) throw Object.assign(new Error("Sem permissão."), { status: 403 });
  await ref.delete();
}

// ---------- Idempotência de comentários ----------
// Transação atômica: só marca "novo" se ninguém tiver marcado antes. Isso
// impede que um reenvio de webhook (a Meta pode reenviar) gere duas DMs
// pro mesmo comentário — mesmo se dois eventos chegarem quase juntos.
async function marcarComentarioSeNovo(commentId, dadosIniciais) {
  const db = getFirestoreAdmin();
  const ref = colProcessed().doc(String(commentId));

  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (doc.exists) {
      return { novo: false, dados: doc.data() };
    }
    const registro = {
      commentId: String(commentId),
      mediaId: dadosIniciais.mediaId || null,
      username: dadosIniciais.username || null,
      igScopedUserId: dadosIniciais.igScopedUserId || null,
      commentText: dadosIniciais.commentText || null,
      automationId: null,
      triggerId: null,
      status: "processing",
      messageId: null,
      recipientId: null,
      errorCode: null,
      errorMessage: null,
      attempts: 0,
      receivedAt: new Date().toISOString(),
      processedAt: null,
    };
    tx.set(ref, registro);
    return { novo: true, dados: registro };
  });
}

async function atualizarStatusComentario(commentId, patch) {
  await colProcessed().doc(String(commentId)).set(
    { ...patch, processedAt: new Date().toISOString() },
    { merge: true }
  );
}

async function incrementarTentativa(commentId) {
  const db = getFirestoreAdmin();
  const ref = colProcessed().doc(String(commentId));
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const atual = doc.exists ? doc.data().attempts || 0 : 0;
    tx.set(ref, { attempts: atual + 1 }, { merge: true });
  });
}

async function listarHistorico({ ownerUid, mediaId, status, limite = 50 }) {
  // Histórico é filtrado por automação do dono — evita expor comentários
  // de outra pessoa. Busca as automações do dono primeiro, depois filtra.
  let query = colProcessed().orderBy("receivedAt", "desc").limit(Number(limite) || 50);
  if (mediaId) query = query.where("mediaId", "==", mediaId);
  if (status) query = query.where("status", "==", status);

  const automationsDoDono = ownerUid ? await listarAutomationsPorDono(ownerUid) : [];
  const mediaIdsDoDono = new Set(automationsDoDono.map((a) => a.mediaId));

  const snap = await query.get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((c) => !ownerUid || mediaIdsDoDono.has(c.mediaId));
}

// ---------- Métricas (reais — nunca inventadas) ----------

async function incrementarMetrica(mediaId, campo) {
  const { FieldValue } = require("firebase-admin/firestore");
  const ref = colMetrics().doc(String(mediaId));
  await ref.set({ [campo]: FieldValue.increment(1), atualizadoEm: new Date().toISOString() }, { merge: true });
}

async function buscarMetricas(mediaId) {
  const doc = await colMetrics().doc(String(mediaId)).get();
  return doc.exists ? doc.data() : {
    commentsReceived: 0, matchedComments: 0, privateRepliesSent: 0, ignoredComments: 0, failedReplies: 0,
  };
}

module.exports = {
  listarAutomationsAtivasPorMedia, listarAutomationsPorDono, buscarAutomation,
  criarAutomation, atualizarAutomation, excluirAutomation,
  marcarComentarioSeNovo, atualizarStatusComentario, incrementarTentativa, listarHistorico,
  incrementarMetrica, buscarMetricas,
};
