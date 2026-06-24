// cacador.js
// Estratégia:
//   Shopee       → API de afiliados pública (sem autenticação)
//   Mercado Livre → API oficial v2 com endpoint diferente
//   Amazon       → Puppeteer com seletores corrigidos

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const randomUserAgent = require('random-useragent');
const cron = require('node-cron');
const https = require('https');

puppeteer.use(StealthPlugin());

const launchOptions = {
  headless: 'new',
  args: [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote',
    '--disable-gpu', '--disable-web-security',
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
    .replace(/R\$\s*/gi, '').replace(/\s/g, '')
    .replace(/\.(?=\d{3})/g, '').replace(',', '.');
  return parseFloat(limpo) || 0;
}

function uid(p) { return `${p}-${Date.now()}-${Math.random().toString(36).substr(2,9)}`; }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, path: u.pathname + u.search,
      method: 'GET', timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        ...headers,
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ─── Shopee via Puppeteer (API interna com cookies reais) ───────────────────

async function buscarShopee(browser) {
  console.log('[Caçador] Shopee: abrindo navegador...');
  const page = await browser.newPage();
  try {
    const ua = randomUserAgent.getRandom(u => u.browserName === 'Chrome' && parseFloat(u.browserVersion) >= 110)
      || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36';
    await page.setUserAgent(ua);
    await page.setViewport({ width: 1366, height: 768 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
    });

    // Primeiro visita a página principal para pegar cookies
    await page.goto('https://shopee.com.br/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await delay(2000);

    // Agora chama a API interna com os cookies da sessão
    const apiUrl = 'https://shopee.com.br/api/v4/search/search_items?by=relevancy&keyword=eletronicos&limit=10&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2';
    const response = await page.evaluate(async (url) => {
      const res = await fetch(url, {
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' },
        credentials: 'include',
      });
      return { status: res.status, body: await res.text() };
    }, apiUrl);

    console.log(`[Caçador] Shopee API via browser: status ${response.status}`);

    if (response.status !== 200) throw new Error(`Status ${response.status}`);

    const json = JSON.parse(response.body);
    const items = json?.items || [];
    console.log(`[Caçador] Shopee: ${items.length} item(s).`);

    return items.slice(0, 5).map(item => {
      const info = item.item_basic || item;
      return {
        id: uid('shopee'),
        produto: (info.name || '').trim(),
        loja: 'Shopee', categoria: 'Eletrônicos',
        precoAntigo: Math.round((info.price_before_discount || info.price || 0) / 100000 * 100) / 100,
        precoAtual:  Math.round((info.price || 0) / 100000 * 100) / 100,
        comissaoPct: 10, cupom: null, relampago: !!(info.flash_sale),
        link: info.shopid && info.itemid ? `https://shopee.com.br/product/${info.shopid}/${info.itemid}` : 'https://shopee.com.br',
        imagemUrl: info.image ? `https://cf.shopee.com.br/file/${info.image}` : null,
        encontradoEm: new Date().toISOString(),
      };
    }).filter(o => o.produto && o.precoAtual > 0);
  } catch (e) {
    console.error('[Caçador] Shopee falhou:', e.message);
    return [];
  } finally {
    await page.close();
  }
}

// ─── Mercado Livre via Puppeteer ─────────────────────────────────────────────

async function buscarMercadoLivre(browser) {
  console.log('[Caçador] Mercado Livre: abrindo navegador...');
  const page = await browser.newPage();
  try {
    const ua = randomUserAgent.getRandom(u => u.browserName === 'Chrome' && parseFloat(u.browserVersion) >= 110)
      || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36';
    await page.setUserAgent(ua);
    await page.setViewport({ width: 1366, height: 768 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
    });

    await page.goto('https://lista.mercadolivre.com.br/eletronicos', {
      waitUntil: 'domcontentloaded', timeout: 25000,
    });
    await delay(3000);

    const title = await page.title();
    console.log(`[Caçador] ML título: "${title}"`);

    const produtos = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('li.ui-search-layout__item'));
      console.log('ML cards:', cards.length);
      return cards.slice(0, 5).map(card => {
        const nome = card.querySelector('h2.ui-search-item__title, .ui-search-item__title')?.innerText?.trim() || '';
        const fracEl = card.querySelector('.andes-money-amount__fraction');
        const centsEl = card.querySelector('.andes-money-amount__cents');
        const preco = fracEl ? `${fracEl.innerText}${centsEl ? ',' + centsEl.innerText : ''}` : '0';
        const precoOrigEl = card.querySelector('.ui-search-price__original-value .andes-money-amount__fraction');
        const precoOrig = precoOrigEl ? precoOrigEl.innerText : '0';
        const img = card.querySelector('img.ui-search-result-image__element, img[data-src], img')?.src || '';
        const link = card.querySelector('a.ui-search-item__link, a.ui-search-link, a[href*="mercadolivre"]')?.href || '';
        return { nome, preco, precoOrig, img, link };
      });
    });

    console.log(`[Caçador] ML: ${produtos.length} produto(s).`);
    produtos.forEach((p, i) => console.log(`  [${i}] nome="${p.nome}" preço="${p.preco}"`));

    return produtos.filter(p => p.nome && p.link).map(p => ({
      id: uid('ml'),
      produto: p.nome, loja: 'Mercado Livre', categoria: 'Eletrônicos',
      precoAntigo: limparPreco(p.precoOrig),
      precoAtual:  limparPreco(p.preco),
      comissaoPct: 8, cupom: null, relampago: false,
      link: p.link.split('?')[0],
      imagemUrl: p.img || null,
      encontradoEm: new Date().toISOString(),
    })).filter(o => o.precoAtual > 0);
  } catch (e) {
    console.error('[Caçador] ML falhou:', e.message);
    return [];
  } finally {
    await page.close();
  }
}

