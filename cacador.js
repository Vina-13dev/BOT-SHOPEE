// lib/cacador.js
// Bot Caçador de Ofertas — Shopee, Mercado Livre e Amazon.
//
// Usa puppeteer-extra + puppeteer-extra-plugin-stealth para imitar um
// navegador real e driblar as proteções anti-bot de cada site.
//
// Chamado pelo GitHub Actions (scripts/buscarOfertas.js) a cada 15 min.
// Para testar localmente:
//   node -e "require('./lib/cacador').buscarOfertas().then(console.log)"

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const randomUserAgent = require('random-useragent');
const cron = require('node-cron');

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
  // Remove "R$", espaços e pontos de milhar; troca vírgula por ponto decimal
  const limpo = texto
    .replace(/R\$\s*/gi, '')
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3})/g, '')   // remove ponto de milhar (ex: 1.299)
    .replace(',', '.');             // vírgula decimal → ponto
  return parseFloat(limpo) || 0;
}

function uid(prefixo) {
  return `${prefixo}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

async function criarPagina(browser) {
  const page = await browser.newPage();
  const ua = randomUserAgent.getRandom(ua =>
    ua.browserName === 'Chrome' && parseFloat(ua.browserVersion) >= 110
  ) || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  await page.setUserAgent(ua);
  await page.setViewport({ width: 1366, height: 768 });

  // Remove sinais de WebDriver expostos pelo Chromium headless
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en'] });
    window.chrome = { runtime: {} };
  });

  return page;
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Shopee ─────────────────────────────────────────────────────────────────

async function buscarShopee(browser) {
  const page = await criarPagina(browser);
  try {
    // A Shopee carrega via API interna — usamos a busca pública de produtos
    await page.goto(
      'https://shopee.com.br/api/v4/search/search_items?by=relevancy&keyword=eletronicos&limit=5&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2',
      { waitUntil: 'domcontentloaded', timeout: 30000 }
    );

    const json = await page.evaluate(() => {
      try { return JSON.parse(document.body.innerText); } catch { return null; }
    });

    const items = json?.items || [];
    return items.slice(0, 5).map(item => {
      const info = item.item_basic || item;
      const precoAtual   = (info.price || 0) / 100000;
      const precoAntigo  = (info.price_before_discount || info.price || 0) / 100000;
      const shopid       = info.shopid;
      const itemid       = info.itemid;

      return {
        id: uid('shopee'),
        produto: info.name || 'Produto Sem Nome',
        loja: 'Shopee',
        categoria: 'Eletrônicos',
        precoAntigo: Math.round(precoAntigo * 100) / 100,
        precoAtual: Math.round(precoAtual * 100) / 100,
        comissaoPct: 10,
        cupom: null,
        relampago: !!(info.flash_sale),
        link: shopid && itemid
          ? `https://shopee.com.br/product/${shopid}/${itemid}`
          : 'https://shopee.com.br',
        imagemUrl: info.image
          ? `https://cf.shopee.com.br/file/${info.image}`
          : null,
        encontradoEm: new Date().toISOString(),
      };
    });
  } catch (e) {
    console.error('[Caçador] Shopee (API) falhou, tentando via HTML:', e.message);

    // Fallback: página de busca HTML
    try {
      await page.goto('https://shopee.com.br/busca?keyword=eletronicos', {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });
      await delay(4000);
      await page.evaluate(() => window.scrollBy(0, 600));
      await delay(2000);

      const produtos = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-sqe="item"]'))
          .slice(0, 5)
          .map(el => ({
            nome: el.querySelector('[data-sqe="name"]')?.innerText
                  || el.querySelector('div[class*="name"]')?.innerText
                  || 'Produto Sem Nome',
            preco: el.querySelector('span[class*="price"]')?.innerText || '0',
            imagem: el.querySelector('img')?.src || '',
            link: el.querySelector('a')?.href || '',
          }))
      );

      return produtos.map(p => ({
        id: uid('shopee'),
        produto: p.nome,
        loja: 'Shopee',
        categoria: 'Eletrônicos',
        precoAntigo: 0,
        precoAtual: limparPreco(p.preco),
        comissaoPct: 10,
        cupom: null,
        relampago: false,
        link: p.link,
        imagemUrl: p.imagem,
        encontradoEm: new Date().toISOString(),
      }));
    } catch (e2) {
      console.error('[Caçador] Shopee fallback HTML também falhou:', e2.message);
      return [];
    }
  } finally {
    await page.close();
  }
}

