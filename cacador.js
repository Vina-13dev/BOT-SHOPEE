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

// ─── Anti-bloqueio: cooldown por loja ───────────────────────────────────────
// Quando uma loja é detectada bloqueando (captcha/403/429), paramos de bater
// nela por um tempo em vez de insistir — insistir é o que faz o bloqueio virar
// permanente (banimento de IP/conta).
const cooldown = {}; // { loja: timestampLiberacao }
const COOLDOWN_MS = Number(process.env.COOLDOWN_MINUTOS || 45) * 60 * 1000;

function emCooldown(loja) {
  return cooldown[loja] && Date.now() < cooldown[loja];
}
function ativarCooldown(loja, motivo) {
  cooldown[loja] = Date.now() + COOLDOWN_MS;
  console.warn(`[Caçador] ${loja} em cooldown por ${COOLDOWN_MS / 60000} min (motivo: ${motivo}). Próxima tentativa após ${new Date(cooldown[loja]).toLocaleTimeString('pt-BR')}.`);
}

// ─── Sinais de bloqueio conhecidos ───────────────────────────────────────────
const SINAIS_BLOQUEIO = [
  'captcha', 'recaptcha', 'are you a human', 'you are a human', 'not a robot',
  'robot check', 'verify you are', 'confirm you are',
  'acesso bloqueado', 'acesso negado', 'access denied', 'unusual traffic',
  'tráfego incomum', 'verifique que você é uma pessoa',
  'sorry, we just need to make sure', 'just need to make sure',
  'px-captcha', 'request blocked', 'forbidden', 'pardon our interruption',
];

async function detectarBloqueio(page, respostaHttp) {
  const status = respostaHttp ? respostaHttp.status() : null;
  if (status === 403 || status === 429 || status === 503) {
    return `status HTTP ${status}`;
  }
  try {
    const conteudo = (await page.title() + ' ' + (await page.evaluate(() => document.body?.innerText?.slice(0, 500) || ''))).toLowerCase();
    const sinal = SINAIS_BLOQUEIO.find(s => conteudo.includes(s));
    if (sinal) return `conteúdo de bloqueio detectado ("${sinal}")`;
  } catch (e) { /* página pode já ter navegado/fechado, ignora */ }
  return null;
}

// ─── Atraso aleatório (evita padrão de timing robótico) ─────────────────────
function delayAleatorio(minMs, maxMs) {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return delay(ms);
}

// ─── Navegação segura: checa status e sinais de bloqueio ───────────────────
// Em vez de só "ir e esperar", confirma se a página que voltou é a página de
// verdade ou uma tela de captcha/bloqueio — e devolve isso explicitamente para
// quem chamou, em vez de deixar o scraper seguir como se nada tivesse acontecido.
async function irComSeguranca(page, url, opcoes = {}) {
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000, ...opcoes });
  const bloqueio = await detectarBloqueio(page, resp);
  return { resp, bloqueio };
}

function limparPreco(texto) {
  if (!texto) return 0;
  // Remove R$, espaços, e pega o primeiro valor monetário completo
  const s = texto.replace(/R\$\s*/gi,'').trim();
  // Padrão: 1.099,99 ou 1099,99 ou 26,29 ou 1099
  const m = s.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:,\d{2})?)/);
  if (!m) return 0;
  return parseFloat(m[1].replace(/\.(?=\d{3})/g,'').replace(',','.')) || 0;
}

function uid(p) { return `${p}-${Date.now()}-${Math.random().toString(36).substr(2,9)}`; }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// pool pequeno de combinações realistas — evita usar sempre o mesmo viewport
// exato em toda sessão, o que por si só já é um fingerprint reconhecível.
const VIEWPORTS = [
  { width: 1366, height: 768 }, { width: 1440, height: 900 },
  { width: 1536, height: 864 }, { width: 1920, height: 1080 },
];
const ACCEPT_LANGUAGES = ['pt-BR,pt;q=0.9,en;q=0.8', 'pt-BR,pt;q=0.9', 'pt-BR,en-US;q=0.9,en;q=0.8'];

