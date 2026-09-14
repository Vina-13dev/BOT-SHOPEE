const { test } = require("node:test");
const assert = require("node:assert/strict");
const webhook = require("../src/instagram/webhook");

test("parsing: formato padrão com entry.changes[]", () => {
  const entry = {
    id: "123",
    time: 1234567890,
    changes: [{ field: "comments", value: { id: "c1", text: "quero", media: { id: "m1" } } }],
  };
  const mudancas = webhook.extrairMudancas(entry);
  assert.equal(mudancas.length, 1);
  assert.equal(mudancas[0].field, "comments");
  assert.equal(mudancas[0].value.id, "c1");
});

test("parsing: formato alternativo com field/value direto no entry", () => {
  const entry = {
    id: "123",
    time: 1234567890,
    field: "comments",
    value: { id: "c2", text: "quero", media: { id: "m1" } },
  };
  const mudancas = webhook.extrairMudancas(entry);
  assert.equal(mudancas.length, 1);
  assert.equal(mudancas[0].value.id, "c2");
});

test("parsing: entry sem changes nem field/value não quebra, devolve vazio", () => {
  const mudancas = webhook.extrairMudancas({ id: "123", time: 111 });
  assert.deepEqual(mudancas, []);
});
