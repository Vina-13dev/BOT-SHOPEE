// src/middleware/metaSignature.js
// Valida a assinatura X-Hub-Signature-256 que a Meta manda em toda
// notificação de webhook — confirma que a requisição realmente veio da
// Meta (assinada com o App Secret), não de alguém forjando a chamada.
//
// Precisa do CORPO BRUTO da requisição (antes do express.json() parsear),
// senão o hash não bate nunca. Ver server.js — o express.json() é
// configurado com "verify" pra guardar req.rawBody.

const crypto = require("crypto");
const logger = require("../utils/logger");

function calcularAssinatura(rawBody, appSecret) {
  return "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
}

function assinaturaValida(rawBody, header, appSecret) {
  if (!header || !header.startsWith("sha256=")) return false;
  if (!rawBody || !appSecret) return false;

  const esperada = calcularAssinatura(rawBody, appSecret);
  const bufRecebido = Buffer.from(header);
  const bufEsperado = Buffer.from(esperada);

  // Tamanhos diferentes quebrariam timingSafeEqual — trata como inválido
  // sem comparar (não vaza timing porque já não bate de cara).
  if (bufRecebido.length !== bufEsperado.length) return false;
  return crypto.timingSafeEqual(bufRecebido, bufEsperado);
}

function verificarAssinaturaMeta(req, res, next) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    logger.error("[InstagramWebhook]", "META_APP_SECRET não configurado — recusando webhook por segurança.");
    return res.status(500).json({ erro: "Servidor não configurado corretamente." });
  }

  const header = req.headers["x-hub-signature-256"];
  if (!req.rawBody) {
    logger.error("[InstagramWebhook]", "Corpo bruto ausente — verifique a configuração do express.json().");
    return res.status(500).json({ erro: "Não foi possível validar a requisição." });
  }

  if (!assinaturaValida(req.rawBody, header, appSecret)) {
    logger.warn("[InstagramWebhook]", "Assinatura inválida — requisição rejeitada.");
    return res.status(401).json({ erro: "Assinatura inválida." });
  }

  next();
}

module.exports = { verificarAssinaturaMeta, assinaturaValida, calcularAssinatura };
