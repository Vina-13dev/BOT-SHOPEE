// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");

const { parseLink } = require("./lib/parseLink");
const { gerarCopy } = require("./lib/copywriter");
const { getUltimasOfertas, buscarOfertas } = require("./lib/cacador");
const { calcularOferta } = require("./lib/classificador");
const { gerarLinkAfiliado } = require("./lib/afiliado");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors()); // em produção, restrinja para o domínio do seu painel
app.use(express.json());

// GET /
app.get("/", (req, res) => {
  res.json({
    status: "online",
    sistema: "Bot Shopee",
    versao: "1.0.0",
    ambiente: process.env.NODE_ENV || "production",
  });
});

// POST /api/parse-link  { url }
// Bot Caçador (modo manual) — lê um link colado pelo usuário.
app.post("/api/parse-link", async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) {
      return res.status(400).json({ erro: "Campo obrigatório: url" });
    }
    const dados = await parseLink(url);
    res.json(dados);
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// POST /api/gerar-oferta
// { produto, loja, precoAntigo, precoAtual, comissaoPct, cupom, link, imagemUrl, afiliado }
//
// "afiliado" é opcional: { shopee:{id}, mercadolivre:{idParceiro}, amazon:{tag} }.
// O painel envia o perfil que o usuário salvou no Firestore (config_afiliado)
// junto com a requisição — o backend não guarda mais essa config em memória,
// porque isso vazaria entre usuários diferentes do mesmo painel.
app.post("/api/gerar-oferta", async (req, res) => {
  try {
    const { produto, loja, precoAntigo, precoAtual, comissaoPct, cupom, link, imagemUrl, afiliado } = req.body || {};

    const faltando = [];
    if (!produto) faltando.push("produto");
    if (precoAntigo === undefined || precoAntigo === null || precoAntigo === "") faltando.push("precoAntigo");
    if (precoAtual === undefined || precoAtual === null || precoAtual === "") faltando.push("precoAtual");
    if (comissaoPct === undefined || comissaoPct === null || comissaoPct === "") faltando.push("comissaoPct");

    if (faltando.length) {
      return res.status(400).json({
        erro: `Campos obrigatórios faltando: ${faltando.join(", ")}`,
      });
    }

    const precoAntigoNum = Number(precoAntigo);
    const precoAtualNum = Number(precoAtual);
    const comissaoPctNum = Number(comissaoPct);

    if ([precoAntigoNum, precoAtualNum, comissaoPctNum].some((n) => Number.isNaN(n))) {
      return res.status(400).json({
        erro: "precoAntigo, precoAtual e comissaoPct precisam ser números válidos",
      });
    }

    if (precoAntigoNum <= 0 || precoAtualNum <= 0) {
      return res.status(400).json({
        erro: "precoAntigo e precoAtual precisam ser maiores que zero",
      });
    }

    const calculo = calcularOferta({
      precoAntigo: precoAntigoNum,
      precoAtual: precoAtualNum,
      comissaoPct: comissaoPctNum,
    });
    const copy = await gerarCopy({
      produto,
      precoAntigo: precoAntigoNum,
      precoAtual: precoAtualNum,
      cupom,
      loja,
    });

    res.json({
      id: `gen-${Date.now()}`,
      produto,
      loja,
      precoAntigo: precoAntigoNum,
      precoAtual: precoAtualNum,
      comissaoPct: comissaoPctNum,
      cupom: cupom || null,
      link: link || null,
      imagemUrl: imagemUrl || null,
      linkAfiliado: gerarLinkAfiliado(loja, link, afiliado || {}) || "https://shope.ee/aff-marcos",
      ...calculo,
      copy,
      criadoEm: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// GET /api/cacador/ofertas
// Legado: só devolve algo se você chamar POST /api/cacador/rodar manualmente
// nesta mesma instância. A varredura de verdade, recorrente, agora roda pelo
// GitHub Actions e grava direto no Firestore (coleção "ofertas") — o painel
// lê de lá direto, sem precisar bater aqui.
app.get("/api/cacador/ofertas", (req, res) => {
  res.json(getUltimasOfertas());
});

// POST /api/cacador/rodar
// Dispara uma varredura manual nesta instância — útil só para testar
// localmente o esqueleto do Bot Caçador sem esperar o GitHub Actions.
app.post("/api/cacador/rodar", async (req, res) => {
  try {
    const ofertas = await buscarOfertas();
    res.json({ ok: true, ofertas });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// GET /api/status
app.get("/api/status", (req, res) => {
  res.json({
    backend: true,
    bots: true,
    railway: true,
    firebase: true,
    timestamp: Date.now(),
  });
});

// GET /api/bots
app.get("/api/bots", (req, res) => {
  res.json({
    cacador: true,
    copywriter: true,
    classificador: true,
  });
});

// GET /api/health
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    server: true,
    bots: true,
    timestamp: new Date().toISOString(),
  });
});

// ---------- Tratamento global de erros ----------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erro: "Erro interno do servidor" });
});

app.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
  console.log("API online.");
  console.log("Railway conectado.");
  console.log("Bot Caçador: a varredura recorrente roda pelo GitHub Actions, não aqui dentro.");
});
