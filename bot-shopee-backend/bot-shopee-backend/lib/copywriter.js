// lib/copywriter.js
// Bot 4 — Copywriter IA.
// Ordem de tentativa: Groq (se houver GROQ_API_KEY) -> Anthropic (se houver
// ANTHROPIC_API_KEY) -> texto padrão. Tudo roda NO SERVIDOR, as chaves nunca
// ficam expostas no navegador.

const { gerarCopyGroq } = require("./groq");

function fmt(n) {
  return `R$ ${Number(n).toFixed(2).replace(".", ",")}`;
}

function fallbackCopy(produto, precoAtual, precoAntigo, cupom) {
  const pct = Math.round(((precoAntigo - precoAtual) / precoAntigo) * 100);
  const linhas = [
    `🔥 ${produto} com ${pct}% OFF`,
    `De ${fmt(precoAntigo)} por ${fmt(precoAtual)}`,
    cupom ? `⚠ Use o cupom ${cupom} antes que acabe` : `🚨 Estoque limitado`,
    `Corre que essa pode sumir do site!`,
  ];
  return { titulo: `${produto} — ${pct}% OFF`, texto: linhas.join("\n"), hashtags: ["#promocao", "#achadinhos", "#oferta"] };
}

async function gerarCopy({ produto, precoAntigo, precoAtual, cupom, loja }) {
  // 1) tenta Groq primeiro (mais rápido e gratuito na maioria dos casos)
  if (process.env.GROQ_API_KEY) {
    try {
      const groqResult = await gerarCopyGroq({ produto, precoAntigo, precoAtual, cupom, loja });
      if (groqResult) return groqResult;
    } catch (e) {
      console.warn("[Copywriter] Groq falhou, tentando Anthropic:", e.message);
    }
  }

  // 2) tenta Anthropic
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // nenhuma IA configurada, usa texto padrão para não travar o fluxo
    return fallbackCopy(produto, precoAtual, precoAntigo, cupom);
  }

  const prompt = `Você é um copywriter brasileiro especialista em ofertas de afiliados. Gere um texto curto e persuasivo de divulgação para esta oferta, em português do Brasil, tom animado e urgente, usando emojis com moderação.

Produto: ${produto}
Loja: ${loja}
Preço antigo: ${fmt(precoAntigo)}
Preço atual: ${fmt(precoAtual)}
Cupom: ${cupom || "nenhum"}

Responda APENAS em JSON puro, sem markdown, neste formato exato:
{"titulo": "string curta chamativa", "texto": "2 a 4 linhas separadas por \\n, prontas para postar", "hashtags": ["#tag1", "#tag2", "#tag3"]}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    const block = (data.content || []).find((c) => c.type === "text");
    if (!block) throw new Error("Resposta da IA sem texto");
    const clean = block.text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch (e) {
    return fallbackCopy(produto, precoAtual, precoAntigo, cupom);
  }
}

module.exports = { gerarCopy, fallbackCopy };
