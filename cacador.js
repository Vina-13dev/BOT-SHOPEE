// cacador.js
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const randomUserAgent = require('random-useragent');
const cron = require('node-cron');
const https = require('https');

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

// ─── Encurtador TinyURL ───────────────────────────────────────────────────────
async function encurtarLink(url) {
  if (!url) return url;
  return new Promise(resolve => {
    const req = https.get(
      `https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`,
      { timeout: 6000 },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          const enc = data.trim();
          resolve(enc.startsWith('http') ? enc : url);
        });
      }
    );
    req.on('error', () => resolve(url));
    req.on('timeout', () => { req.destroy(); resolve(url); });
  });
}

function limparPreco(texto) {
  if (!texto) return 0;
  const s = texto.replace(/R\$\s*/gi,'').trim();
  const m = s.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:,\d{2})?)/);
  if (!m) return 0;
  return parseFloat(m[1].replace(/\.(?=\d{3})/g,'').replace(',','.')) || 0;
}

function uid(p) { return `${p}-${Date.now()}-${Math.random().toString(36).substr(2,9)}`; }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function novaPagina(browser) {
  const page = await browser.newPage();
  const ua = randomUserAgent.getRandom(u => u.browserName === 'Chrome' && parseFloat(u.browserVersion) >= 110)
    || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  await page.setUserAgent(ua);
  await page.setViewport({ width: 1366, height: 768 });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3] });
    Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR','pt','en'] });
    window.chrome = { runtime: {} };
  });
  return page;
}