// ─── Mercado Livre ───────────────────────────────────────────────────────────

async function buscarMercadoLivre(browser) {
  const page = await criarPagina(browser);
  try {
    await page.goto('https://lista.mercadolivre.com.br/eletronicos', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    await delay(2000);

    const produtos = await page.evaluate(() =>
      Array.from(document.querySelectorAll('li.ui-search-layout__item'))
        .slice(0, 5)
        .map(item => {
          const nomeEl  = item.querySelector('h2.ui-search-item__title, h3.ui-search-item__title');
          const inteiro = item.querySelector('.andes-money-amount__fraction');
          const cents   = item.querySelector('.andes-money-amount__cents');
          const imgEl   = item.querySelector('img.ui-search-result-image__element, img[data-src]');
          const linkEl  = item.querySelector('a.ui-search-item__link, a.ui-search-link');

          const precoTexto = inteiro
            ? `${inteiro.innerText}${cents ? ',' + cents.innerText : ''}`
            : '0';

          return {
            nome:   nomeEl?.innerText || 'Produto Sem Nome',
            preco:  precoTexto,
            imagem: imgEl?.src || imgEl?.dataset?.src || '',
            link:   linkEl?.href || '',
          };
        })
    );

    return produtos.map(p => ({
      id: uid('ml'),
      produto: p.nome,
      loja: 'Mercado Livre',
      categoria: 'Eletrônicos',
      precoAntigo: 0,
      precoAtual: limparPreco(p.preco),
      comissaoPct: 8,
      cupom: null,
      relampago: false,
      link: p.link,
      imagemUrl: p.imagem,
      encontradoEm: new Date().toISOString(),
    }));
  } catch (e) {
    console.error('[Caçador] Mercado Livre falhou:', e.message);
    return [];
  } finally {
    await page.close();
  }
}

// ─── Amazon ─────────────────────────────────────────────────────────────────

async function buscarAmazon(browser) {
  const page = await criarPagina(browser);
  try {
    // Cabeçalhos extras que a Amazon verifica
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Upgrade-Insecure-Requests': '1',
    });

    await page.goto('https://www.amazon.com.br/s?k=eletronicos&rh=n%3A16209062011', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    await delay(3000);

    const produtos = await page.evaluate(() =>
      Array.from(document.querySelectorAll('div[data-component-type="s-search-result"]'))
        .slice(0, 5)
        .map(item => {
          const nomeEl  = item.querySelector('h2 a span, h2 span.a-text-normal');
          const precoEl = item.querySelector('.a-price .a-offscreen, .a-price-whole');
          const imgEl   = item.querySelector('img.s-image');
          const linkEl  = item.querySelector('h2 a[href]');

          return {
            nome:   nomeEl?.innerText  || 'Produto Sem Nome',
            preco:  precoEl?.innerText || '0',
            imagem: imgEl?.src         || '',
            link:   linkEl
              ? 'https://www.amazon.com.br' + linkEl.getAttribute('href')
              : '',
          };
        })
    );

    return produtos.map(p => ({
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
      imagemUrl: p.imagem,
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
    browser = await puppeteer.launch(launchOptions);
    console.log('[Caçador] Navegador iniciado.');

    const [shopee, ml, amazon] = await Promise.allSettled([
      buscarShopee(browser),
      buscarMercadoLivre(browser),
      buscarAmazon(browser),
    ]);

    const todas = [
      ...(shopee.status  === 'fulfilled' ? shopee.value  : []),
      ...(ml.status      === 'fulfilled' ? ml.value      : []),
      ...(amazon.status  === 'fulfilled' ? amazon.value  : []),
    ];

    console.log(`[Caçador] Coleta finalizada — ${todas.length} oferta(s) brutas.`);
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
    console.log(`[Bot Caçador] Varredura concluída — ${ofertas.length} oferta(s) em ${ultimaExecucao}`);
  } catch (e) {
    console.error('[Bot Caçador] Erro na varredura:', e.message);
  }
}

function iniciarCacador({ intervaloCron = '*/15 * * * *' } = {}) {
  executarVarredura();
  cron.schedule(intervaloCron, executarVarredura);
  console.log(`[Bot Caçador] Agendado com expressão cron "${intervaloCron}"`);
}

function getUltimasOfertas() {
  return { ofertas: ultimasOfertas, ultimaExecucao };
}

module.exports = { iniciarCacador, getUltimasOfertas, buscarOfertas };
