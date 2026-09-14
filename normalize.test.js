const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeText } = require("../src/utils/normalize");

test("minúsculas e trim", () => {
  assert.equal(normalizeText("  QUERO  "), "quero");
});

test("remove pontuação", () => {
  assert.equal(normalizeText("quero!!!"), "quero");
});

test("remove acento", () => {
  assert.equal(normalizeText("Não é possível"), "nao e possivel");
});

test("remove emoji", () => {
  assert.equal(normalizeText("EU QUERO ❤️😍"), "eu quero");
});

test("colapsa espaços extras", () => {
  assert.equal(normalizeText("eu   quero    muito"), "eu quero muito");
});

test("texto vazio/nulo não quebra", () => {
  assert.equal(normalizeText(null), "");
  assert.equal(normalizeText(undefined), "");
  assert.equal(normalizeText(""), "");
});

test("mantém números", () => {
  assert.equal(normalizeText("tamanho 42, por favor"), "tamanho 42 por favor");
});
