// cacador.js — Mercado Livre via Puppeteer (URL mobile + múltiplas estratégias)
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cron = require('node-cron');
const https = require('https');

puppeteer.use(StealthPlugin());

const launchOptions = {
  headless: 'new',
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  args: [
    '--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas','--no-first-run','--no-zygote',
    '--disable-gpu','--disable-web-security',
    '--disable-blink-features=AutomationControlled',
    '--window-size=390,844', // tamanho de tela mobile
  ],
  ignoreHTTPSErrors: true,
};

// User agent de iPhone — sites mobile são mais simples e menos protegidos
const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

let ultimasOfertas = [];
let ultimaExecucao = null;

// ─── TinyURL ─────────────────────────────────────────────────────────────────
async function encurtarLink(url) {
  if (!url) return url;
  return new Promise(resolve => {
    https.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`, { timeout: 6000 }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d.trim().startsWith('http') ? d.trim() : url));
    }).on('error', () => resolve(url)).on('timeout', function() { this.destroy(); resolve(url); });
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
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function gerarLinkAfiliadoML(link) {
  const mlId = process.env.ML_AFFILIATE_ID || '';
  if (!mlId || !link) return link;
  const sep = link.includes('?') ? '&' : '?';
  return `${link}${sep}matt_tool=${mlId}&matt_word=&matt_source=bot`;
}

// ─── Mercado Livre ───────────────────────────────────────────────────────────
async function buscarMercadoLivre() {
  console.log('[Caçador] ML: iniciando Puppeteer mobile...');
  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();

  try {
    // Simula iPhone
    await page.setUserAgent(UA_MOBILE);
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'platform', { get: () => 'iPhone' });
    });

    // Tenta múltiplas URLs — mobile e desktop
    const tentativas = [
      { url: 'https://www.mercadolivre.com.br/ofertas', tipo: 'mobile-ofertas' },
      { url: 'https://www.mercadolivre.com.br/ofertas#nav-header', tipo: 'mobile-ofertas-nav' },
      { url: 'https://lista.mercadolivre.com.br/eletronicos#D[A:eletronicos]', tipo: 'lista-eletronicos' },
      { url: 'https://lista.mercadolivre.com.br/ofertas-do-dia', tipo: 'ofertas-do-dia' },
    ];

    let produtos = [];

    for (const { url, tipo } of tentativas) {
      console.log(`[Caçador] ML tentando: ${tipo}`);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await delay(3000);

        const title = await page.title();
        console.log(`[Caçador] ML título: "${title}"`);

        // Se redirecionou para versão internacional, tenta mudar o país
        if (title.toLowerCase().includes('mercado libre') && !title.toLowerCase().includes('brasil')) {
          console.log('[Caçador] ML: redirecionado para versão internacional, ajustando...');
          await page.goto('https://www.mercadolivre.com.br/', { waitUntil: 'domcontentloaded', timeout: 15000 });
          await delay(2000);
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await delay(2000);
        }

        // Extrai dados da página
        produtos = await page.evaluate(() => {
          // DEBUG: mostra estrutura real da página
          console.log('Body length:', document.body.innerHTML.length);
          console.log('Total <a> tags:', document.querySelectorAll('a').length);
          console.log('Total <img> tags:', document.querySelectorAll('img').length);
          console.log('Total .andes-money-amount:', document.querySelectorAll('.andes-money-amount').length);
          
          // Lista as primeiras 10 classes únicas de elementos com "item" ou "card" no nome
          const classesComItem = new Set();
          document.querySelectorAll('[class]').forEach(el => {
            const cls = el.className;
            if (typeof cls === 'string' && (cls.includes('item') || cls.includes('card') || cls.includes('result'))) {
              classesComItem.add(cls.split(' ')[0]);
            }
          });
          console.log('Classes com item/card/result:', Array.from(classesComItem).slice(0,15).join(' | '));

          // Estratégia GENÉRICA: encontra qualquer container que tenha
          // um link + uma imagem + um valor monetário juntos
          const moneyEls = Array.from(document.querySelectorAll('.andes-money-amount'));
          console.log('Money elements encontrados:', moneyEls.length);

          let cards = [];
          let seletorUsado = 'generico-via-preco';

          if (moneyEls.length > 0) {
            // Para cada elemento de preço, sobe até achar um container com link e imagem
            const containersVistos = new Set();
            moneyEls.forEach(moneyEl => {
              let el = moneyEl;
              for (let depth = 0; depth < 8; depth++) {
                el = el.parentElement;
                if (!el) break;
                const temLink = el.querySelector('a[href]');
                const temImg  = el.querySelector('img');
                if (temLink && temImg && !containersVistos.has(el)) {
                  containersVistos.add(el);
                  cards.push(el);
                  break;
                }
              }
            });
          }

          // Fallback: seletores tradicionais
          if (cards.length === 0) {
            const seletores = [
              'li.promotion-item','li.ui-search-layout__item','.andes-card--flat',
              '[class*="promotion-item"]','[class*="result"]','article',
              'li[class*="layout"]','div[class*="card"]',
            ];
            for (const sel of seletores) {
              const found = Array.from(document.querySelectorAll(sel));
              if (found.length >= 2) { cards = found; seletorUsado = sel; break; }
            }
          }

          console.log(`Seletor: "${seletorUsado}", cards: ${cards.length}`);

          return cards.slice(0, 15).map((card, i) => {
            const nome = (
              card.querySelector('p.promotion-item__title')?.innerText ||
              card.querySelector('h2.ui-search-item__title')?.innerText ||
              card.querySelector('h3')?.innerText ||
              card.querySelector('[class*="title"]')?.innerText ||
              card.querySelector('p')?.innerText || ''
            ).trim();

            // Coleta todos os valores monetários
            const moneyEls = Array.from(card.querySelectorAll('.andes-money-amount'));
            let precoAtual = '0', precoOrig = '0';

            for (const el of moneyEls) {
              const isOrig = el.closest('[class*="original"],[class*="before"],[class*="previous"],[class*="struck"]')
                          || el.className?.includes('previous')
                          || el.className?.includes('original');
              const frac  = (el.querySelector('.andes-money-amount__fraction')?.firstChild?.nodeValue || '').trim();
              const cents = (el.querySelector('.andes-money-amount__cents')?.firstChild?.nodeValue || '').trim();
              const val   = frac ? `${frac}${cents ? ','+cents : ''}` : '';
              if (!val) continue;
              if (isOrig && precoOrig === '0') precoOrig = val;
              else if (!isOrig && precoAtual === '0') precoAtual = val;
            }

            const img  = card.querySelector('img')?.src || card.querySelector('img')?.dataset?.src || '';
            const link = card.querySelector('a[href*="mercadolivre"],a[href*="mercadolibre"]')?.href || '';

            console.log(`[${i}] "${nome.slice(0,35)}" atual="${precoAtual}" orig="${precoOrig}"`);
            return { nome, precoAtual, precoOrig, img, link };
          });
        });

        const validos = produtos.filter(p =>
          p.nome && p.nome.length > 3 &&
          p.link && limparPreco(p.precoAtual) > 0 &&
          p.nome.toLowerCase() !== 'economiza frete'
        );

        if (validos.length > 0) {
          console.log(`[Caçador] ML: ${validos.length} produtos válidos com "${tipo}"`);
          break;
        }
        console.log(`[Caçador] ML: 0 válidos com "${tipo}", tentando próxima...`);
      } catch(e) {
        console.error(`[Caçador] ML "${tipo}" falhou: ${e.message}`);
      }
    }

    // Processa e filtra
    const resultado = await Promise.all(
      produtos
        .filter(p => {
          const atual = limparPreco(p.precoAtual);
          const orig  = limparPreco(p.precoOrig);
          return p.nome && p.nome.length > 3 && p.link && atual > 0
            && p.nome.toLowerCase() !== 'economiza frete'
            && (orig === 0 || orig > atual); // preço original sempre maior
        })
        .map(async p => {
          const atual  = limparPreco(p.precoAtual);
          const orig   = limparPreco(p.precoOrig);
          const link   = p.link.split('?')[0];
          const linkAf = gerarLinkAfiliadoML(link);
          const linkEnc = await encurtarLink(linkAf || link);
          const desc   = orig > 0 ? Math.round((orig - atual) / orig * 100) : 0;
          console.log(`[Caçador] ML ✓ "${p.nome.slice(0,40)}" R$${atual}${desc > 0 ? ` (${desc}% OFF)` : ''}`);
          return {
            id: uid('ml'), produto: p.nome, loja: 'Mercado Livre', categoria: 'Eletrônicos',
            precoAntigo: orig, precoAtual: atual, comissaoPct: 8, cupom: null, relampago: false,
            link, linkAfiliado: linkAf || link, linkEncurtado: linkEnc,
            imagemUrl: p.img?.replace('http://','https://').replace('-I.jpg','-O.jpg') || null,
            encontradoEm: new Date().toISOString(),
          };
        })
    );

    return resultado;
  } catch(e) {
    console.error('[Caçador] ML falhou:', e.message);
    return [];
  } finally {
    await page.close();
    await browser.close();
  }
}

// ─── Principal ───────────────────────────────────────────────────────────────
async function buscarOfertas() {
  const ml = await buscarMercadoLivre().catch(e => {
    console.error('[ML erro fatal]', e.message);
    return [];
  });
  console.log(`[Caçador] Total: ${ml.length} oferta(s).`);
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
