// cacador.js
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const randomUserAgent = require('random-useragent');
const cron = require('node-cron');

puppeteer.use(StealthPlugin());

const launchOptions = {
  headless: 'new',
  args: [
    '--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas','--no-first-run','--no-zygote',
    '--disable-gpu','--disable-web-security',
    '--disable-blink-features=AutomationControlled','--window-size=1366,768',
  ],
  ignoreHTTPSErrors: true,
};

let ultimasOfertas = [];
let ultimaExecucao = null;

// Extrai APENAS o primeiro valor monetário de um texto — ignora parcelas, badges, etc.
function limparPreco(texto) {
  if (!texto) return 0;
  // Remove tudo que não é dígito, vírgula ou ponto
  // Pega o primeiro bloco numérico válido (ex: "1.499" ou "1499" ou "26,29")
  const matches = texto.match(/\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?/);
  if (!matches) return 0;
  const num = matches[0].replace(/\.(?=\d{3})/g, '').replace(',', '.');
  return parseFloat(num) || 0;
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
    await page.goto('https://shopee.com.br/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await delay(2500);

    const apiUrl = 'https://shopee.com.br/api/v4/search/search_items?by=relevancy&keyword=eletronicos&limit=10&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2';
    const resp = await page.evaluate(async (url) => {
      try {
        const r = await fetch(url, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        return { status: r.status, body: await r.text() };
      } catch(e) { return { status: 0, body: '' }; }
    }, apiUrl);

    console.log(`[Caçador] Shopee API status: ${resp.status}`);
    
    let items = [];
    if (resp.status === 200) {
      const json = JSON.parse(resp.body);
      items = json?.items || [];
    }

    if (items.length > 0) {
      console.log(`[Caçador] Shopee API: ${items.length} itens`);
      return items.slice(0,6).map(item => {
        const info = item.item_basic || item;
        return {
          id: uid('shopee'), produto: (info.name || '').trim(), loja: 'Shopee', categoria: 'Eletrônicos',
          precoAntigo: Math.round((info.price_before_discount || 0) / 100000 * 100) / 100,
          precoAtual:  Math.round((info.price || 0) / 100000 * 100) / 100,
          comissaoPct: 10, cupom: null, relampago: !!(info.flash_sale),
          link: info.shopid && info.itemid ? `https://shopee.com.br/product/${info.shopid}/${info.itemid}` : '',
          imagemUrl: info.image ? `https://cf.shopee.com.br/file/${info.image}` : null,
          encontradoEm: new Date().toISOString(),
        };
      }).filter(o => o.produto && o.precoAtual > 0);
    }

    // Fallback: scraping HTML
    console.log('[Caçador] Shopee: fallback HTML...');
    await page.goto('https://shopee.com.br/busca?keyword=eletronicos', { waitUntil: 'networkidle2', timeout: 25000 });
    await delay(3000);
    await page.evaluate(() => window.scrollBy(0, 500));
    await delay(1500);

    const prods = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('[data-sqe="item"]'));
      console.log('Shopee els:', els.length);
      return els.slice(0,6).map(el => ({
        nome:  el.querySelector('[data-sqe="name"]')?.innerText?.trim() || '',
        preco: el.querySelector('[class*="price"]')?.innerText?.split('\n')[0]?.trim() || '',
        img:   el.querySelector('img')?.src || '',
        link:  el.querySelector('a')?.href || '',
      }));
    });

    console.log(`[Caçador] Shopee HTML: ${prods.length}`);
    prods.forEach((p,i) => console.log(`  [${i}] nome="${p.nome}" preço="${p.preco}"`));

    return prods.filter(p => p.nome && p.link).map(p => ({
      id: uid('shopee'), produto: p.nome, loja: 'Shopee', categoria: 'Eletrônicos',
      precoAntigo: 0, precoAtual: limparPreco(p.preco),
      comissaoPct: 10, cupom: null, relampago: false,
      link: p.link, imagemUrl: p.img || null,
      encontradoEm: new Date().toISOString(),
    })).filter(o => o.precoAtual > 0);
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
    // Tenta página de ofertas primeiro, depois busca geral
    const mlUrls = [
      'https://www.mercadolivre.com.br/ofertas',
      'https://lista.mercadolivre.com.br/eletronicos',
    ];

    let produtos = [];
    for (const url of mlUrls) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await delay(3000);
      await page.evaluate(() => window.scrollBy(0, 400));
      await delay(1000);

      const title = await page.title();
      console.log(`[Caçador] ML título: "${title}" url: ${url}`);

      produtos = await page.evaluate(() => {
        // Seletores para múltiplos layouts do ML
        const seletores = [
          'li.promotion-item',
          'li.ui-search-layout__item',
          '.andes-card.poly-card',
        ];

        let cards = [];
        let tipoCard = '';
        for (const sel of seletores) {
          cards = Array.from(document.querySelectorAll(sel));
          if (cards.length > 0) { tipoCard = sel; break; }
        }
        console.log('ML seletor:', tipoCard, 'cards:', cards.length);

        return cards.slice(0,8).map(card => {
          // Nome — tenta vários seletores
          const nome = (
            card.querySelector('p.promotion-item__title')?.innerText ||
            card.querySelector('h2.ui-search-item__title')?.innerText ||
            card.querySelector('.poly-component__title')?.innerText ||
            card.querySelector('h2, h3, [class*="title"]')?.innerText ||
            ''
          ).trim();

          // Preço atual — pega só a fração principal e os centavos
          const fracEl = card.querySelector(
            '.andes-money-amount__fraction'
          );
          const centsEl = card.querySelector(
            '.andes-money-amount__cents'
          );
          // Pega texto direto do nó, não innerText que inclui subelementos
          const frac  = fracEl  ? (fracEl.firstChild?.textContent  || fracEl.innerText  || '').trim().replace(/\D/g,'') : '0';
          const cents = centsEl ? (centsEl.firstChild?.textContent || centsEl.innerText || '').trim().replace(/\D/g,'') : '00';
          const precoAtual = cents !== '00' ? `${frac},${cents}` : frac;

          const img  = card.querySelector('img')?.src || card.querySelector('img')?.dataset?.src || '';
          const link = card.querySelector('a[href*="mercadolivre"], a[href*="mercadolibre"]')?.href || '';

          return { nome, precoAtual, img, link };
        });
      });

      console.log(`[Caçador] ML: ${produtos.length} produto(s).`);
      produtos.forEach((p,i) => console.log(`  [${i}] nome="${p.nome.slice(0,40)}" preço="${p.precoAtual}"`));

      if (produtos.filter(p => p.nome && p.link).length > 0) break;
      console.log('[Caçador] ML: nenhum produto válido, tentando próxima URL...');
    }

    return produtos.filter(p => p.nome && p.link).map(p => ({
      id: uid('ml'), produto: p.nome, loja: 'Mercado Livre', categoria: 'Eletrônicos',
      precoAntigo: 0,
      precoAtual: limparPreco(p.precoAtual),
      comissaoPct: 8, cupom: null, relampago: false,
      link: p.link.split('?')[0], imagemUrl: p.img || null,
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
      return cards.slice(0,10).map(card => {
        // Nome: pega o span mais longo dentro do h2 (ignora badges curtos)
        const h2 = card.querySelector('h2');
        const spans = h2 ? Array.from(h2.querySelectorAll('span')) : [];
        const nome = spans
          .map(s => s.textContent?.trim() || '')
          .filter(t => t.length > 5 && !t.match(/^(Escolha|Mais vendido|Patrocinado|Resultados|Garantia)/i))
          .sort((a,b) => b.length - a.length)[0] || '';

        // Preço: .a-offscreen tem "R$ 26,29" — pega só o primeiro
        const precoEl = card.querySelector('.a-price .a-offscreen');
        const preco = precoEl?.innerText?.trim() || '';

        const img  = card.querySelector('img.s-image')?.src || '';
        const link = card.querySelector('h2 a[href]')?.getAttribute('href') || '';

        return { nome, preco, img, link: link ? 'https://www.amazon.com.br' + link : '' };
      });
    });

    console.log(`[Caçador] Amazon: ${produtos.length} extraídos.`);
    produtos.forEach((p,i) => console.log(`  [${i}] nome="${p.nome.slice(0,50)}" preço="${p.preco}"`));

    return produtos
      .filter(p => p.nome.length > 5 && p.link && limparPreco(p.preco) > 0)
      .map(p => ({
        id: uid('amz'), produto: p.nome, loja: 'Amazon', categoria: 'Eletrônicos',
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
    ultimasOfertas = ofertas; ultimaExecucao = new Date().toISOString();
    console.log(`[Bot Caçador] Concluído — ${ofertas.length} oferta(s).`);
  } catch(e) { console.error('[Bot Caçador] Erro:', e.message); }
}

function iniciarCacador({ intervaloCron = '*/15 * * * *' } = {}) {
  executarVarredura();
  cron.schedule(intervaloCron, executarVarredura);
}
function getUltimasOfertas() { return { ofertas: ultimasOfertas, ultimaExecucao }; }
module.exports = { iniciarCacador, getUltimasOfertas, buscarOfertas };
