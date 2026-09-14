// src/middleware/auth.js
// Protege endpoints administrativos com o Firebase Auth do usuário
// (o mesmo login já usado no painel). O webhook da Meta NÃO passa por
// aqui — ele é protegido pela assinatura (ver metaSignature.js).

const admin = require("../firebase/admin");

async function exigirAutenticacao(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      const erro = new Error("Autenticação necessária. Faça login no painel.");
      erro.status = 401;
      throw erro;
    }
    req.usuario = await admin.verificarIdToken(match[1]);
    next();
  } catch (e) {
    res.status(e.status || 401).json({ erro: e.message || "Token inválido." });
  }
}

module.exports = { exigirAutenticacao };
