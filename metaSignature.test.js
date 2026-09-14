const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { assinaturaValida, calcularAssinatura } = require("../src/middleware/metaSignature");

const SECRET = "meu-app-secret-de-teste";

test("assinatura correta é aceita", () => {
  const body = Buffer.from(JSON.stringify({ object: "instagram", entry: [] }));
  const assinatura = calcularAssinatura(body, SECRET);
  assert.equal(assinaturaValida(body, assinatura, SECRET), true);
});

test("assinatura errada é rejeitada", () => {
  const body = Buffer.from(JSON.stringify({ object: "instagram", entry: [] }));
  const assinaturaErrada = "sha256=" + "0".repeat(64);
  assert.equal(assinaturaValida(body, assinaturaErrada, SECRET), false);
});

test("corpo alterado depois de assinado é rejeitado", () => {
  const bodyOriginal = Buffer.from(JSON.stringify({ valor: 100 }));
  const assinatura = calcularAssinatura(bodyOriginal, SECRET);
  const bodyAlterado = Buffer.from(JSON.stringify({ valor: 999 }));
  assert.equal(assinaturaValida(bodyAlterado, assinatura, SECRET), false);
});

test("header ausente é rejeitado", () => {
  const body = Buffer.from("{}");
  assert.equal(assinaturaValida(body, undefined, SECRET), false);
});

test("header sem prefixo sha256= é rejeitado", () => {
  const body = Buffer.from("{}");
  const semPrefixo = crypto.createHmac("sha256", SECRET).update(body).digest("hex");
  assert.equal(assinaturaValida(body, semPrefixo, SECRET), false);
});

test("secret errado é rejeitado", () => {
  const body = Buffer.from("{}");
  const assinatura = calcularAssinatura(body, SECRET);
  assert.equal(assinaturaValida(body, assinatura, "outro-secret"), false);
});
