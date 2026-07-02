// lib/copywriter.js
// Bot 4 — Copywriter IA.
// Ordem de tentativa: Groq (se houver GROQ_API_KEY) -> Anthropic (se houver
// ANTHROPIC_API_KEY) -> texto padrão. Tudo roda NO SERVIDOR, as chaves nunca
// ficam expostas no navegador.
//
// IMPORTANTE: a IA NÃO gera preço nem link — só nome curto + texto curto.
// Preço/cupom/link são montados pelo código (número exato, sem risco de a
// IA "inventar" ou formatar errado). Isso também mantém a mensagem final
// do WhatsApp curta, já que o título de SEO do produto (que vem cru do
// scraping, às vezes com 150+ caracteres) nunca é usado direto — a IA
// devolve uma versão curta e limpa dele.
const { gerarCopyGroq } = require("./groq");

function fmt(n) {
  return `R$ ${Number(n).toFixed(2).replace(".", ",")}`;
}

// Limpa o título de SEO cru (corta em separadores tipo "|", remove excesso
// de vírgulas/specs, trunca) — usado como fallback quando não há IA.
function nomeCurto(produto) {
  if (!produto) return "Produto";
  let nome = produto.split("|")[0].split(",")[0].trim();
  if (nome.length > 55) nome = nome.slice(0, 52).trim() + "...";
  return nome;
}

function fallbackCopy(produto, precoAtual, precoAntigo, cupom) {
  const nome = nomeCurto(produto);
  const linhas = [
    cupom ? `Use o cupom antes que acabe 🎟` : `Corre que pode sumir do site 🏃`,
  ];
  return { titulo: nome, texto: linhas.join("\n"), hashtags: ["#promocao", "#achadinhos", "#oferta"] };
}

const PROMPT_BASE = ({ produto, precoAtual, precoAntigo, cupom, loja }) => `Você é um copywriter brasileiro especialista em ofertas de afiliados, escrevendo pra mandar no WhatsApp.

Produto (título cru, de SEO, pode estar bagunçado): ${produto}
Loja: ${loja}
Desconto: ${precoAntigo > 0 ? `${Math.round(((precoAntigo - precoAtual) / precoAntigo) * 100)}% OFF` : "sem desconto calculado"}
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

async function gerarCopy({ produto, precoAntigo, precoAtual, cupom, loja }) {
  const args = { produto, precoAntigo, precoAtual, cupom, loja };

  // 1) tenta Groq primeiro (mais rápido e gratuito na maioria dos casos)
  if (process.env.GROQ_API_KEY) {
    try {
      const groqResult = await gerarCopyGroq(args);
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
        max_tokens: 300,
        messages: [{ role: "user", content: PROMPT_BASE(args) }],
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
module.exports = { gerarCopy, fallbackCopy, nomeCurto };
