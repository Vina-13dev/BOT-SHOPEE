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

// Limpa preço — aceita com ou sem R$, com ponto milhar e vírgula decimal
function limparPreco(texto) {
  if (!texto) return 0;
  const s = String(texto).replace(/R\$\s*/gi,'').replace(/\s/g,'').trim();
  // Pega primeiro número: ex "1.299,00" ou "26,29" ou "1299"
  const m = s.match(/^(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/);
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

// Gera link de afiliado a partir dos dados do .env
function gerarLinkAfiliadoBot(loja, link) {
  if (!link) return link;
  const shopeeId  = process.env.SHOPEE_AFFILIATE_ID   || '';
  const mlId      = process.env.ML_AFFILIATE_ID       || '';
  const amazonTag = process.env.AMAZON_AFFILIATE_TAG  || '';
  const sep = link.includes('?') ? '&' : '?';
  if (loja === 'Shopee'         && shopeeId)  return `${link}${sep}smtt=0.0.9&source=affiliate&id=${shopeeId}`;
  if (loja === 'Mercado Livre'  && mlId)      return `${link}${sep}matt_tool=${mlId}&matt_word=&matt_source=bot`;
  if (loja === 'Amazon'         && amazonTag) return `${link}${sep}tag=${amazonTag}`;
  return link;
}

// ─── Shopee ──────────────────────────────────────────────────────────────────
async function buscarShopee(browser) {
  console.log('[Caçador] Shopee: iniciando...');
  const page = await novaPagina(browser);
  try {
    // Abre homepage para pegar cookies de sessão
    await page.goto('https://shopee.com.br/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await delay(2500);

    // Chama API de busca com sessão ativa
    const resp = await page.evaluate(async () => {
      const urls = [
        'https://shopee.com.br/api/v4/search/search_items?by=relevancy&keyword=eletronicos&limit=10&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2',
        'https://shopee.com.br/api/v4/search/search_items?by=pop&keyword=celular&limit=10&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2',
        'https://shopee.com.br/api/v4/recommend/recommend?bundle=top_picks_for_you&limit=10&offset=0',
      ];
      for (const url of urls) {
        try {
          const r = await fetch(url, {
            credentials: 'include',
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }
          });
          const body = await r.text();
          if (r.status === 200 && body.includes('"name"')) return { status: r.status, body, url };
        } catch(e) {}
      }
      return { status: 0, body: '', url: '' };
    });

    console.log(`[Caçador] Shopee API: status=${resp.status} url=${resp.url?.split('?')[0]?.split('/').pop()}`);

    let items = [];
    if (resp.status === 200) {
      try {
        const json = JSON.parse(resp.body);
        items = json?.items?.map(i => i.item_basic || i)
          || json?.data?.sections?.[0]?.data?.item
          || json?.data?.item
          || [];
      } catch(e) {}
    }

    console.log(`[Caçador] Shopee: ${items.length} item(s) na API`);

    if (items.length > 0) {
      const resultado = items.slice(0,8).map(info => {
        const precoAtual  = Math.round((info.price || info.price_min || 0) / 100000 * 100) / 100;
        const precoAntigo = Math.round((info.price_before_discount || info.raw_discount || 0) / 100000 * 100) / 100;
        const link = info.shopid && info.itemid
          ? `https://shopee.com.br/product/${info.shopid}/${info.itemid}` : '';
        return {
          id: uid('shopee'), produto: (info.name || '').trim(),
          loja: 'Shopee', categoria: 'Eletrônicos',
          precoAntigo, precoAtual, comissaoPct: 10, cupom: null,
          relampago: !!(info.flash_sale),
          link, linkAfiliado: gerarLinkAfiliadoBot('Shopee', link),
          imagemUrl: info.image ? `https://cf.shopee.com.br/file/${info.image}` : null,
          encontradoEm: new Date().toISOString(),
        };
      }).filter(o => o.produto && o.precoAtual > 0);

      // Encurta links em paralelo
      const comLinks = await Promise.all(resultado.map(async o => ({
        ...o,
        linkEncurtado: await encurtarLink(o.linkAfiliado || o.link),
      })));
      return comLinks;
    }

    // Fallback: scraping HTML da busca
    console.log('[Caçador] Shopee: fallback HTML busca...');
    await page.goto('https://shopee.com.br/busca?keyword=celular+barato&sortBy=sales', {
      waitUntil: 'networkidle2', timeout: 25000
    });
    await delay(4000);
    await page.evaluate(() => window.scrollTo({ top: 1200, behavior: 'smooth' }));
    await delay(2000);

    const prods = await page.evaluate(() => {
      // Tenta encontrar items de produto com qualquer seletor disponível
      const sels = [
        '[data-sqe="item"]',
        '[class*="shopee-search-item-result__item"]',
        '[class*="col-xs-2-4"]',
        'li[class*="shopee"]',
      ];
      let els = [];
      for (const s of sels) {
        els = Array.from(document.querySelectorAll(s));
        if (els.length > 2) { console.log('Shopee seletor ok:', s, els.length); break; }
      }

      return els.slice(0,10).map(el => {
        const nome = (
          el.querySelector('[data-sqe="name"]')?.innerText ||
          el.querySelector('[class*="truncate"]')?.innerText ||
          el.querySelector('div[class*="name"]')?.innerText || ''
        ).trim();

        // Pega todos os elementos de preço e usa o menor (preço atual com desconto)
        const precos = Array.from(el.querySelectorAll('[class*="price"]'))
          .map(p => p.innerText?.trim() || '').filter(Boolean);

        const preco = precos[0] || '';
        const img   = el.querySelector('img')?.src || '';
        const link  = el.querySelector('a[href*="/product/"], a[href*="shopee"]')?.href
                   || el.querySelector('a')?.href || '';

        return { nome, preco, img, link };
      });
    });

    console.log(`[Caçador] Shopee HTML: ${prods.length}`);
    prods.forEach((p,i) => console.log(`  [${i}] nome="${p.nome.slice(0,40)}" preço="${p.preco}"`));

    const validos = prods.filter(p => p.nome && p.link && limparPreco(p.preco) > 0);
    return await Promise.all(validos.map(async p => {
      const link = p.link;
      const linkAf = gerarLinkAfiliadoBot('Shopee', link);
      return {
        id: uid('shopee'), produto: p.nome, loja: 'Shopee', categoria: 'Eletrônicos',
        precoAntigo: 0, precoAtual: limparPreco(p.preco),
        comissaoPct: 10, cupom: null, relampago: false,
        link, linkAfiliado: linkAf, linkEncurtado: await encurtarLink(linkAf),
        imagemUrl: p.img || null,
        encontradoEm: new Date().toISOString(),
      };
    }));
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
    const urls = [
      'https://www.mercadolivre.com.br/ofertas',
      'https://lista.mercadolivre.com.br/eletronicos',
      'https://lista.mercadolivre.com.br/celulares-telefones',
    ];
    let resultado = [];

    for (const url of urls) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await delay(3000);
      await page.evaluate(() => window.scrollBy(0, 500));
      await delay(1000);

      const title = await page.title();
      console.log(`[Caçador] ML: "${title}"`);

      resultado = await page.evaluate(() => {
        // Múltiplos seletores para diferentes layouts do ML
        let cards = Array.from(document.querySelectorAll('li.promotion-item'));
        if (!cards.length) cards = Array.from(document.querySelectorAll('li.ui-search-layout__item'));
        if (!cards.length) cards = Array.from(document.querySelectorAll('.andes-card'));
        console.log('ML cards:', cards.length, cards[0]?.className?.slice(0,50));

        return cards.slice(0,10).map(card => {
          // Nome
          const nome = (
            card.querySelector('p.promotion-item__title')?.innerText ||
            card.querySelector('h2.ui-search-item__title')?.innerText ||
            card.querySelector('h3.ui-search-item__title')?.innerText ||
            card.querySelector('[class*="title"]')?.innerText || ''
          ).trim();

          // Preço: identifica container original/antigo e pega o atual
          const precoOrigContainer = card.querySelector(
            '[class*="original"],[class*="before"],[class*="previous"],[class*="struck"]'
          );

          const todosFrags  = Array.from(card.querySelectorAll('.andes-money-amount__fraction'));
          const todosCents  = Array.from(card.querySelectorAll('.andes-money-amount__cents'));

          // Preço atual = primeiro frag que não está dentro do container original
          let fracAtual = null, centsAtual = null;
          for (let i = 0; i < todosFrags.length; i++) {
            if (!precoOrigContainer || !precoOrigContainer.contains(todosFrags[i])) {
              fracAtual  = todosFrags[i];
              centsAtual = todosCents[i] || null;
              break;
            }
          }

          // Extrai texto direto do nó (sem filhos aninhados) para evitar concatenação
          const frac  = fracAtual  ? (fracAtual.firstChild?.nodeValue  || fracAtual.innerText  || '').trim().replace(/\D/g,'') : '';
          const cents = centsAtual ? (centsAtual.firstChild?.nodeValue || centsAtual.innerText || '').trim().replace(/\D/g,'') : '00';
          const precoAtual = frac ? `${frac},${cents.slice(0,2).padEnd(2,'0')}` : '0';

          // Preço original (riscado)
          const fracOrig = precoOrigContainer?.querySelector('.andes-money-amount__fraction');
          const precoOrig = fracOrig
            ? (fracOrig.firstChild?.nodeValue || fracOrig.innerText || '').trim().replace(/\D/g,'')
            : '0';

          const img  = card.querySelector('img')?.src || card.querySelector('img')?.dataset?.src || '';
          const link = card.querySelector('a[href*="mercadolivre"],a[href*="mercadolibre"]')?.href || '';

          return { nome, precoAtual, precoOrig, img, link };
        });
      });

      console.log(`[Caçador] ML: ${resultado.length} produto(s)`);
      resultado.forEach((p,i) => console.log(`  [${i}] nome="${p.nome.slice(0,45)}" atual="${p.precoAtual}" orig="${p.precoOrig}"`));

      if (resultado.filter(p => p.nome && p.link && p.precoAtual !== '0').length > 0) break;
      console.log('[Caçador] ML: sem produtos válidos, tentando próxima URL...');
    }

    return await Promise.all(
      resultado
        .filter(p => p.nome && p.link && p.precoAtual !== '0' && limparPreco(p.precoAtual) > 0)
        .map(async p => {
          const link   = p.link.split('?')[0];
          const linkAf = gerarLinkAfiliadoBot('Mercado Livre', link);
          return {
            id: uid('ml'), produto: p.nome, loja: 'Mercado Livre', categoria: 'Eletrônicos',
            precoAntigo: limparPreco(p.precoOrig),
            precoAtual:  limparPreco(p.precoAtual),
            comissaoPct: 8, cupom: null, relampago: false,
            link, linkAfiliado: linkAf,
            linkEncurtado: await encurtarLink(linkAf),
            imagemUrl: p.img || null,
            encontradoEm: new Date().toISOString(),
          };
        })
    );
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
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    await delay(4000);

    const produtos = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-component-type="s-search-result"]'));
      console.log('Amazon cards:', cards.length);

      return cards.slice(0,12).map(card => {
        // Nome — aria-label tem o nome completo sem corte
        const linkEl = card.querySelector('h2 a');
        const nome   = linkEl?.getAttribute('aria-label')?.trim()
                    || card.querySelector('h2 a span')?.innerText?.trim()
                    || card.querySelector('h2 span')?.innerText?.trim() || '';

        // Preço — whole + fraction é o mais confiável
        const whole    = (card.querySelector('.a-price-whole')?.innerText || '').replace(/[^\d]/g,'');
        const fraction = (card.querySelector('.a-price-fraction')?.innerText || '').replace(/[^\d]/g,'').padEnd(2,'0');
        // Fallback: .a-offscreen tem "R$ 26,29"
        const offscreen = card.querySelector('.a-price .a-offscreen')?.innerText?.trim() || '';
        const preco = whole ? `${whole},${fraction}` : offscreen;

        const img  = card.querySelector('img.s-image')?.src || '';
        const href = card.querySelector('h2 a[href]')?.getAttribute('href') || '';
        const link = href ? 'https://www.amazon.com.br' + href : '';

        return { nome, preco, img, link };
      });
    });

    console.log(`[Caçador] Amazon: ${produtos.length} extraídos`);
    produtos.forEach((p,i) => console.log(`  [${i}] nome="${p.nome.slice(0,50)}" preço="${p.preco}"`));

    // Só ignora textos que claramente não são nomes de produto
    const IGNORAR = /^(escolha da amazon|mais vendido no brasil|patrocinado|garantia estendida|resultado|amazon basics$)/i;

    return await Promise.all(
      produtos
        .filter(p => {
          const preco = limparPreco(p.preco);
          const nomeOk = p.nome.length > 8 && !IGNORAR.test(p.nome.trim());
          const precoOk = preco > 0 && preco < 50000; // descarta preços absurdos
          return nomeOk && precoOk && p.link;
        })
        .map(async p => {
          const linkAf = gerarLinkAfiliadoBot('Amazon', p.link);
          return {
            id: uid('amz'), produto: p.nome, loja: 'Amazon', categoria: 'Eletrônicos',
            precoAntigo: 0, precoAtual: limparPreco(p.preco),
            comissaoPct: 12, cupom: null, relampago: false,
            link: p.link, linkAfiliado: linkAf,
            linkEncurtado: await encurtarLink(linkAf),
            imagemUrl: p.img || null,
            encontradoEm: new Date().toISOString(),
          };
        })
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
