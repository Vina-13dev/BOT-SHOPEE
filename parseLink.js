// lib/parseLink.js
// Lê uma página de produto (Shopee, Amazon, Mercado Livre, AliExpress, etc.)
// e tenta extrair: título, imagem e preço.
//
// IMPORTANTE — limitações reais:
// - Funciona bem em sites que usam meta tags Open Graph (og:title, og:image, og:price)
//   ou JSON-LD (schema.org/Product), que é o padrão da maioria das lojas.
// - Shopee e Mercado Livre carregam parte do conteúdo via JavaScript. Em alguns links
//   o preço pode não vir no HTML puro — nesse caso a função retorna o que encontrar
//   (geralmente título e imagem) e deixa o preço em branco para o usuário confirmar.
// - Para 100% de confiabilidade em todas as lojas, o ideal é usar as APIs oficiais de
//   afiliados de cada uma (Shopee Affiliate API, Amazon PA-API, etc.) — ver README.

const cheerio = require("cheerio");

const PRICE_REGEX = /r\$\s*([\d.,]+)/i;

function parsePriceFromText(text) {
  if (!text) return null;
  const match = text.match(PRICE_REGEX);
  if (!match) return null;
  const raw = match[1].replace(/\.(?=\d{3})/g, "").replace(",", ".");
  const value = parseFloat(raw);
  return isNaN(value) ? null : value;
}

function extractJsonLdProduct($) {
  let product = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (product) return;
    try {
      const json = JSON.parse($(el).contents().text());
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        if (item["@type"] === "Product" || (Array.isArray(item["@type"]) && item["@type"].includes("Product"))) {
          product = item;
        }
      }
    } catch (e) {
      // ignora JSON-LD malformado
    }
  });
  return product;
}

async function parseLink(url) {
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error("URL inválida. Use um link completo começando com http:// ou https://");
  }

  const res = await fetch(url, {
    headers: {
      // alguns sites bloqueiam requisições sem User-Agent de navegador
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`Não foi possível acessar o link (status ${res.status}). O site pode estar bloqueando acesso automático.`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const ogTitle = $('meta[property="og:title"]').attr("content");
  const ogImage = $('meta[property="og:image"]').attr("content");
  const ogPriceAmount = $('meta[property="product:price:amount"]').attr("content") ||
                         $('meta[property="og:price:amount"]').attr("content");

  const jsonLd = extractJsonLdProduct($);

  const titulo =
    ogTitle ||
    (jsonLd && jsonLd.name) ||
    $("title").first().text().trim() ||
    null;

  const imagem =
    ogImage ||
    (jsonLd && jsonLd.image && (Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image)) ||
    null;

  let preco = null;
  if (ogPriceAmount) {
    preco = parseFloat(String(ogPriceAmount).replace(",", "."));
  } else if (jsonLd && jsonLd.offers) {
    const offer = Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers;
    if (offer && offer.price) preco = parseFloat(String(offer.price).replace(",", "."));
  }
  if (preco === null || isNaN(preco)) {
    preco = parsePriceFromText($("body").text().slice(0, 20000));
  }

  return {
    url,
    titulo: titulo ? titulo.trim().slice(0, 200) : null,
    imagem: imagem || null,
    preco: preco && !isNaN(preco) ? preco : null,
    avisoPrecoNaoEncontrado: preco === null,
  };
}

module.exports = { parseLink, parsePriceFromText, extractJsonLdProduct };
