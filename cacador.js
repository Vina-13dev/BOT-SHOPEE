// cacador.js — Mercado Livre via API oficial (sem Puppeteer, sem bloqueio)
const https = require('https');
const cron  = require('node-cron');

let ultimasOfertas = [];
let ultimaExecucao = null;

// ─── HTTP helper ─────────────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    https.get({
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
        'Accept-Language': 'pt-BR',
      },
      timeout: 15000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

// ─── TinyURL ─────────────────────────────────────────────────────────────────
async function encurtarLink(url) {
  if (!url) return url;
  return new Promise(resolve => {
    https.get(
      `https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`,
      { timeout: 6000 },
      res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve(d.trim().startsWith('http') ? d.trim() : url));
      }
    ).on('error', () => resolve(url)).on('timeout', function() { this.destroy(); resolve(url); });
  });
}

function limparPreco(v) {
  if (!v && v !== 0) return 0;
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  const s = String(v).replace(/R\$\s*/gi,'').replace(/\s/g,'');
  const m = s.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:,\d{2})?)/);
  if (!m) return 0;
  return parseFloat(m[1].replace(/\.(?=\d{3})/g,'').replace(',','.')) || 0;
}

function uid(p) { return `${p}-${Date.now()}-${Math.random().toString(36).substr(2,9)}`; }

function gerarLinkAfiliadoML(link) {
  const mlId = process.env.ML_AFFILIATE_ID || '';
  if (!mlId || !link) return link;
  const sep = link.includes('?') ? '&' : '?';
  return `${link}${sep}matt_tool=${mlId}&matt_word=&matt_source=bot`;
}

// ─── Mercado Livre via API oficial ───────────────────────────────────────────
async function buscarMercadoLivre() {
  console.log('[Caçador] ML: buscando via API oficial...');

  // Categorias com mais desconto e variedade
  const buscas = [
    'https://api.mercadolibre.com/sites/MLB/search?q=eletronicos&sort=relevance&limit=20',
    'https://api.mercadolibre.com/sites/MLB/search?q=celular&sort=relevance&limit=20',
    'https://api.mercadolibre.com/sites/MLB/search?category=MLB1051&sort=relevance&limit=20', // Eletrônicos
    'https://api.mercadolibre.com/sites/MLB/search?q=notebook&sort=relevance&limit=10',
    'https://api.mercadolibre.com/sites/MLB/search?q=tv+smart&sort=relevance&limit=10',
  ];

  const vistos = new Set();
  const todos  = [];

  for (const url of buscas) {
    try {
      console.log(`[Caçador] ML API: ${url.split('?')[1]?.slice(0,40)}`);
      const res = await httpGet(url);
      console.log(`[Caçador] ML API status: ${res.status}`);

      if (res.status !== 200) continue;

      const json = JSON.parse(res.body);
      const items = json?.results || [];
      console.log(`[Caçador] ML API: ${items.length} itens`);

      for (const item of items) {
        if (vistos.has(item.id)) continue;
        vistos.add(item.id);

        const precoAtual  = limparPreco(item.price || 0);
        const precoAntigo = limparPreco(item.original_price || 0);

        // Só aceita se tem preço válido
        if (precoAtual <= 0) continue;
        // Preço antigo deve ser maior que atual (se existir)
        if (precoAntigo > 0 && precoAntigo <= precoAtual) continue;

        // Imagem em alta resolução
        let imagemUrl = item.thumbnail || '';
        // ML retorna thumb em baixa res — converte para alta
        imagemUrl = imagemUrl.replace('-I.jpg','-O.jpg').replace('http://','https://');

        const link   = item.permalink || '';
        const linkAf = gerarLinkAfiliadoML(link);
        const linkEnc = await encurtarLink(linkAf || link);

        todos.push({
          id:            uid('ml'),
          produto:       (item.title || '').trim(),
          loja:          'Mercado Livre',
          categoria:     item.category_id || 'Eletrônicos',
          precoAntigo,
          precoAtual,
          comissaoPct:   8,
          cupom:         null,
          relampago:     false,
          link,
          linkAfiliado:  linkAf || link,
          linkEncurtado: linkEnc,
          imagemUrl,
          encontradoEm:  new Date().toISOString(),
        });

        const desc = precoAntigo > 0 ? ` | ${Math.round((precoAntigo-precoAtual)/precoAntigo*100)}% OFF` : '';
        console.log(`  ✓ ${item.title?.slice(0,50)} — R$${precoAtual}${desc}`);
      }
    } catch(e) {
      console.error(`[Caçador] ML API erro: ${e.message}`);
    }
  }

  console.log(`[Caçador] ML: ${todos.length} oferta(s) válidas no total.`);
  return todos.slice(0, 20); // máximo 20 ofertas
}

// ─── Principal ───────────────────────────────────────────────────────────────
async function buscarOfertas() {
  const ml = await buscarMercadoLivre().catch(e => {
    console.error('[ML erro fatal]', e.message);
    return [];
  });
  return ml;
}

async function executarVarredura() {
  try {
    const ofertas = await buscarOfertas();
    ultimasOfertas = ofertas;
    ultimaExecucao = new Date().toISOString();
    console.log(`[Bot Caçador] Concluído — ${ofertas.length} oferta(s).`);
  } catch(e) { console.error('[Bot Caçador] Erro:', e.message); }
}

function iniciarCacador({ intervaloCron = '*/15 * * * *' } = {}) {
  executarVarredura();
  cron.schedule(intervaloCron, executarVarredura);
}

function getUltimasOfertas() { return { ofertas: ultimasOfertas, ultimaExecucao }; }
module.exports = { iniciarCacador, getUltimasOfertas, buscarOfertas };
