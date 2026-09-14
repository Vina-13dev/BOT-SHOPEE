const { test } = require("node:test");
const assert = require("node:assert/strict");
const { exigirAutenticacao } = require("../src/middleware/auth");
const admin = require("../src/firebase/admin");

function criarResMock() {
  const res = {};
  res.statusCode = null;
  res.body = null;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

test("sem header Authorization -> 401", async () => {
  const req = { headers: {} };
  const res = criarResMock();
  let chamouNext = false;
  await exigirAutenticacao(req, res, () => { chamouNext = true; });
  assert.equal(chamouNext, false);
  assert.equal(res.statusCode, 401);
});

test("header mal formatado -> 401", async () => {
  const req = { headers: { authorization: "Token abc" } };
  const res = criarResMock();
  let chamouNext = false;
  await exigirAutenticacao(req, res, () => { chamouNext = true; });
  assert.equal(chamouNext, false);
  assert.equal(res.statusCode, 401);
});

test("token inválido (Firebase recusa) -> 401, não deixa passar", async (t) => {
  t.mock.method(admin, "verificarIdToken", async () => { throw new Error("Token expirado"); });
  const req = { headers: { authorization: "Bearer token-invalido" } };
  const res = criarResMock();
  let chamouNext = false;
  await exigirAutenticacao(req, res, () => { chamouNext = true; });
  assert.equal(chamouNext, false);
  assert.equal(res.statusCode, 401);
});

test("token válido -> chama next() e anexa req.usuario", async (t) => {
  t.mock.method(admin, "verificarIdToken", async () => ({ uid: "usuario-123" }));
  const req = { headers: { authorization: "Bearer token-valido" } };
  const res = criarResMock();
  let chamouNext = false;
  await exigirAutenticacao(req, res, () => { chamouNext = true; });
  assert.equal(chamouNext, true);
  assert.equal(req.usuario.uid, "usuario-123");
});
