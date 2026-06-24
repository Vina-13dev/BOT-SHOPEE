// cacador.js
// Estratégia por site:
//   Shopee       → API interna pública (JSON direto, sem Puppeteer)
//   Mercado Livre → API oficial gratuita (JSON direto, sem Puppeteer)
//   Amazon       → Puppeteer + stealth (scraping melhorado com logs detalhados)

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const randomUserAgent = require('random-useragent');
const cron = require('node-cron');
const https = require('https');

puppeteer.use(StealthPlugin());

const launchOptions = {
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--disable-web-security',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1366,768',
  ],
  ignoreHTTPSErrors: true,
};

let ultimasOfertas = [];
let ultimaExecucao = null;

// ─── helpers ────────────────────────────────────────────────────────────────

function limparPreco(texto) {
  if (!texto) return 0;
  const limpo = texto
    .replace(/R\$\s*/gi, '')
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3})/g, '')
    .replace(',', '.');
  return parseFloat(limpo) || 0;
}

function uid(prefixo) {
  return `${prefixo}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Faz requisição HTTPS simples e retorna o corpo como string
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/html, */*',
      'Accept-Language': 'pt-BR,pt;q=0.9',
      'Accept-Encoding': 'identity',
      ...headers,
    };
    const opts = new URL(url);
    const options = {
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      method: 'GET',
      headers: defaultHeaders,
      timeout: 20000,
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ─── Shopee via API interna ──────────────────────────────────────────────────

async function buscarShopee() {
  console.log('[Caçador] Shopee: tentando via API interna...');
  try {
    const url = 'https://shopee.com.br/api/v4/search/search_items?by=relevancy&keyword=eletronicos&limit=10&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2';
    const res = await httpGet(url, {
      'Referer': 'https://shopee.com.br/busca?keyword=eletronicos',
      'X-Requested-With': 'XMLHttpRequest',
    });

    console.log(`[Caçador] Shopee API status: ${res.status}`);

    if (res.status !== 200) throw new Error(`Status ${res.status}`);

    const json = JSON.parse(res.body);
    const items = json?.items || [];
    console.log(`[Caçador] Shopee: ${items.length} item(s) na API.`);

    return items.slice(0, 5).map(item => {
      const info = item.item_basic || item;
      const precoAtual  = Math.round((info.price || 0) / 100000 * 100) / 100;
      const precoAntigo = Math.round((info.price_before_discount || info.price || 0) / 100000 * 100) / 100;
      const shopid = info.shopid;
      const itemid = info.itemid;
      return {
        id: uid('shopee'),
        produto: (info.name || 'Produto').trim(),
        loja: 'Shopee',
        categoria: 'Eletrônicos',
        precoAntigo,
        precoAtual,
        comissaoPct: 10,
        cupom: null,
        relampago: !!(info.flash_sale),
        link: shopid && itemid ? `https://shopee.com.br/product/${shopid}/${itemid}` : 'https://shopee.com.br',
        imagemUrl: info.image ? `https://cf.shopee.com.br/file/${info.image}` : null,
        encontradoEm: new Date().toISOString(),
      };
    });
  } catch (e) {
    console.error('[Caçador] Shopee API falhou:', e.message);

    // Fallback: API v2
    try {
      console.log('[Caçador] Shopee: tentando API v2 fallback...');
      const url2 = 'https://shopee.com.br/api/v4/recommend/recommend?bundle=top_picks_for_you&limit=10&offset=0';
      const res2 = await httpGet(url2, { 'Referer': 'https://shopee.com.br/' });
      const json2 = JSON.parse(res2.body);
      const sections = json2?.data?.sections || [];
      const items2 = sections.flatMap(s => s.data?.item || []).slice(0, 5);
      console.log(`[Caçador] Shopee fallback: ${items2.length} item(s).`);
      return items2.map(info => ({
        id: uid('shopee'),
        produto: (info.name || 'Produto').trim(),
        loja: 'Shopee',
        categoria: 'Eletrônicos',
        precoAntigo: Math.round((info.price_before_discount || info.price || 0) / 100000 * 100) / 100,
        precoAtual: Math.round((info.price || 0) / 100000 * 100) / 100,
        comissaoPct: 10,
        cupom: null,
        relampago: false,
        link: info.shopid && info.itemid ? `https://shopee.com.br/product/${info.shopid}/${info.itemid}` : 'https://shopee.com.br',
        imagemUrl: info.image ? `https://cf.shopee.com.br/file/${info.image}` : null,
        encontradoEm: new Date().toISOString(),
      }));
    } catch (e2) {
      console.error('[Caçador] Shopee fallback também falhou:', e2.message);
      return [];
    }
  }
}

// ─── Mercado Livre via API oficial gratuita ──────────────────────────────────

