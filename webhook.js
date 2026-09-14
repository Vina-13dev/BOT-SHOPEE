// src/instagram/webhook.js
// Recebe as notificações da Meta. Duas rotas:
//   GET  /webhook/instagram  — verificação inicial (challenge da Meta)
//   POST /webhook/instagram  — eventos de verdade (comentário novo, etc.)
//
// A rota POST é protegida por verificarAssinaturaMeta (ver server.js —
// precisa vir ANTES na cadeia de middlewares).

const express = require("express");
const router = express.Router();
const logger = require("../utils/logger");
const { processarComentario } = require("../automations/service");

router.get("/webhook/instagram", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const esperado = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && esperado && token === esperado) {
    logger.info("[InstagramWebhook]", "Verificação do webhook confirmada pela Meta.");
    return res.status(200).send(challenge);
  }
  logger.warn("[InstagramWebhook]", "Tentativa de verificação com token errado ou ausente.");
  res.sendStatus(403);
});

// Extrai as "mudanças" de um entry — o formato padrão da Graph API usa
// entry.changes = [{field, value}], mas a documentação de exemplos da
// Meta às vezes mostra field/value direto no entry. Trata os dois formatos
// pra não quebrar se um deles for o real.
function extrairMudancas(entry) {
  if (Array.isArray(entry.changes)) return entry.changes;
  if (entry.field && entry.value) return [{ field: entry.field, value: entry.value }];
  return [];
}

router.post("/webhook/instagram", async (req, res) => {
  // A Meta espera 200 rápido — se demorar ou responder erro, ela reenvia
  // e pode até desativar o webhook depois de falhas repetidas. Por isso
  // respondemos JÁ e processamos depois, em segundo plano.
  res.sendStatus(200);

  try {
    const body = req.body || {};
    if (body.object !== "instagram") {
      logger.warn("[InstagramWebhook]", `Evento de objeto inesperado: ${body.object}`);
      return;
    }

    const contaConfigurada = process.env.INSTAGRAM_USER_ID;
    const ignorarProprios = process.env.INSTAGRAM_IGNORE_OWN_COMMENTS !== "false";

    for (const entry of body.entry || []) {
      if (contaConfigurada && entry.id && entry.id !== contaConfigurada) {
        logger.warn("[InstagramWebhook]", `Evento de conta diferente da configurada (${entry.id}) — ignorado.`);
        continue;
      }

      for (const mudanca of extrairMudancas(entry)) {
        const { field, value } = mudanca;
        if (field !== "comments" && field !== "live_comments") continue;
        if (!value) continue;

        if (ignorarProprios && contaConfigurada && value.from?.id === contaConfigurada) {
          logger.info("[InstagramWebhook]", "Comentário da própria conta, ignorado (evita loop).");
          continue;
        }

        await processarComentario({
          commentId: value.id,
          mediaId: value.media?.id || null,
          username: value.from?.username || null,
          igScopedUserId: value.from?.id || null,
          commentText: value.text || null,
        });
      }
    }
  } catch (e) {
    logger.error("[InstagramWebhook]", `Erro processando evento: ${e.message}`);
  }
});

module.exports = router;
module.exports.extrairMudancas = extrairMudancas; // exportado só pra testes
