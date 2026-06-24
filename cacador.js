// cacador.js
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const randomUserAgent = require('random-useragent');
const cron = require('node-cron');

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

function limparPreco(texto) {
  if (!texto) return 0;
  return parseFloat(texto.replace(/R\$\s*/gi,'').replace(/\s/g,'').replace(/\.(?=\d{3})/g,'').replace(',','.')) || 0;
}
function uid(p) { return `${p}-${Date.now()}-${Math.random().toString(36).substr(2,9)}`; }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function novaPagina(browser) {
  const page = await browser.newPage();
  const ua = randomUserAgent.getRandom(u => u.browserName === 'Chrome' && parseFloat(u.browserVersion) >= 110)
    || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36';
  await page.setUserAgent(ua);
  await page.setViewport({ width: 1366, height: 768 });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3] });
    window.chrome = { runtime: {} };
  });
  return page;
}

// ─── Shopee ──────────────────────────────────────────────────────────────────
async function buscarShopee(browser) {
  console.log('[Caçador] Shopee: iniciando...');
  const page = await novaPagina(browser);
  try {
    // Visita página principal para estabelecer sessão/cookies
    await page.goto('https://shopee.com.br/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await delay(2500);

    // Chama API com sessão ativa
    const apiUrl = 'https://shopee.com.br/api/v4/search/search_items?by=relevancy&keyword=eletronicos&limit=10&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2';
    const resp = await page.evaluate(async (url) => {
      try {
        const r = await fetch(url, {
          credentials: 'include',
          headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }
        });
        return { status: r.status, body: await r.text() };
      } catch(e) { return { status: 0, body: '', err: e.message }; }
    }, apiUrl);

    console.log(`[Caçador] Shopee API status: ${resp.status}`);
    if (resp.status !== 200) throw new Error(`Status ${resp.status}`);

    const json = JSON.parse(resp.body);
    const items = json?.items || [];
    console.log(`[Caçador] Shopee: ${items.length} item(s) na API`);
    if (items.length === 0 && json) console.log('[Caçador] Shopee JSON keys:', Object.keys(json).join(', '));

    return items.slice(0,6).map(item => {
      const info = item.item_basic || item;
      const precoAtual  = Math.round((info.price || 0) / 100000 * 100) / 100;
      const precoAntigo = Math.round((info.price_before_discount || 0) / 100000 * 100) / 100;
      return {
        id: uid('shopee'),
        produto: (info.name || '').trim(),
        loja: 'Shopee', categoria: 'Eletrônicos',
        precoAntigo, precoAtual, comissaoPct: 10, cupom: null,
        relampago: !!(info.flash_sale),
        link: info.shopid && info.itemid ? `https://shopee.com.br/product/${info.shopid}/${info.itemid}` : '',
        imagemUrl: info.image ? `https://cf.shopee.com.br/file/${info.image}` : null,
        encontradoEm: new Date().toISOString(),
      };
    }).filter(o => o.produto && o.precoAtual > 0);
  } catch(e) {
    console.error('[Caçador] Shopee falhou:', e.message);
    return [];
  } finally { await page.close(); }
}