// ─── Amazon via Puppeteer ────────────────────────────────────────────────────

async function buscarAmazon(browser) {
  console.log('[Caçador] Amazon: abrindo navegador...');
  const page = await browser.newPage();
  try {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    await page.setUserAgent(ua);
    await page.setViewport({ width: 1366, height: 768 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'pt-BR,pt;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
    });

    await page.goto('https://www.amazon.com.br/s?k=eletronicos', {
      waitUntil: 'domcontentloaded', timeout: 25000,
    });
    await delay(3000);

    const title = await page.title();
    console.log(`[Caçador] Amazon título: "${title}"`);

    const produtos = await page.evaluate(() => {
      // Tenta múltiplos seletores para nome e preço
      const cards = Array.from(document.querySelectorAll('[data-component-type="s-search-result"]'));
      return cards.slice(0, 8).map(card => {
        // Nome — tenta vários seletores
        const nomeSelectors = [
          'h2 a span',
          'h2 span.a-text-normal',
          'h2 .a-size-medium.a-color-base',
          'h2 .a-size-base-plus',
          '.a-size-mini .a-link-normal span',
          'span[data-action] span',
        ];
        let nome = '';
        for (const sel of nomeSelectors) {
          const el = card.querySelector(sel);
          if (el?.innerText?.trim()) { nome = el.innerText.trim(); break; }
        }

        // Preço — tenta vários seletores
        const precoSelectors = [
          '.a-price .a-offscreen',
          '.a-price-whole',
          '.a-color-price',
          'span[data-a-color="price"] .a-offscreen',
        ];
        let preco = '';
        for (const sel of precoSelectors) {
          const el = card.querySelector(sel);
          if (el?.innerText?.trim()) { preco = el.innerText.trim(); break; }
        }

        const img = card.querySelector('img.s-image')?.src || '';
        const linkEl = card.querySelector('h2 a[href], a.a-link-normal[href*="/dp/"]');
        const link = linkEl ? 'https://www.amazon.com.br' + linkEl.getAttribute('href') : '';

        return { nome, preco, img, link };
      });
    });

    console.log(`[Caçador] Amazon: ${produtos.length} produto(s).`);
    produtos.forEach((p, i) => console.log(`  [${i}] nome="${p.nome}" preço="${p.preco}"`));

    return produtos.filter(p => p.nome && p.link).map(p => ({
      id: uid('amz'),
      produto: p.nome, loja: 'Amazon', categoria: 'Eletrônicos',
      precoAntigo: 0,
      precoAtual: limparPreco(p.preco),
      comissaoPct: 12, cupom: null, relampago: false,
      link: p.link,
      imagemUrl: p.img || null,
      encontradoEm: new Date().toISOString(),
    })).filter(o => o.precoAtual > 0);
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
    browser = await puppeteer.launch(launchOptions);
    console.log('[Caçador] Navegador iniciado.');

    // Roda os 3 em sequência para não sobrecarregar memória do Actions
    const shopee = await buscarShopee(browser);
    const ml     = await buscarMercadoLivre(browser);
    const amazon = await buscarAmazon(browser);

    console.log(`[Caçador] Shopee: ${shopee.length} | ML: ${ml.length} | Amazon: ${amazon.length}`);
    return [...shopee, ...ml, ...amazon];
  } finally {
    if (browser) await browser.close();
  }
}

async function executarVarredura() {
  try {
    const ofertas = await buscarOfertas();
    ultimasOfertas = ofertas;
    ultimaExecucao = new Date().toISOString();
    console.log(`[Bot Caçador] Concluído — ${ofertas.length} oferta(s).`);
  } catch (e) {
    console.error('[Bot Caçador] Erro:', e.message);
  }
}

function iniciarCacador({ intervaloCron = '*/15 * * * *' } = {}) {
  executarVarredura();
  cron.schedule(intervaloCron, executarVarredura);
}

function getUltimasOfertas() { return { ofertas: ultimasOfertas, ultimaExecucao }; }

module.exports = { iniciarCacador, getUltimasOfertas, buscarOfertas };
