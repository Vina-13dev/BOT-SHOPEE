// src/utils/normalize.js
// Normaliza texto de comentário/palavra-chave pra comparação confiável:
// minúsculas, sem acento, sem emoji, sem pontuação, espaços colapsados.
// "QUERO!!", "Quero", "eu quero ❤️" viram todos formas comparáveis.

function normalizeText(text, { stripAccents = true } = {}) {
  let t = String(text ?? "").toLowerCase().trim();

  // remove emojis (faixas Unicode mais comuns de emoji/pictograma/símbolo)
  t = t.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\uFE0F]/gu, "");

  if (stripAccents) {
    t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  // remove pontuação, mantém letras/números/espaço (Unicode-aware)
  t = t.replace(/[^\p{L}\p{N}\s]/gu, " ");

  t = t.replace(/\s+/g, " ").trim();
  return t;
}

module.exports = { normalizeText };