async function novaPagina(browser) {
  const page = await browser.newPage();
  const ua = randomUserAgent.getRandom(u => u.browserName === 'Chrome' && parseFloat(u.browserVersion) >= 110)
    || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  await page.setUserAgent(ua);
  const viewport = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
  await page.setViewport(viewport);
  await page.setExtraHTTPHeaders({
    'Accept-Language': ACCEPT_LANGUAGES[Math.floor(Math.random() * ACCEPT_LANGUAGES.length)],
  });

  // Bloqueia imagens/fonts para acelerar
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (['image','stylesheet','font','media'].includes(req.resourceType())) req.abort();
    else req.continue();
  });

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3] });
    Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR','pt','en'] });
    window.chrome = { runtime: {} };
  });
  return page;
}

// ─── Shopee ──────────────────────────────────────────────────────────────────
async function buscarShopee(browser) {
  if (emCooldown('Shopee')) { console.log('[Caçador] Shopee em cooldown, pulando.'); return []; }
  console.log('[Caçador] Shopee: iniciando...');
  const page = await novaPagina(browser);
  try {
    const { bloqueio } = await irComSeguranca(page, 'https://shopee.com.br/');
    if (bloqueio) { ativarCooldown('Shopee', bloqueio); return []; }
    await delayAleatorio(2000, 3500);

    // Tenta API v4 e v5
    const endpoints = [
      'https://shopee.com.br/api/v4/search/search_items?by=relevancy&keyword=eletronicos&limit=10&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2',
      'https://shopee.com.br/api/v5/search/search_items?by=relevancy&keyword=eletronicos&limit=10&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=5',
    ];

    let items = [];
    for (const apiUrl of endpoints) {
      const resp = await page.evaluate(async (url) => {
        try {
          const r = await fetch(url, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' } });
          return { status: r.status, body: await r.text() };
        } catch(e) { return { status: 0, body: '' }; }
      }, apiUrl);

      console.log(`[Caçador] Shopee API status: ${resp.status} (${apiUrl.includes('v5') ? 'v5' : 'v4'})`);
      if (resp.status !== 200) continue;

      try {
        const json = JSON.parse(resp.body);
        items = json?.items || [];
        if (items.length > 0) { console.log(`[Caçador] Shopee API: ${items.length} itens`); break; }
      } catch(e) { continue; }
    }

    if (items.length > 0) {
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

    // Fallback HTML
    console.log('[Caçador] Shopee: fallback HTML...');
    const { bloqueio: bloqueioFallback } = await irComSeguranca(page, 'https://shopee.com.br/busca?keyword=eletronicos', { waitUntil: 'networkidle2', timeout: 25000 });
    if (bloqueioFallback) { ativarCooldown('Shopee', bloqueioFallback); return []; }
    await delayAleatorio(3000, 5000);
    await page.evaluate(() => window.scrollTo({ top: 1000, behavior: 'instant' }));
    await delayAleatorio(1500, 2500);

    const prods = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('[data-sqe="item"]'));
      console.log('Shopee els:', els.length);
      return els.slice(0,8).map(el => ({
        nome:  el.querySelector('[data-sqe="name"]')?.innerText?.trim() || '',
        preco: el.querySelector('[class*="price"]')?.innerText?.split('\n')[0]?.trim() || '',
        img:   el.querySelector('img')?.src || '',
        link:  el.querySelector('a[href*="/product/"]')?.href || el.querySelector('a')?.href || '',
      }));
    });

    console.log(`[Caçador] Shopee HTML: ${prods.length}`);
    prods.forEach((p,i) => console.log(`  [${i}] nome="${p.nome}" preço="${p.preco}"`));

    return prods.filter(p => p.nome && p.link).map(p => ({
      id: uid('shopee'), produto: p.nome, loja: 'Shopee', categoria: 'Eletrônicos',
      precoAntigo: 0, precoAtual: limparPreco(p.preco),
      comissaoPct: 10, cupom: null, relampago: false,
      link: p.link, imagemUrl: null,
      encontradoEm: new Date().toISOString(),
    })).filter(o => o.precoAtual > 0);
  } catch(e) {
    console.error('[Caçador] Shopee falhou:', e.message);
    return [];
  } finally { await page.close(); }
}

