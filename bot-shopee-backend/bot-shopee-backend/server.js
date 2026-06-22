// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");

const { parseLink } = require("./lib/parseLink");
const { gerarCopy } = require("./lib/copywriter");
const { iniciarCacador, getUltimasOfertas } = require("./lib/cacador");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); // em produção, restrinja para o domínio do seu painel
app.use(express.json());

// ---------- Bot Afiliados + Classificador (cálculo puro, sem IA) ----------
function calcularOferta({ precoAntigo, precoAtual, comissaoPct }) {
  const descontoPct = ((precoAntigo - precoAtual) / precoAntigo) * 100;
  const ganhoEstimado = precoAtual * (comissaoPct / 100);

  const tierDesconto = descontoPct >= 50 ? "Excelente" : descontoPct >= 25 ? "Boa" : "Fraca";
  const tierComissao = comissaoPct >= 15 ? "Alta" : comissaoPct >= 7 ? "Média" : "Baixa";

  return {
    descontoPct: Math.round(descontoPct * 10) / 10,
    ganhoEstimado: Math.round(ganhoEstimado * 100) / 100,
    tierDesconto,
    tierComissao,
  };
}

// POST /api/parse-link  { url }
// Bot Caçador (modo manual) — lê um link colado pelo usuário.
app.post("/api/parse-link", async (req, res) => {
  try {
    const { url } = req.body;
    const dados = await parseLink(url);
    res.json(dados);
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// POST /api/gerar-oferta  { produto, loja, precoAntigo, precoAtual, comissaoPct, cupom, link, imagemUrl }
// Roda o pipeline completo: calcula desconto/comissão + gera texto com IA.
app.post("/api/gerar-oferta", async (req, res) => {
  try {
    const { produto, loja, precoAntigo, precoAtual, comissaoPct, cupom, link, imagemUrl } = req.body;
    if (!produto || precoAntigo == null || precoAtual == null || comissaoPct == null) {
      return res.status(400).json({ erro: "Campos obrigatórios: produto, precoAntigo, precoAtual, comissaoPct" });
    }

    const calculo = calcularOferta({ precoAntigo, precoAtual, comissaoPct });
    const copy = await gerarCopy({ produto, precoAntigo, precoAtual, cupom, loja });

    res.json({
      id: `gen-${Date.now()}`,
      produto, loja, precoAntigo, precoAtual, comissaoPct, cupom: cupom || null,
      link: link || null, imagemUrl: imagemUrl || null,
      linkAfiliado: link ? `${link}${link.includes("?") ? "&" : "?"}aff=marcos` : "https://shope.ee/aff-marcos",
      ...calculo,
      copy,
      criadoEm: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// GET /api/cacador/ofertas
// Bot Caçador (modo automático) — devolve as últimas ofertas encontradas pelo cron.
app.get("/api/cacador/ofertas", (req, res) => {
  res.json(getUltimasOfertas());
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Bot Shopee backend rodando em http://localhost:${PORT}`);
  iniciarCacador({ intervaloCron: process.env.CACADOR_CRON || "0 * * * *" });
});
