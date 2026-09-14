// src/instagram/privateReplies.js
// Envia a resposta privada (Private Reply) pra quem comentou — é isso que
// aparece na caixa de entrada/solicitações da pessoa no Instagram.
//
// Documentação oficial confirmada (jun/2026):
//   POST /<APP_USERS_IG_ID>/messages
//   { "recipient": { "comment_id": "<COMMENT_ID>" }, "message": { "text": "..." } }
// Limites documentados: só 1 mensagem inicial por comentário, dentro de 7
// dias da criação do comentário. Isso é responsabilidade de quem chama
// (o service.js já garante isso via idempotência no Firestore).

const { required, graphPostJson } = require("./client");
const logger = require("../utils/logger");

function dryRunAtivo() {
  // Por segurança, o padrão é DRY_RUN=true — só desativa se alguém
  // explicitamente configurar "false".
  return String(process.env.INSTAGRAM_DRY_RUN ?? "true").toLowerCase() !== "false";
}

async function enviarRespostaPrivada({ commentId, texto }) {
  if (!commentId) throw new Error("commentId é obrigatório.");
  if (!texto) throw new Error("texto da resposta é obrigatório.");

  const userId = required("INSTAGRAM_USER_ID");

  if (dryRunAtivo()) {
    logger.info("[InstagramPrivateReply]", `DRY_RUN ativo — NÃO enviou de verdade. Comentário=${commentId} texto="${texto}"`);
    return { dryRun: true, recipient_id: null, message_id: null };
  }

  const resultado = await graphPostJson(`/${encodeURIComponent(userId)}/messages`, {
    recipient: { comment_id: commentId },
    message: { text: texto },
  });

  logger.info("[InstagramPrivateReply]", `Enviada com sucesso pro comentário ${commentId}.`);
  return { dryRun: false, recipient_id: resultado.recipient_id || null, message_id: resultado.message_id || null };
}

module.exports = { enviarRespostaPrivada, dryRunAtivo };
