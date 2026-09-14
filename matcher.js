// src/automations/matcher.js
// Decide se um comentário "bate" com uma palavra-chave configurada, e qual
// gatilho de uma automação (que pode ter vários, ex: um Reel com 3 produtos)
// deve responder.

const { normalizeText } = require("../utils/normalize");

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// CONTAINS usa fronteira de palavra — "quero" não deve casar dentro de
// "requerimento". EXACT compara a frase inteira. STARTS_WITH compara o
// início.
function matchesKeyword(commentText, keyword, mode = "CONTAINS") {
  const comentario = normalizeText(commentText);
  const chave = normalizeText(keyword);
  if (!chave) return false;

  switch (mode) {
    case "EXACT":
      return comentario === chave;
    case "STARTS_WITH":
      return comentario.startsWith(chave);
    case "CONTAINS":
    default: {
      const re = new RegExp(`(^|\\s)${escapeRegex(chave)}(\\s|$)`, "u");
      return re.test(comentario);
    }
  }
}

// Percorre os triggers de UMA automação (em ordem) e devolve o primeiro que
// bater com alguma das keywords dele. null se nenhum bater.
function encontrarTriggerCorrespondente(automation, commentText) {
  if (!automation || !Array.isArray(automation.triggers)) return null;
  for (const trigger of automation.triggers) {
    const keywords = Array.isArray(trigger.keywords) ? trigger.keywords : [];
    const mode = trigger.mode || "CONTAINS";
    if (keywords.some((k) => matchesKeyword(commentText, k, mode))) {
      return trigger;
    }
  }
  return null;
}

module.exports = { matchesKeyword, encontrarTriggerCorrespondente, escapeRegex };
