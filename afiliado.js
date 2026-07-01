// lib/afiliado.js
// Bot Afiliados — monta o link final de cada loja usando o perfil de afiliado
// salvo pelo usuário (Firestore: config_afiliado/{uid}).
//
// Formato esperado de "afiliado":
// {
//   shopee: { nome, id, linkBase },
//   mercadolivre: { idParceiro },
//   amazon: { tag }
// }
//
// SOBRE O MERCADO LIVRE: o programa atual (Afiliados e Criadores) usa um ID
// de afiliado simples no parâmetro "affiliate", igual Shopee/Amazon — não o
// esquema antigo de matt_word+matt_tool. Se um dia o Mercado Livre mudar o
// formato de novo, gere um link manual no Portal do Afiliado e compare com
// a URL resultante para atualizar aqui.
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
    const idParceiro = afiliado.mercadolivre?.idParceiro;
    if (idParceiro) {
      return `${link}${sep}affiliate=${idParceiro}`;
    }
    console.warn(
      "[Bot Afiliados] Mercado Livre: falta 'idParceiro' em config_afiliado — o link saiu sem rastreio de comissão."
    );
    return link;
  }

  if (loja === "Amazon" && afiliado.amazon?.tag) {
    return `${link}${sep}tag=${afiliado.amazon.tag}`;
  }

  return link;
}
module.exports = { gerarLinkAfiliado };
