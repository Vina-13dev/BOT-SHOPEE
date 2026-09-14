const { test } = require("node:test");
const assert = require("node:assert/strict");
const { matchesKeyword, encontrarTriggerCorrespondente } = require("../src/automations/matcher");

// ---------- CONTAINS ----------
test("CONTAINS: variações de maiúscula/pontuação/emoji batem", () => {
  assert.equal(matchesKeyword("QUERO", "quero", "CONTAINS"), true);
  assert.equal(matchesKeyword("Quero!", "quero", "CONTAINS"), true);
  assert.equal(matchesKeyword("eu quero", "quero", "CONTAINS"), true);
  assert.equal(matchesKeyword("EU QUERO ❤️", "quero", "CONTAINS"), true);
});

test("CONTAINS: não casa 'quero' dentro de outra palavra (fronteira de palavra)", () => {
  assert.equal(matchesKeyword("fiz um requerimento", "quero", "CONTAINS"), false);
});

test("CONTAINS: não casa palavra não relacionada", () => {
  assert.equal(matchesKeyword("lindo demais", "quero", "CONTAINS"), false);
});

// ---------- EXACT ----------
test("EXACT: só bate frase idêntica (após normalizar)", () => {
  assert.equal(matchesKeyword("quero", "quero", "EXACT"), true);
  assert.equal(matchesKeyword("QUERO!!", "quero", "EXACT"), true);
  assert.equal(matchesKeyword("eu quero", "quero", "EXACT"), false);
});

// ---------- STARTS_WITH ----------
test("STARTS_WITH: bate no início", () => {
  assert.equal(matchesKeyword("quero o link por favor", "quero", "STARTS_WITH"), true);
  assert.equal(matchesKeyword("eu quero", "quero", "STARTS_WITH"), false);
});

// ---------- acentos ----------
test("acentuação não importa", () => {
  assert.equal(matchesKeyword("vc tem tênis?", "tenis", "CONTAINS"), true);
});

// ---------- múltiplos triggers no mesmo Reel ----------
test("Reel com vários produtos — cada palavra-chave aciona o trigger certo", () => {
  const automation = {
    triggers: [
      { id: "t1", keywords: ["tenis", "tênis"], mode: "CONTAINS", response: { text: "link do tênis" } },
      { id: "t2", keywords: ["calca", "calça"], mode: "CONTAINS", response: { text: "link da calça" } },
      { id: "t3", keywords: ["blusa"], mode: "CONTAINS", response: { text: "link da blusa" } },
    ],
  };
  assert.equal(encontrarTriggerCorrespondente(automation, "quero o tênis").id, "t1");
  assert.equal(encontrarTriggerCorrespondente(automation, "manda a calça").id, "t2");
  assert.equal(encontrarTriggerCorrespondente(automation, "quero a blusa").id, "t3");
  assert.equal(encontrarTriggerCorrespondente(automation, "muito bonito"), null);
});

test("Reel A nunca aciona trigger configurado só no Reel B", () => {
  const automationReelA = {
    mediaId: "A",
    triggers: [{ id: "a1", keywords: ["tenis"], mode: "CONTAINS", response: { text: "link tênis A" } }],
  };
  const automationReelB = {
    mediaId: "B",
    triggers: [{ id: "b1", keywords: ["calca"], mode: "CONTAINS", response: { text: "link calça B" } }],
  };
  // simula: comentário "calça" no Reel A não deve achar nada, pois a automação do Reel A não tem esse trigger
  assert.equal(encontrarTriggerCorrespondente(automationReelA, "quero a calça"), null);
  assert.equal(encontrarTriggerCorrespondente(automationReelB, "quero a calça").id, "b1");
});

test("keyword vazia nunca bate com nada", () => {
  assert.equal(matchesKeyword("qualquer coisa", "", "CONTAINS"), false);
});

test("comentário vazio nunca bate", () => {
  assert.equal(matchesKeyword("", "quero", "CONTAINS"), false);
});
