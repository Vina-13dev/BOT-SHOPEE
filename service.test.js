const { test, mock, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const repo = require("../src/automations/repository");
const privateReplies = require("../src/instagram/privateReplies");
const { processarComentario } = require("../src/automations/service");

// Estado em memória simulando o Firestore, só pra teste (sem tocar em
// nenhum Firebase de verdade)
let comentariosProcessados;
let automationsPorMedia;

beforeEach(() => {
  comentariosProcessados = new Map();
  automationsPorMedia = new Map();

  mock.method(repo, "marcarComentarioSeNovo", async (commentId, dados) => {
    if (comentariosProcessados.has(commentId)) {
      return { novo: false, dados: comentariosProcessados.get(commentId) };
    }
    const registro = { ...dados, status: "processing" };
    comentariosProcessados.set(commentId, registro);
    return { novo: true, dados: registro };
  });
  mock.method(repo, "atualizarStatusComentario", async (commentId, patch) => {
    const atual = comentariosProcessados.get(commentId) || {};
    comentariosProcessados.set(commentId, { ...atual, ...patch });
  });
  mock.method(repo, "incrementarTentativa", async () => {});
  mock.method(repo, "incrementarMetrica", async () => {});
  mock.method(repo, "listarAutomationsAtivasPorMedia", async (mediaId) => automationsPorMedia.get(mediaId) || []);
});

test("comentário duplicado é ignorado (idempotência) e não chama a Private Reply de novo", async () => {
  automationsPorMedia.set("media-1", [
    { id: "auto-1", mediaId: "media-1", triggers: [{ id: "t1", keywords: ["quero"], mode: "CONTAINS", response: { text: "toma o link" } }] },
  ]);
  const enviarMock = mock.method(privateReplies, "enviarRespostaPrivada", async () => ({ dryRun: true, message_id: null, recipient_id: null }));

  const r1 = await processarComentario({ commentId: "c1", mediaId: "media-1", commentText: "quero!" });
  const r2 = await processarComentario({ commentId: "c1", mediaId: "media-1", commentText: "quero!" });

  assert.equal(r1.status, "sent");
  assert.equal(r2.status, "ignored");
  assert.equal(r2.motivo, "duplicado");
  assert.equal(enviarMock.mock.callCount(), 1); // NUNCA manda duas vezes pro mesmo comentário
});

test("comentário sem match em nenhuma keyword é ignorado, sem enviar nada", async () => {
  automationsPorMedia.set("media-1", [
    { id: "auto-1", mediaId: "media-1", triggers: [{ id: "t1", keywords: ["quero"], mode: "CONTAINS", response: { text: "toma o link" } }] },
  ]);
  const enviarMock = mock.method(privateReplies, "enviarRespostaPrivada", async () => ({ dryRun: true }));

  const r = await processarComentario({ commentId: "c2", mediaId: "media-1", commentText: "que lindo!!" });

  assert.equal(r.status, "ignored");
  assert.equal(r.motivo, "sem_match");
  assert.equal(enviarMock.mock.callCount(), 0);
});

test("Reel A não aciona automação configurada só no Reel B", async () => {
  automationsPorMedia.set("media-A", [
    { id: "auto-A", mediaId: "media-A", triggers: [{ id: "ta", keywords: ["tenis"], mode: "CONTAINS", response: { text: "link tênis" } }] },
  ]);
  automationsPorMedia.set("media-B", [
    { id: "auto-B", mediaId: "media-B", triggers: [{ id: "tb", keywords: ["calca"], mode: "CONTAINS", response: { text: "link calça" } }] },
  ]);
  mock.method(privateReplies, "enviarRespostaPrivada", async () => ({ dryRun: true }));

  const r = await processarComentario({ commentId: "c3", mediaId: "media-A", commentText: "quero a calça" });
  assert.equal(r.status, "ignored");
  assert.equal(r.motivo, "sem_match");
});

test("sucesso: match encontrado, envia e marca status sent", async () => {
  automationsPorMedia.set("media-1", [
    { id: "auto-1", mediaId: "media-1", triggers: [{ id: "t1", keywords: ["quero"], mode: "CONTAINS", response: { text: "toma o link" } }] },
  ]);
  mock.method(privateReplies, "enviarRespostaPrivada", async () => ({ dryRun: false, message_id: "m123", recipient_id: "r456" }));

  const r = await processarComentario({ commentId: "c4", mediaId: "media-1", commentText: "eu quero" });

  assert.equal(r.status, "sent");
  assert.equal(r.automationId, "auto-1");
  assert.equal(comentariosProcessados.get("c4").status, "sent");
  assert.equal(comentariosProcessados.get("c4").messageId, "m123");
});

test("erro 401/403 da Meta marca como failed, sem tentar de novo automaticamente", async () => {
  automationsPorMedia.set("media-1", [
    { id: "auto-1", mediaId: "media-1", triggers: [{ id: "t1", keywords: ["quero"], mode: "CONTAINS", response: { text: "x" } }] },
  ]);
  mock.method(privateReplies, "enviarRespostaPrivada", async () => {
    const e = new Error("Permissão negada");
    e.status = 403;
    throw e;
  });

  const r = await processarComentario({ commentId: "c5", mediaId: "media-1", commentText: "quero" });

  assert.equal(r.status, "failed");
  assert.equal(r.semRetry, true); // 403 não deve ser reprocessado automaticamente
});

test("erro 429 (rate limit) marca failed mas indica que pode tentar de novo depois", async () => {
  automationsPorMedia.set("media-1", [
    { id: "auto-1", mediaId: "media-1", triggers: [{ id: "t1", keywords: ["quero"], mode: "CONTAINS", response: { text: "x" } }] },
  ]);
  mock.method(privateReplies, "enviarRespostaPrivada", async () => {
    const e = new Error("Too Many Requests");
    e.status = 429;
    throw e;
  });

  const r = await processarComentario({ commentId: "c6", mediaId: "media-1", commentText: "quero" });

  assert.equal(r.status, "failed");
  assert.equal(r.semRetry, false); // 429 é temporário, pode reprocessar/retry
});

test("comentário sem automação nenhuma pra aquela mídia é ignorado", async () => {
  const r = await processarComentario({ commentId: "c7", mediaId: "media-sem-automacao", commentText: "quero" });
  assert.equal(r.status, "ignored");
  assert.equal(r.motivo, "sem_automacao");
});

test("comentário sem texto é ignorado sem processar automação", async () => {
  const r = await processarComentario({ commentId: "c8", mediaId: "media-1", commentText: null });
  assert.equal(r.status, "ignored");
  assert.equal(r.motivo, "sem_texto");
});