// ─── Mercado Livre ───────────────────────────────────────────────────────────
async function buscarMercadoLivre(browser) {
  console.log('[Caçador] ML: iniciando...');
  const page = await novaPagina(browser);
  try {
    await page.goto('https://www.mercadolivre.com.br/ofertas', {
      waitUntil: 'domcontentloaded', timeout: 25000
    });
    await delay(3000);
    await page.evaluate(() => window.scrollBy(0, 400));
    await delay(1500);

    const title = await page.title();
    console.log(`[Caçador] ML título: "${title}"`);

    const produtos = await page.evaluate(() => {
      // Página de ofertas do ML tem seletores diferentes
      const selectors = [
        'li.promotion-item',
        '.andes-card.poly-card',
        'div.poly-component__title',
        'li[class*="item"]',
      ];
      
      let cards = [];
      for (const sel of selectors) {
        cards = Array.from(document.querySelectorAll(sel));
        if (cards.length > 0) { console.log('ML usando seletor:', sel, 'cards:', cards.length); break; }
      }

      // Se não achou cards específicos, tenta extração genérica
      if (cards.length === 0) {
        // Tenta pegar qualquer elemento com preço visível
        const precoEls = Array.from(document.querySelectorAll('.andes-money-amount__fraction'));
        console.log('ML preços encontrados:', precoEls.length);
        return precoEls.slice(0, 6).map(el => {
          const container = el.closest('article, li, div[class*="item"], div[class*="card"]');
          if (!container) return null;
          const nomeEl = container.querySelector('h2, h3, [class*="title"], [class*="name"]');
          const linkEl = container.querySelector('a[href*="mercadolivre"]');
          const imgEl  = container.querySelector('img');
          return {
            nome: nomeEl?.innerText?.trim() || '',
            preco: el.innerText?.trim() || '0',
            img: imgEl?.src || imgEl?.dataset?.src || '',
            link: linkEl?.href || '',
          };
        }).filter(Boolean);
      }

      return cards.slice(0, 6).map(card => {
        const nomeEl = card.querySelector('h2, h3, [class*="title"], [class*="name"], .poly-component__title');
        const precoEl = card.querySelector('.andes-money-amount__fraction, [class*="price"]');
        const centsEl = card.querySelector('.andes-money-amount__cents');
        const imgEl   = card.querySelector('img');
        const linkEl  = card.querySelector('a[href*="mercadolivre"], a[href*="mercadolibre"]');
        return {
          nome:  nomeEl?.innerText?.trim() || '',
          preco: precoEl ? `${precoEl.innerText}${centsEl ? ','+centsEl.innerText : ''}` : '0',
          img:   imgEl?.src || imgEl?.dataset?.src || '',
          link:  linkEl?.href || '',
        };
      });
    });

    console.log(`[Caçador] ML: ${produtos.length} produto(s).`);
    produtos.forEach((p,i) => console.log(`  [${i}] nome="${p.nome}" preço="${p.preco}"`));

    return produtos.filter(p => p.nome && p.link && p.preco !== '0').map(p => ({
      id: uid('ml'),
      produto: p.nome, loja: 'Mercado Livre', categoria: 'Eletrônicos',
      precoAntigo: 0, precoAtual: limparPreco(p.preco),
      comissaoPct: 8, cupom: null, relampago: false,
      link: p.link.split('?')[0],
      imagemUrl: p.img || null,
      encontradoEm: new Date().toISOString(),
    })).filter(o => o.precoAtual > 0);
  } catch(e) {
    console.error('[Caçador] ML falhou:', e.message);
    return [];
  } finally { await page.close(); }
}

// ─── Amazon ──────────────────────────────────────────────────────────────────
async function buscarAmazon(browser) {
  console.log('[Caçador] Amazon: iniciando...');
  const page = await novaPagina(browser);
  try {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
    await page.goto('https://www.amazon.com.br/s?k=eletronicos', {
      waitUntil: 'domcontentloaded', timeout: 25000
    });
    await delay(3000);

    const produtos = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-component-type="s-search-result"]'));
      return cards.slice(0, 10).map(card => {
        // Nome: pega o elemento <a> dentro do h2, ignora badges como "Escolha da Amazon"
        const h2 = card.querySelector('h2');
        // O span com o nome real geralmente é o mais longo dentro do h2
        const spans = h2 ? Array.from(h2.querySelectorAll('span')) : [];
        const nomeSpan = spans
          .filter(s => s.innerText && s.innerText.trim().length > 10)
          .sort((a, b) => b.innerText.length - a.innerText.length)[0];
        const nome = nomeSpan?.innerText?.trim() || '';

        // Preço
        const precoOff = card.querySelector('.a-price .a-offscreen');
        const precoWhole = card.querySelector('.a-price-whole');
        const preco = precoOff?.innerText?.trim() || precoWhole?.innerText?.trim() || '';

        const img  = card.querySelector('img.s-image')?.src || '';
        const link = card.querySelector('h2 a[href]')?.getAttribute('href') || '';

        return { nome, preco, img, link: link ? 'https://www.amazon.com.br' + link : '' };
      });
    });

    console.log(`[Caçador] Amazon: ${produtos.length} produto(s) extraídos.`);
    produtos.forEach((p,i) => console.log(`  [${i}] nome="${p.nome.slice(0,60)}" preço="${p.preco}"`));

    return produtos
      .filter(p => p.nome && p.nome.length > 10 && p.link && limparPreco(p.preco) > 0)
      .map(p => ({
        id: uid('amz'),
        produto: p.nome, loja: 'Amazon', categoria: 'Eletrônicos',
        precoAntigo: 0, precoAtual: limparPreco(p.preco),
        comissaoPct: 12, cupom: null, relampago: false,
        link: p.link, imagemUrl: p.img || null,
        encontradoEm: new Date().toISOString(),
      }));
  } catch(e) {
    console.error('[Caçador] Amazon falhou:', e.message);
    return [];
  } finally { await page.close(); }
}

// ─── Principal ───────────────────────────────────────────────────────────────
async function buscarOfertas() {
  let browser;
  try {
    browser = await puppeteer.launch(launchOptions);
    console.log('[Caçador] Navegador iniciado.');
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
  } catch(e) { console.error('[Bot Caçador] Erro:', e.message); }
}

function iniciarCacador({ intervaloCron = '*/15 * * * *' } = {}) {
  executarVarredura();
  cron.schedule(intervaloCron, executarVarredura);
}
function getUltimasOfertas() { return { ofertas: ultimasOfertas, ultimaExecucao }; }
module.exports = { iniciarCacador, getUltimasOfertas, buscarOfertas };