async function buscarMercadoLivre() {
  console.log('[Caçador] Mercado Livre: usando API oficial...');
  try {
    // API pública do ML — não precisa de chave para busca básica
    const url = 'https://api.mercadolibre.com/sites/MLB/search?q=eletronicos&limit=10&sort=relevance';
    const res = await httpGet(url, {
      'Accept': 'application/json',
    });

    console.log(`[Caçador] ML API status: ${res.status}`);
    if (res.status !== 200) throw new Error(`Status ${res.status}`);

    const json = JSON.parse(res.body);
    const results = json?.results || [];
    console.log(`[Caçador] ML: ${results.length} item(s) na API.`);

    return results.slice(0, 5).map(item => {
      const precoAtual  = item.price || 0;
      const precoAntigo = item.original_price || 0;
      return {
        id: uid('ml'),
        produto: (item.title || 'Produto').trim(),
        loja: 'Mercado Livre',
        categoria: item.category_id ? 'Eletrônicos' : 'Geral',
        precoAntigo,
        precoAtual,
        comissaoPct: 8,
        cupom: null,
        relampago: false,
        link: item.permalink || 'https://www.mercadolivre.com.br',
        imagemUrl: item.thumbnail ? item.thumbnail.replace('http://', 'https://') : null,
        encontradoEm: new Date().toISOString(),
      };
    });
  } catch (e) {
    console.error('[Caçador] Mercado Livre API falhou:', e.message);
    return [];
  }
}

// ─── Amazon via Puppeteer ────────────────────────────────────────────────────

async function buscarAmazon(browser) {
  console.log('[Caçador] Amazon: iniciando Puppeteer...');
  const page = await browser.newPage();
  try {
    const ua = randomUserAgent.getRandom(u =>
      u.browserName === 'Chrome' && parseFloat(u.browserVersion) >= 110
    ) || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    await page.setUserAgent(ua);
    await page.setViewport({ width: 1366, height: 768 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
      window.chrome = { runtime: {} };
    });

    console.log('[Caçador] Amazon: abrindo página...');
    await page.goto('https://www.amazon.com.br/s?k=eletronicos&rh=n%3A16209062011', {
      waitUntil: 'domcontentloaded',
      timeout: 25000,
    });
    await delay(3000);

    const title = await page.title();
    console.log(`[Caçador] Amazon: título da página = "${title}"`);

    const produtos = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('div[data-component-type="s-search-result"]'));
      console.log('Cards encontrados:', cards.length);
      return cards.slice(0, 5).map(item => {
        const nomeEl  = item.querySelector('h2 a span, h2 span.a-text-normal, h2 .a-size-medium');
        const precoEl = item.querySelector('.a-price .a-offscreen, .a-price-whole');
        const imgEl   = item.querySelector('img.s-image');
        const linkEl  = item.querySelector('h2 a[href]');
        return {
          nome:   nomeEl?.innerText?.trim()  || '',
          preco:  precoEl?.innerText?.trim() || '0',
          imagem: imgEl?.src || imgEl?.getAttribute('data-src') || '',
          link:   linkEl ? 'https://www.amazon.com.br' + linkEl.getAttribute('href') : '',
        };
      });
    });

    console.log(`[Caçador] Amazon: ${produtos.length} produto(s) extraídos.`);
    produtos.forEach((p, i) => console.log(`  [${i}] nome="${p.nome}" preço="${p.preco}"`));

    return produtos
      .filter(p => p.nome && p.link)
      .map(p => ({
        id: uid('amz'),
        produto: p.nome,
        loja: 'Amazon',
        categoria: 'Eletrônicos',
        precoAntigo: 0,
        precoAtual: limparPreco(p.preco),
        comissaoPct: 12,
        cupom: null,
        relampago: false,
        link: p.link,
        imagemUrl: p.imagem || null,
        encontradoEm: new Date().toISOString(),
      }));
  } catch (e) {
    console.error('[Caçador] Amazon falhou:', e.message);
    return [];
  } finally {
    await page.close();
  }
}

// ─── Varredura principal ─────────────────────────────────────────────────────

async function buscarOfertas() {
  let browser;
  try {
    // Shopee e ML via HTTP direto (sem Puppeteer)
    const [shopeeResult, mlResult] = await Promise.allSettled([
      buscarShopee(),
      buscarMercadoLivre(),
    ]);

    const shopee = shopeeResult.status === 'fulfilled' ? shopeeResult.value : [];
    const ml     = mlResult.status     === 'fulfilled' ? mlResult.value     : [];

    console.log(`[Caçador] Shopee: ${shopee.length} | ML: ${ml.length}`);

    // Amazon via Puppeteer
    browser = await puppeteer.launch(launchOptions);
    const amazon = await buscarAmazon(browser);
    console.log(`[Caçador] Amazon: ${amazon.length}`);

    const todas = [...shopee, ...ml, ...amazon];
    console.log(`[Caçador] Total brutas: ${todas.length}`);
    return todas;
  } finally {
    if (browser) await browser.close();
  }
}

async function executarVarredura() {
  try {
    const ofertas = await buscarOfertas();
    ultimasOfertas = ofertas;
    ultimaExecucao = new Date().toISOString();
    console.log(`[Bot Caçador] Concluído — ${ofertas.length} oferta(s) em ${ultimaExecucao}`);
  } catch (e) {
    console.error('[Bot Caçador] Erro na varredura:', e.message);
  }
}

function iniciarCacador({ intervaloCron = '*/15 * * * *' } = {}) {
  executarVarredura();
  cron.schedule(intervaloCron, executarVarredura);
  console.log(`[Bot Caçador] Agendado com cron "${intervaloCron}"`);
}

function getUltimasOfertas() {
  return { ofertas: ultimasOfertas, ultimaExecucao };
}

module.exports = { iniciarCacador, getUltimasOfertas, buscarOfertas };
