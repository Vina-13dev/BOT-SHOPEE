// lib/copywriter.js
// Bot 4 — Copywriter IA.
// Ordem de tentativa: Groq (se houver GROQ_API_KEY) -> Anthropic (se houver
// ANTHROPIC_API_KEY) -> texto padrão. Tudo roda NO SERVIDOR, as chaves nunca
// ficam expostas no navegador.
//
// IMPORTANTE: a IA NÃO gera preço nem link — só nome curto + texto curto.
// Preço/cupom/link são montados pelo código (número exato, sem risco de a
// IA "inventar" ou formatar errado).
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

// Textos de reserva variados (não sempre o mesmo) — só entram quando NENHUMA
// IA respondeu. Cada chamada sorteia um, pra não ficar repetitivo mesmo no
// pior caso.
const FALLBACKS_COM_CUPOM = [
  "Ative o cupom antes de finalizar 🎟",
  "Cupom aplicado nesse preço — não esquece de usar 🎟",
];
const FALLBACKS_SEM_CUPOM = [
  "Preço assim não fica no ar por muito tempo.",
  "Vale a pena garantir agora.",
  "Desconto real, sem pegadinha.",
];
function fallbackCopy(produto, precoAtual, precoAntigo, cupom) {
  const nome = nomeCurto(produto);
  const lista = cupom ? FALLBACKS_COM_CUPOM : FALLBACKS_SEM_CUPOM;
  const texto = lista[Math.floor(Math.random() * lista.length)];
  return { titulo: nome, texto, hashtags: ["#promocao", "#achadinhos", "#oferta"] };
}

// Monta a lista de sinais REAIS que a gente sabe do produto — a IA só pode
// usar prova social/confiança com base no que está aqui. Nunca inventa
// número (tipo "50 pessoas compraram agora") que a gente não confirmou.
function sinaisReais({ nota, vendas, freteGratis, vendedorLider }) {
  const sinais = [];
  if (nota) sinais.push(`nota ${nota} de quem já comprou`);
  if (vendas) sinais.push(`${vendas}+ vendidos`);
  if (freteGratis) sinais.push("frete grátis");
  if (vendedorLider) sinais.push("vendedor Mercado Líder (confiável)");
  return sinais;
}

const PROMPT_BASE = ({ produto, precoAtual, precoAntigo, cupom, loja, nota, vendas, freteGratis, vendedorLider }) => {
  const pct = precoAntigo > 0 ? Math.round(((precoAntigo - precoAtual) / precoAntigo) * 100) : 0;
  const sinais = sinaisReais({ nota, vendas, freteGratis, vendedorLider });

  return `Você é um copywriter brasileiro sênior, especialista em gatilhos de persuasão e psicologia do consumo, escrevendo pra mandar oferta de afiliado no WhatsApp.

Produto (título cru, de SEO, pode estar bagunçado): ${produto}
Loja: ${loja}
Desconto: ${pct > 0 ? `${pct}% OFF` : "sem desconto calculado"}
Cupom: ${cupom || "nenhum"}
Dados REAIS confirmados sobre esse produto: ${sinais.length ? sinais.join(", ") : "nenhum dado extra disponível"}

Sua tarefa tem DUAS partes:

1) "titulo": reescreva o nome do produto de forma CURTA e natural (máx. 45 caracteres) — como uma pessoa falaria, não como ficha técnica. Corte specs redundantes e qualquer coisa que pareça palavra-chave de SEO empilhada.

2) "texto": 1 a 2 linhas curtas (máx. 140 caracteres), escolhendo UMA técnica de persuasão que faça sentido pro produto e pros dados disponíveis — VARIE a escolha, não repita sempre a mesma:
   - Prova social real: SÓ SE houver nota/vendas/selo nos "dados REAIS" acima, use isso (ex: "nota 4.9 de quem já comprou, pode confiar"). Nunca invente número que não foi confirmado.
   - Benefício/resultado direto: o que a pessoa ganha usando o produto no dia a dia, não a ficha técnica.
   - Urgência honesta: baseada no desconto real (ex: "desconto desse tamanho não fica no ar"), sem inventar prazo ou estoque que você não sabe.
   - Comando direto e curto: frase de ação, sem enrolação (ex: "Garante o seu.").
   - Pergunta retórica curta que conecta com uma dor/desejo comum do tipo de produto.
   - Contraste/âncora: reforçar o quanto o desconto é bom sem repetir os números (o preço já aparece separado na mensagem, não repita).
   O tom muda pela categoria: eletrônicos = praticidade; beleza = cuidado/autoestima; suplementos/fitness = energia/disciplina; casa = praticidade do dia a dia; moda = estilo/custo-benefício.
   NÃO inclua preço, cupom ou link — isso já é adicionado pelo sistema. NÃO repita a mesma frase de urgência sempre. NÃO invente dado que não está em "dados REAIS confirmados".

Responda APENAS em JSON puro, sem markdown, neste formato exato:
{"titulo": "nome curto do produto", "texto": "1 a 2 linhas curtas, técnica variada, sem preço/cupom/link", "hashtags": ["#tag1", "#tag2", "#tag3"]}`;
};

async function gerarCopy(args) {
  const { produto, precoAntigo, precoAtual, cupom } = args;

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
    if (!process.env.GROQ_API_KEY) {
      console.warn("[Copywriter] Nenhuma IA configurada (falta GROQ_API_KEY ou ANTHROPIC_API_KEY) — usando texto padrão.");
    }
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
    console.warn("[Copywriter] Anthropic falhou:", e.message);
    return fallbackCopy(produto, precoAtual, precoAntigo, cupom);
  }
}
module.exports = { gerarCopy, fallbackCopy, nomeCurto, PROMPT_BASE };
