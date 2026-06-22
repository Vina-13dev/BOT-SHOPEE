// lib/groq.js
// Bot 4 — Copywriter IA, usando Groq (Llama) em vez da Anthropic.
// A chave fica só aqui no servidor — nunca no navegador.

function fmt(n) {
  return `R$ ${Number(n).toFixed(2).replace(".", ",")}`;
}

async function gerarCopyGroq({ produto, precoAntigo, precoAtual, cupom, loja }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const prompt = `Você é um copywriter brasileiro especialista em ofertas de afiliados. Gere um texto curto e persuasivo de divulgação para esta oferta, em português do Brasil, tom animado e urgente, usando emojis com moderação.

Produto: ${produto}
Loja: ${loja}
Preço antigo: ${fmt(precoAntigo)}
Preço atual: ${fmt(precoAtual)}
Cupom: ${cupom || "nenhum"}

Responda APENAS em JSON puro, sem markdown, neste formato exato:
{"titulo": "string curta chamativa", "texto": "2 a 4 linhas separadas por \\n, prontas para postar", "hashtags": ["#tag1", "#tag2", "#tag3"]}`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
    }),
  });

  if (!res.ok) {
    throw new Error(`Groq respondeu ${res.status}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Resposta da Groq sem conteúdo");
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

module.exports = { gerarCopyGroq };
