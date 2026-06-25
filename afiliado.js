// lib/afiliado.js
// Bot Afiliados — monta o link final de cada loja usando o perfil de afiliado
// salvo pelo usuário (Firestore: config_afiliado/{uid}).
//
// Formato esperado de "afiliado":
// {
//   shopee: { nome, id, linkBase },
//   mercadolivre: { idParceiro, word },   <-- "word" é o que faltava
//   amazon: { tag }
// }
//
// IMPORTANTE sobre o Mercado Livre: o rastreio de comissão exige DOIS
// parâmetros juntos — matt_word (a "palavra"/usuário da sua conta de afiliado)
// e matt_tool (o ID da ferramenta). Mandar só um dos dois faz o Mercado Livre
// não reconhecer o clique como vindo de você, mesmo que o link pareça certo.
// É por isso que o link gerado aqui era diferente do link que o próprio
// Mercado Livre dá no gerador oficial dele.
//
// Pra pegar os dois valores: gere um link manualmente no Portal do Afiliado
// do Mercado Livre, e olhe a URL resultante — ela terá
// "?matt_word=SEUNOME&matt_tool=12345678". Salve esses dois valores em
// config_afiliado/{uid}.mercadolivre = { word: "SEUNOME", idParceiro: "12345678" }.
//
// Se o campo necessário não existir, devolve o link original sem alteração
// (em vez de quebrar ou inventar um id).

function gerarLinkAfiliado(loja, link, afiliado = {}) {
  if (!link) return null;

  const sep = link.includes("?") ? "&" : "?";

  if (loja === "Shopee" && afiliado.shopee?.id) {
    return `${link}${sep}affiliate=${afiliado.shopee.id}`;
  }

  if (loja === "Mercado Livre") {
    const { idParceiro, word } = afiliado.mercadolivre || {};
    if (idParceiro && word) {
      return `${link}${sep}matt_word=${word}&matt_tool=${idParceiro}`;
    }
    // sem os dois valores, o link não vai rastrear comissão — melhor avisar
    // no log do que devolver um link "quase certo" que parece funcionar mas não paga.
    if (idParceiro || word) {
      console.warn(
        "[Bot Afiliados] Mercado Livre: faltam dados — preencha matt_word E matt_tool em config_afiliado, os dois juntos são obrigatórios."
      );
    }
    return link;
  }

  if (loja === "Amazon" && afiliado.amazon?.tag) {
    return `${link}${sep}tag=${afiliado.amazon.tag}`;
  }

  return link;
}

module.exports = { gerarLinkAfiliado };
