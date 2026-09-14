// src/automations/service.js
// O "cérebro" — recebe os dados crus de um comentário (já extraídos do
// webhook) e decide o que fazer: achar a automação da publicação, achar
// o gatilho que bateu, mandar a Private Reply (ou só logar em DRY_RUN),
// registrar tudo no Firestore de forma idempotente.

const matcher = require("./matcher");
const repo = require("./repository");
const privateReplies = require("../instagram/privateReplies");
const logger = require("../utils/logger");

const ERROS_SEM_RETRY = new Set([400, 401, 403]); // política/permissão — repetir não resolve

async function processarComentario({ commentId, mediaId, username, igScopedUserId, commentText }) {
  if (!commentId) {
    logger.warn("[AutomationMatcher]", "Evento sem commentId, ignorando.");
    return { status: "ignored", motivo: "sem_comment_id" };
  }

  // Idempotência: se a Meta reenviar o mesmo evento (acontece), não
  // processa de novo nem manda uma segunda DM.
  const { novo } = await repo.marcarComentarioSeNovo(commentId, { mediaId, username, igScopedUserId, commentText });
  if (!novo) {
    logger.info("[AutomationMatcher]", `Comentário ${commentId} já processado antes — ignorando (idempotência).`);
    return { status: "ignored", motivo: "duplicado" };
  }

  if (mediaId) await repo.incrementarMetrica(mediaId, "commentsReceived");

  if (!commentText) {
    await repo.atualizarStatusComentario(commentId, { status: "ignored", errorMessage: "comentário sem texto" });
    return { status: "ignored", motivo: "sem_texto" };
  }

  try {
    const automations = mediaId ? await repo.listarAutomationsAtivasPorMedia(mediaId) : [];
    if (!automations.length) {
      await repo.atualizarStatusComentario(commentId, { status: "ignored", errorMessage: "nenhuma automação ativa pra essa publicação" });
      if (mediaId) await repo.incrementarMetrica(mediaId, "ignoredComments");
      return { status: "ignored", motivo: "sem_automacao" };
    }

    for (const automation of automations) {
      const trigger = matcher.encontrarTriggerCorrespondente(automation, commentText);
      if (!trigger) continue;

      if (mediaId) await repo.incrementarMetrica(mediaId, "matchedComments");

      const resultado = await privateReplies.enviarRespostaPrivada({ commentId, texto: trigger.response?.text || "" });

      await repo.atualizarStatusComentario(commentId, {
        status: "sent",
        automationId: automation.id,
        triggerId: trigger.id || null,
        messageId: resultado.message_id,
        recipientId: resultado.recipient_id,
      });
      if (mediaId) await repo.incrementarMetrica(mediaId, "privateRepliesSent");

      logger.info("[AutomationMatcher]", `Match! automação=${automation.id} trigger=${trigger.id || "?"} comentário=${commentId} dryRun=${resultado.dryRun}`);
      return { status: "sent", automationId: automation.id, dryRun: resultado.dryRun };
    }

    await repo.atualizarStatusComentario(commentId, { status: "ignored", errorMessage: "nenhuma palavra-chave configurada bateu" });
    if (mediaId) await repo.incrementarMetrica(mediaId, "ignoredComments");
    return { status: "ignored", motivo: "sem_match" };
  } catch (e) {
    await repo.incrementarTentativa(commentId);
    await repo.atualizarStatusComentario(commentId, {
      status: "failed",
      errorMessage: e.message,
      errorCode: e.status || e.meta?.error?.code || null,
    });
    if (mediaId) await repo.incrementarMetrica(mediaId, "failedReplies");
    logger.error("[AutomationMatcher]", `Falha processando ${commentId}: ${e.message}`);
    return { status: "failed", erro: e.message, semRetry: ERROS_SEM_RETRY.has(e.status) };
  }
}

module.exports = { processarComentario, ERROS_SEM_RETRY };
