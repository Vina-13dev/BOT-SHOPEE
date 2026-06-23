// lib/afiliado.js
// Bot Afiliados — monta o link final de cada loja usando o perfil de afiliado
// salvo pelo usuário (Firestore: config_afiliado/{uid}).
//
// Formato esperado de "afiliado":
// {
//   shopee: { nome, id, linkBase },
//   mercadolivre: { idParceiro, linkParceiro },
//   amazon: { tag }
// }
//
// Se o campo necessário não existir, devolve o link original sem alteração
// (em vez de quebrar ou inventar um id).

function gerarLinkAfiliado(loja, link, afiliado = {}) {
  if (!link) return null;

  const sep = link.includes("?") ? "&" : "?";

  if (loja === "Shopee" && afiliado.shopee?.id) {
    return `${link}${sep}affiliate=${afiliado.shopee.id}`;
  }

  if (loja === "Mercado Livre" && afiliado.mercadolivre?.idParceiro) {
    return `${link}${sep}matt_tool=${afiliado.mercadolivre.idParceiro}`;
  }

  if (loja === "Amazon" && afiliado.amazon?.tag) {
    return `${link}${sep}tag=${afiliado.amazon.tag}`;
  }

  return link;
}

module.exports = { gerarLinkAfiliado };