// ─── Shopee — scraping direto da página de mais vendidos/ofertas ──────────────
async function buscarShopee(browser) {
  console.log('[Caçador] Shopee: iniciando scraping...');
  const page = await novaPagina(browser);
  try {
    // Vai direto para página de flash sale que tem produtos com maior desconto
    await page.goto('https://shopee.com.br/flash_sale', {
      waitUntil: 'networkidle2', timeout: 30000
    });
    await delay(4000);
    await page.evaluate(() => window.scrollTo({ top: 600, behavior: 'smooth' }));
    await delay(2000);

    let prods = await page.evaluate(() => {
      // Seletores específicos da flash sale da Shopee
      const containers = [
        '[class*="flash-sale"] [class*="item"]',
        '[class*="flashsale"] [class*="item"]',
        '[data-sqe="item"]',
        '.product-item',
        '[class*="shopee-flash-sale-products"] [class*="product"]',
      ];

      let els = [];
      for (const sel of containers) {
        els = Array.from(document.querySelectorAll(sel));
        if (els.length > 0) { console.log('Shopee seletor:', sel, els.length); break; }
      }

      return els.slice(0,10).map(el => {
        const nome  = (
          el.querySelector('[data-sqe="name"]')?.innerText ||
          el.querySelector('[class*="name"]')?.innerText ||
          el.querySelector('h3, h2')?.innerText || ''
        ).trim();

        // Preço com desconto (preço atual)
        const precoEl = (
          el.querySelector('[class*="price-current"]') ||
          el.querySelector('[class*="discounted"]') ||
          el.querySelector('[class*="flashsale-price"]') ||
          el.querySelector('[class*="price"]')
        );
        const preco = precoEl?.innerText?.split('\n')[0]?.trim() || '';

        // Preço original (riscado)
        const precoOrigEl = (
          el.querySelector('[class*="price-before"]') ||
          el.querySelector('[class*="original"]') ||
          el.querySelector('[class*="price-origin"]')
        );
        const precoOrig = precoOrigEl?.innerText?.trim() || '';

        const img  = el.querySelector('img')?.src || el.querySelector('img')?.dataset?.src || '';
        const link = el.querySelector('a[href*="/product/"], a[href*="shopee"]')?.href
                  || el.querySelector('a')?.href || '';

        return { nome, preco, precoOrig, img, link };
      });
    });

    console.log(`[Caçador] Shopee flash: ${prods.length} itens`);
    prods.forEach((p,i) => console.log(`  [${i}] nome="${p.nome.slice(0,40)}" preço="${p.preco}" orig="${p.precoOrig}"`));

    // Se flash sale não funcionou, tenta mais vendidos
    if (prods.filter(p => p.nome && p.link).length === 0) {
      console.log('[Caçador] Shopee: tentando mais vendidos...');
      await page.goto('https://shopee.com.br/busca?keyword=eletronicos&sortBy=sales', {
        waitUntil: 'networkidle2', timeout: 25000
      });
      await delay(4000);
      await page.evaluate(() => window.scrollTo({ top: 800, behavior: 'smooth' }));
      await delay(2000);

      prods = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('[data-sqe="item"]'));
        console.log('Shopee busca els:', els.length);
        return els.slice(0,10).map(el => ({
          nome:     el.querySelector('[data-sqe="name"]')?.innerText?.trim() || '',
          preco:    el.querySelectorAll('[class*="price"]')?.[0]?.innerText?.split('\n')[0]?.trim() || '',
          precoOrig:el.querySelectorAll('[class*="price"]')?.[1]?.innerText?.split('\n')[0]?.trim() || '',
          img:      el.querySelector('img')?.src || '',
          link:     el.querySelector('a')?.href || '',
        }));
      });

      console.log(`[Caçador] Shopee busca: ${prods.length}`);
      prods.forEach((p,i) => console.log(`  [${i}] nome="${p.nome.slice(0,40)}" preço="${p.preco}"`));
    }

    const validos = prods.filter(p => p.nome && p.link && limparPreco(p.preco) > 0);
    return await Promise.all(validos.map(async p => ({
      id: uid('shopee'), produto: p.nome, loja: 'Shopee', categoria: 'Eletrônicos',
      precoAntigo: limparPreco(p.precoOrig),
      precoAtual:  limparPreco(p.preco),
      comissaoPct: 10, cupom: null, relampago: true,
      link: p.link,
      linkEncurtado: await encurtarLink(p.link),
      imagemUrl: p.img || null,
      encontradoEm: new Date().toISOString(),
    })));
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
    const urls = ['https://www.mercadolivre.com.br/ofertas','https://lista.mercadolivre.com.br/eletronicos'];
    let resultado = [];

    for (const url of urls) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await delay(3000);
      await page.evaluate(() => window.scrollBy(0, 500));
      await delay(1000);

      resultado = await page.evaluate(() => {
        let cards = Array.from(document.querySelectorAll('li.promotion-item'));
        if (!cards.length) cards = Array.from(document.querySelectorAll('li.ui-search-layout__item'));
        console.log('ML cards:', cards.length);

        return cards.slice(0,8).map(card => {
          const nome = (
            card.querySelector('p.promotion-item__title')?.innerText ||
            card.querySelector('h2.ui-search-item__title')?.innerText ||
            card.querySelector('[class*="title"]')?.innerText || ''
          ).trim();

          const precoOrigContainer = card.querySelector('[class*="original"],[class*="before"],[class*="previous"]');
          const precoOrigFrac = precoOrigContainer?.querySelector('.andes-money-amount__fraction');
          const fracEls  = Array.from(card.querySelectorAll('.andes-money-amount__fraction'));
          const centsEls = Array.from(card.querySelectorAll('.andes-money-amount__cents'));

          let precoAtualFrac = null, precoAtualCents = null;
          for (let i = 0; i < fracEls.length; i++) {
            if (!precoOrigContainer || !precoOrigContainer.contains(fracEls[i])) {
              precoAtualFrac = fracEls[i]; precoAtualCents = centsEls[i] || null; break;
            }
          }

          const frac  = precoAtualFrac  ? (precoAtualFrac.firstChild?.textContent  || '').trim() : '0';
          const cents = precoAtualCents ? (precoAtualCents.firstChild?.textContent || '').trim() : '00';
          const precoAtual = frac !== '0' ? `${frac},${cents.padEnd(2,'0')}` : '0';
          const precoOrig  = precoOrigFrac ? (precoOrigFrac.firstChild?.textContent || '').trim() : '0';

          const img  = card.querySelector('img')?.src || card.querySelector('img')?.dataset?.src || '';
          const link = card.querySelector('a[href*="mercadolivre"],a[href*="mercadolibre"]')?.href || '';
          return { nome, precoAtual, precoOrig, img, link };
        });
      });

      if (resultado.filter(p => p.nome && p.link).length > 0) break;
    }

    console.log(`[Caçador] ML: ${resultado.length} produto(s)`);
    resultado.forEach((p,i) => console.log(`  [${i}] nome="${p.nome.slice(0,45)}" atual="${p.precoAtual}" orig="${p.precoOrig}"`));

    return await Promise.all(
      resultado.filter(p => p.nome && p.link && p.precoAtual !== '0').map(async p => ({
        id: uid('ml'), produto: p.nome, loja: 'Mercado Livre', categoria: 'Eletrônicos',
        precoAntigo: limparPreco(p.precoOrig),
        precoAtual:  limparPreco(p.precoAtual),
        comissaoPct: 8, cupom: null, relampago: false,
        link: p.link.split('?')[0],
        linkEncurtado: await encurtarLink(p.link.split('?')[0]),
        imagemUrl: p.img || null,
        encontradoEm: new Date().toISOString(),
      }))
    ).then(items => items.filter(o => o.precoAtual > 0));
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
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'pt-BR,pt;q=0.9',
      'sec-ch-ua': '"Not_A_Brand";v="8", "Chromium";v="124"',
    });

    // Página de busca com ordenação por relevância
    await page.goto('https://www.amazon.com.br/s?k=eletronicos&rh=p_36%3A1000-5000', {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    await delay(4000);

    const produtos = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-component-type="s-search-result"]'));
      return cards.slice(0,12).map(card => {
        // Nome — pega o aria-label do link que tem o nome completo
        const linkEl = card.querySelector('h2 a');
        const nome = linkEl?.getAttribute('aria-label')?.trim()
          || card.querySelector('h2 a span')?.innerText?.trim()
          || card.querySelector('h2 span')?.innerText?.trim() || '';

        // Preço
        const whole    = card.querySelector('.a-price-whole')?.innerText?.replace(/[^\d]/g,'') || '';
        const fraction = card.querySelector('.a-price-fraction')?.innerText?.replace(/[^\d]/g,'') || '00';
        const offscreen = card.querySelector('.a-price .a-offscreen')?.innerText?.trim() || '';
        const preco = whole ? `${whole},${fraction}` : offscreen;

        const img  = card.querySelector('img.s-image')?.src || '';
        const href = card.querySelector('h2 a[href]')?.getAttribute('href') || '';
        const link = href ? 'https://www.amazon.com.br' + href : '';

        return { nome, preco, img, link };
      });
    });

    const IGNORAR = /^(escolha da amazon|mais vendido|patrocinado|garantia|resultado)/i;
    console.log(`[Caçador] Amazon: ${produtos.length} extraídos`);
    produtos.forEach((p,i) => console.log(`  [${i}] nome="${p.nome.slice(0,50)}" preço="${p.preco}"`));

    return await Promise.all(
      produtos
        .filter(p => p.nome.length > 5 && !IGNORAR.test(p.nome) && p.link && limparPreco(p.preco) > 0)
        .map(async p => ({
          id: uid('amz'), produto: p.nome, loja: 'Amazon', categoria: 'Eletrônicos',
          precoAntigo: 0, precoAtual: limparPreco(p.preco),
          comissaoPct: 12, cupom: null, relampago: false,
          link: p.link,
          linkEncurtado: await encurtarLink(p.link),
          imagemUrl: p.img || null,
          encontradoEm: new Date().toISOString(),
        }))
    );
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
    const shopee = await buscarShopee(browser).catch(e => { console.error('[Shopee]', e.message); return []; });
    const ml     = await buscarMercadoLivre(browser).catch(e => { console.error('[ML]', e.message); return []; });
    const amazon = await buscarAmazon(browser).catch(e => { console.error('[Amazon]', e.message); return []; });
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
