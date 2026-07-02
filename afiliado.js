// lib/afiliado.js
// Bot Afiliados — monta o link final de cada loja usando o perfil de afiliado
// salvo pelo usuário (Firestore: config_afiliado/{uid}).
//
// Formato esperado de "afiliado":
// {
//   shopee: { nome, id, linkBase },
//   amazon: { tag }
// }
//
// SOBRE O MERCADO LIVRE: confirmado na prática — NÃO dá pra montar o link de
// afiliado do ML colando um parâmetro na URL (tipo ?affiliate=ID). O ML não
// tem API pública pra isso; o link de verdade é um "meli.la/xxxxx" gerado
// pelo próprio servidor deles, só no Portal do Afiliado (site do ML), por
// produto, com a conta logada. Por isso essa função NÃO tenta gerar link de
// ML — devolve o link cru. No app (index.html), o usuário cola manualmente
// o meli.la depois de gerar no site do ML, e isso fica salvo por oferta em
// `links_prontos/{uid}`.
function gerarLinkAfiliado(loja, link, afiliado = {}) {
  if (!link) return null;
  const sep = link.includes("?") ? "&" : "?";

  if (loja === "Shopee" && afiliado.shopee?.id) {
    return `${link}${sep}affiliate=${afiliado.shopee.id}`;
  }

  if (loja === "Mercado Livre") {
    return link; // sem atalho — precisa ser gerado no Portal do Afiliado
  }

  if (loja === "Amazon" && afiliado.amazon?.tag) {
    return `${link}${sep}tag=${afiliado.amazon.tag}`;
  }

  return link;
}
module.exports = { gerarLinkAfiliado };