// ─── Mercado Livre ───────────────────────────────────────────────────────────
async function buscarMercadoLivre(browser) {
  if (emCooldown('Mercado Livre')) { console.log('[Caçador] Mercado Livre em cooldown, pulando.'); return []; }
  console.log('[Caçador] ML: iniciando...');
  const page = await novaPagina(browser);
  try {
    const urls = [
      'https://www.mercadolivre.com.br/ofertas',
      'https://lista.mercadolivre.com.br/eletronicos',
    ];

    let resultado = [];
    for (const url of urls) {
      const { bloqueio } = await irComSeguranca(page, url);
      if (bloqueio) { ativarCooldown('Mercado Livre', bloqueio); return []; }
      await delayAleatorio(2500, 4000);
      await page.evaluate(() => window.scrollBy(0, 500));
      await delayAleatorio(800, 1500);

      const title = await page.title();
      console.log(`[Caçador] ML: "${title}"`);

      resultado = await page.evaluate(() => {
        // Tenta diferentes seletores de card
        let cards = Array.from(document.querySelectorAll('li.promotion-item'));
        if (!cards.length) cards = Array.from(document.querySelectorAll('li.ui-search-layout__item'));
        if (!cards.length) cards = Array.from(document.querySelectorAll('.andes-card'));
        console.log('ML cards:', cards.length, cards[0]?.className);

        return cards.slice(0,8).map(card => {
          // Nome
          const nome = (
            card.querySelector('p.promotion-item__title')?.innerText ||
            card.querySelector('h2.ui-search-item__title')?.innerText ||
            card.querySelector('[class*="title"]')?.innerText || ''
          ).trim();

          // ── PREÇO CORRETO ──
          // Estratégia: pega todos os elementos de fração de preço
          // O PRIMEIRO é sempre o preço atual (com desconto)
          // O SEGUNDO (se existir dentro de um elemento "original") é o antigo
          const fracEls = Array.from(card.querySelectorAll('.andes-money-amount__fraction'));
          const centsEls = Array.from(card.querySelectorAll('.andes-money-amount__cents'));

          // Verifica qual elemento é o preço atual vs original
          // O preço original fica dentro de um container com classe "original" ou "before"
          const precoOrigContainer = card.querySelector(
            '[class*="original"], [class*="before"], [class*="previous"], [class*="struck"]'
          );
          const precoOrigFrac = precoOrigContainer?.querySelector('.andes-money-amount__fraction');

          // Preço atual = primeiro frac que NÃO está dentro do container original
          let precoAtualFrac = null;
          let precoAtualCents = null;
          for (let i = 0; i < fracEls.length; i++) {
            if (!precoOrigContainer || !precoOrigContainer.contains(fracEls[i])) {
              precoAtualFrac  = fracEls[i];
              precoAtualCents = centsEls[i] || null;
              break;
            }
          }

          // Monta string de preço: pega SOMENTE o nó de texto direto (sem filhos)
          const frac  = precoAtualFrac  ? (precoAtualFrac.firstChild?.textContent  || '').trim() : '0';
          const cents = precoAtualCents ? (precoAtualCents.firstChild?.textContent || '').trim() : '00';
          const precoAtual = frac !== '0' ? `${frac},${cents.padEnd(2,'0')}` : '0';

          const precoOrig = precoOrigFrac ? (precoOrigFrac.firstChild?.textContent || '').trim() : '0';

          const img  = card.querySelector('img')?.src || card.querySelector('img')?.dataset?.src || '';
          const link = card.querySelector('a[href*="mercadolivre"], a[href*="mercadolibre"]')?.href || '';

          return { nome, precoAtual, precoOrig, img, link };
        });
      });

      console.log(`[Caçador] ML: ${resultado.length} produto(s)`);
      resultado.forEach((p,i) => console.log(`  [${i}] nome="${p.nome.slice(0,45)}" atual="${p.precoAtual}" orig="${p.precoOrig}"`));

      if (resultado.filter(p => p.nome && p.link).length > 0) break;
    }

    return resultado.filter(p => p.nome && p.link && p.precoAtual !== '0').map(p => ({
      id: uid('ml'), produto: p.nome, loja: 'Mercado Livre', categoria: 'Eletrônicos',
      precoAntigo: limparPreco(p.precoOrig),
      precoAtual:  limparPreco(p.precoAtual),
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
  if (emCooldown('Amazon')) { console.log('[Caçador] Amazon em cooldown, pulando.'); return []; }
  console.log('[Caçador] Amazon: iniciando...');
  const page = await novaPagina(browser);
  try {
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'pt-BR,pt;q=0.9',
      'sec-ch-ua': '"Not_A_Brand";v="8", "Chromium";v="124", "Google Chrome";v="124"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    });

    const { bloqueio } = await irComSeguranca(page, 'https://www.amazon.com.br/s?k=eletronicos&s=price-desc-rank', { waitUntil: 'networkidle2', timeout: 30000 });
    if (bloqueio) { ativarCooldown('Amazon', bloqueio); return []; }
    await delayAleatorio(4000, 6000);

    const produtos = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-component-type="s-search-result"]'));
      return cards.slice(0,12).map(card => {
        // Nome: span direto dentro do h2 a
        const nomeEl = card.querySelector('h2 a span');
        const nome = nomeEl?.innerText?.trim() || '';

        // Preço: monta com whole + fraction
        const whole    = card.querySelector('.a-price-whole')?.innerText?.trim().replace(/[^\d]/g,'') || '';
        const fraction = card.querySelector('.a-price-fraction')?.innerText?.trim().replace(/[^\d]/g,'') || '00';
        // Também tenta .a-offscreen como fallback
        const offscreen = card.querySelector('.a-price .a-offscreen')?.innerText?.trim() || '';

        const preco = whole ? `${whole},${fraction}` : offscreen;

        const img  = card.querySelector('img.s-image')?.src || '';
        const linkEl = card.querySelector('h2 a[href]');
        const link = linkEl ? 'https://www.amazon.com.br' + linkEl.getAttribute('href') : '';

        return { nome, preco, img, link };
      });
    });

    console.log(`[Caçador] Amazon: ${produtos.length} extraídos.`);
    produtos.forEach((p,i) => console.log(`  [${i}] nome="${p.nome.slice(0,50)}" preço="${p.preco}"`));

    // Filtra: ignora badges, produtos sem nome real e sem preço
    const IGNORAR = /^(escolha da amazon|mais vendido|patrocinado|garantia estendida|resultados)/i;
    return produtos
      .filter(p => p.nome.length > 5 && !IGNORAR.test(p.nome) && p.link && limparPreco(p.preco) > 0)
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

// ─── Principal com retry na Shopee ───────────────────────────────────────────
async function buscarOfertas() {
  let browser;
  try {
    browser = await puppeteer.launch(launchOptions);
    console.log('[Caçador] Navegador iniciado.');

    // Shopee com até 3 tentativas — mas para na hora se detectar bloqueio
    // (insistir durante um cooldown é o que transforma bloqueio temporário em permanente).
    let shopee = [];
    for (let i = 0; i < 3 && shopee.length === 0; i++) {
      if (emCooldown('Shopee')) { console.log('[Caçador] Shopee em cooldown, abortando tentativas.'); break; }
      if (i > 0) { console.log(`[Retry] Shopee tentativa ${i+1}...`); await delayAleatorio(4000, 7000); }
      shopee = await buscarShopee(browser).catch(e => { console.error('[Retry] Shopee:', e.message); return []; });
    }

    // espalha as requisições entre lojas em vez de bater nas três sem pausa —
    // ajuda a não parecer um robô fazendo varredura em sequência cronometrada.
    await delayAleatorio(3000, 6000);
    const ml = await buscarMercadoLivre(browser);

    await delayAleatorio(3000, 6000);
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
function getStatusCooldown() {
  const agora = Date.now();
  const status = {};
  for (const loja of ['Shopee', 'Mercado Livre', 'Amazon']) {
    status[loja] = cooldown[loja] && agora < cooldown[loja]
      ? { emCooldown: true, liberaEm: new Date(cooldown[loja]).toISOString() }
      : { emCooldown: false };
  }
  return status;
}

module.exports = { iniciarCacador, getUltimasOfertas, buscarOfertas, getStatusCooldown };
