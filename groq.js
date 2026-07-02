// lib/groq.js
// Bot 4 — Copywriter IA, usando Groq (Llama) em vez da Anthropic.
// A chave fica só aqui no servidor — nunca no navegador.
//
// A IA só gera nome curto + texto curto (sem preço/cupom/link — isso o
// código monta, com número exato). Ver copywriter.js para o motivo.

async function gerarCopyGroq({ produto, precoAntigo, precoAtual, cupom, loja }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const pctTxt = precoAntigo > 0
    ? `${Math.round(((precoAntigo - precoAtual) / precoAntigo) * 100)}% OFF`
    : "sem desconto calculado";

  const prompt = `Você é um copywriter brasileiro especialista em ofertas de afiliados, escrevendo pra mandar no WhatsApp.

Produto (título cru, de SEO, pode estar bagunçado): ${produto}
Loja: ${loja}
Desconto: ${pctTxt}
Cupom: ${cupom || "nenhum"}

Sua tarefa tem DUAS partes:

1) "titulo": reescreva o nome do produto de forma CURTA e natural (máx. 45 caracteres) — como uma pessoa falaria, não como uma ficha técnica. Corte specs redundantes, tamanho/cor só se for essencial, e remova qualquer coisa que pareça palavra-chave de SEO empilhada.

2) "texto": 1 a 2 linhas curtas (máx. 140 caracteres no total), persuasivas, adaptadas ao TIPO de produto — o tom muda conforme a categoria:
   - Eletrônicos/gadgets: praticidade, "vale a pena"
   - Beleza/skincare: cuidado, autoestima, resultado
   - Suplementos/fitness: energia, resultado, disciplina
   - Casa/utilidades: praticidade do dia a dia
   - Moda: estilo, custo-benefício
   NÃO inclua preço, cupom ou link no texto — isso é adicionado depois pelo sistema. NÃO repita a mesma frase de urgência sempre ("corre que pode sumir") — varie a abordagem conforme o produto.

Responda APENAS em JSON puro, sem markdown, neste formato exato:
{"titulo": "nome curto do produto", "texto": "1 a 2 linhas curtas, sem preço/cupom/link", "hashtags": ["#tag1", "#tag2", "#tag3"]}`;

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
