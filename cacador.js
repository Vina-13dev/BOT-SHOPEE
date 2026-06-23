// lib/cacador.js
// Bot 1 — Caçador de Ofertas.
//
// IMPORTANTE (atualizado): a varredura recorrente de verdade NÃO roda mais
// dentro do servidor Express/Railway, porque isso obrigaria o Railway a ficar
// ligado 24h (e isso custa). Agora ela roda pelo GitHub Actions, a cada 15 min,
// chamando `npm run cacador` (veja scripts/buscarOfertas.js), que importa a
// função `buscarOfertas()` deste arquivo. `iniciarCacador`/`node-cron` abaixo
// ficam disponíveis só para quem quiser testar localmente com o servidor
// rodando continuamente — o server.js de produção não chama mais isso.
//
// A função `buscarOfertas()` abaixo ainda não está ligada a nenhuma loja
// real — hoje ela só gera dados de exemplo, porque puxar ofertas de verdade
// exige UM destes caminhos (ver README):
//
//   1) Programas oficiais de afiliados com API (ex: Shopee Affiliate API,
//      Amazon PA-API, Lomadee/Awin — que agregam várias lojas BR).
//   2) Scraping direto do site (mais frágil: quebra quando o site muda o HTML,
//      pode exigir Puppeteer para páginas que carregam preço via JavaScript,
//      e deve respeitar os Termos de Uso de cada loja).
//
// Quando você tiver acesso a algum desses, é só substituir o corpo de
// `buscarOfertas()` por chamadas reais — o resto do pipeline (bots 2 a 7)
// já está pronto para receber qualquer oferta nesse formato.

const cron = require("node-cron");

let ultimasOfertas = [];
let ultimaExecucao = null;

async function buscarOfertas() {
  // TODO: substituir por chamada real à API de afiliados ou scraper de cada loja.
  // Formato esperado de cada oferta:
  return [
    {
      id: `auto-${Date.now()}`,
      produto: "Exemplo: Carregador Turbo 33W (placeholder)",
      loja: "Shopee",
      categoria: "Eletrônicos",
      precoAntigo: 79.9,
      precoAtual: 39.9,
      comissaoPct: 10,
      cupom: null,
      relampago: false,
      link: "https://shopee.com.br/exemplo",
      imagemUrl: null,
      encontradoEm: new Date().toISOString(),
    },
  ];
}

async function executarVarredura() {
  try {
    const ofertas = await buscarOfertas();
    ultimasOfertas = ofertas;
    ultimaExecucao = new Date().toISOString();
    console.log(`[Bot Caçador] Varredura concluída — ${ofertas.length} oferta(s) em ${ultimaExecucao}`);
  } catch (e) {
    console.error("[Bot Caçador] Erro na varredura:", e.message);
  }
}

function iniciarCacador({ intervaloCron = "0 * * * *" } = {}) {
  // padrão: roda a cada hora. Ex: "*/15 * * * *" roda a cada 15 minutos.
  executarVarredura(); // roda uma vez já na inicialização
  cron.schedule(intervaloCron, executarVarredura);
  console.log(`[Bot Caçador] Agendado com expressão cron "${intervaloCron}"`);
}

function getUltimasOfertas() {
  return { ofertas: ultimasOfertas, ultimaExecucao };
}

module.exports = { iniciarCacador, getUltimasOfertas, buscarOfertas };
