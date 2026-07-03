// lib/groq.js
// Bot 4 — Copywriter IA, usando Groq (Llama) em vez da Anthropic.
// A chave fica só aqui no servidor — nunca no navegador.
//
// O prompt vem de copywriter.js (PROMPT_BASE) — um só lugar, pra Groq e
// Anthropic nunca ficarem dessincronizados de novo.

async function gerarCopyGroq(args) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const { PROMPT_BASE } = require("./copywriter");
  const prompt = PROMPT_BASE(args);

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.9, // mais variação entre chamadas — não queremos sempre a mesma frase
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
