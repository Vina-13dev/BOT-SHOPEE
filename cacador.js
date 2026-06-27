// cacador.js — somente Mercado Livre
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

// ─── TinyURL ─────────────────────────────────────────────────────────────────
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

// Converte texto de preço para número float
// Ex: "1.299" → 1299, "188,00" → 188, "309" → 309
function limparPreco(texto) {
  if (!texto) return 0;
  const s = String(texto).replace(/R\$\s*/gi,'').replace(/\s/g,'').trim();
  // Detecta formato: se tem vírgula com 2 dígitos no fim = decimal BR
  // se tem ponto com 3 dígitos = milhar
  if (/^\d{1,3}(\.\d{3})*(,\d{2})?$/.test(s)) {
    // Formato BR com ponto milhar: 1.299 ou 1.299,00
    return parseFloat(s.replace(/\./g,'').replace(',','.')) || 0;
  }
  if (/^\d+(,\d{2})?$/.test(s)) {
    // Sem ponto milhar: 188 ou 188,00
    return parseFloat(s.replace(',','.')) || 0;
  }
  // Último recurso
  const m = s.match(/[\d.,]+/);
  if (!m) return 0;
  const num = m[0].replace(/\.(?=\d{3})/g,'').replace(',','.');
  return parseFloat(num) || 0;
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
  console.log('[Caçador] ML: iniciando...');

  const ua = randomUserAgent.getRandom(u => u.browserName === 'Chrome' && parseFloat(u.browserVersion) >= 110)
    || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36';

  const browser = await require('puppeteer-extra').launch({
    ...launchOptions,
    args: [...launchOptions.args],
  });

  const page = await browser.newPage();
  try {
    await page.setUserAgent(ua);
    await page.setViewport({ width: 1366, height: 768 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins',   { get: () => [1,2,3] });
      Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR','pt'] });
      window.chrome = { runtime: {} };
    });

    const urls = [
      'https://www.mercadolivre.com.br/ofertas',
      'https://lista.mercadolivre.com.br/eletronicos',
      'https://lista.mercadolivre.com.br/celulares-telefones',
    ];

    let produtos = [];

    for (const url of urls) {
      console.log(`[Caçador] ML: abrindo ${url}...`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await delay(3000);
      await page.evaluate(() => window.scrollBy(0, 600));
      await delay(1500);

      const title = await page.title();
      console.log(`[Caçador] ML título: "${title}"`);

      produtos = await page.evaluate(() => {
        // Detecta qual layout está sendo usado
        let cards = Array.from(document.querySelectorAll('li.promotion-item'));
        let layout = 'promotion-item';
        if (!cards.length) {
          cards = Array.from(document.querySelectorAll('li.ui-search-layout__item'));
          layout = 'ui-search-layout';
        }
        console.log(`ML layout: ${layout}, cards: ${cards.length}`);

        return cards.slice(0,10).map((card, idx) => {
          // ── Nome ──
          const nome = (
            card.querySelector('p.promotion-item__title')?.innerText ||
            card.querySelector('h2.ui-search-item__title')?.innerText ||
            card.querySelector('h3.ui-search-item__title')?.innerText ||
            card.querySelector('[class*="title"]')?.innerText || ''
          ).trim();

          // ── Imagem ──
          // Pega a imagem do produto, não imagens de badge ou ícone
          let imagemUrl = '';
          const imgs = Array.from(card.querySelectorAll('img'));
          for (const img of imgs) {
            const src = img.src || img.dataset?.src || '';
            // Ignora imagens pequenas (ícones) e SVGs
            if (src && src.startsWith('http') && !src.includes('svg') &&
                (img.naturalWidth > 50 || img.width > 50 || src.includes('MLBr') || src.includes('mlstatic'))) {
              imagemUrl = src;
              break;
            }
          }
          if (!imagemUrl) imagemUrl = imgs[0]?.src || imgs[0]?.dataset?.src || '';

          // ── Preços ──
          // Estratégia: coleta TODOS os valores monetários do card
          // e identifica preço atual (menor, com desconto) e original (maior, riscado)
          const todosMonetarios = Array.from(card.querySelectorAll('.andes-money-amount'));
          
          let precoAtualEl = null;
          let precoOrigEl  = null;

          for (const el of todosMonetarios) {
            const classes = el.className || '';
            // Identifica o preço original (riscado/anterior)
            if (classes.includes('previous') || classes.includes('original') ||
                classes.includes('before')   || classes.includes('struck')   ||
                el.closest('[class*="original"]') || el.closest('[class*="before"]') ||
                el.closest('[class*="previous"]')) {
              if (!precoOrigEl) precoOrigEl = el;
            } else {
              // Preço atual — pega o primeiro que não é original
              if (!precoAtualEl) precoAtualEl = el;
            }
          }

          // Extrai valor do preço atual
          let precoAtual = '0';
          if (precoAtualEl) {
            const frac  = precoAtualEl.querySelector('.andes-money-amount__fraction');
            const cents = precoAtualEl.querySelector('.andes-money-amount__cents');
            // Usa firstChild.nodeValue para pegar só o texto direto, sem filhos
            const fracTxt  = (frac?.firstChild?.nodeValue  || frac?.innerText  || '').trim();
            const centsTxt = (cents?.firstChild?.nodeValue || cents?.innerText || '').trim();
            if (fracTxt) {
              precoAtual = centsTxt ? `${fracTxt},${centsTxt.slice(0,2)}` : fracTxt;
            }
          }

          // Extrai valor do preço original
          let precoOrig = '0';
          if (precoOrigEl) {
            const frac = precoOrigEl.querySelector('.andes-money-amount__fraction');
            precoOrig = (frac?.firstChild?.nodeValue || frac?.innerText || '').trim() || '0';
          }

          // Link do produto
          const link = card.querySelector('a[href*="mercadolivre"],a[href*="mercadolibre"]')?.href || '';

          console.log(`[${idx}] nome="${nome.slice(0,40)}" atual="${precoAtual}" orig="${precoOrig}" img="${imagemUrl.slice(0,60)}"`);
          return { nome, precoAtual, precoOrig, imagemUrl, link };
        });
      });

      console.log(`[Caçador] ML: ${produtos.length} extraídos desta URL`);

      const validos = produtos.filter(p => p.nome && p.link && limparPreco(p.precoAtual) > 0);
      if (validos.length > 0) {
        console.log(`[Caçador] ML: ${validos.length} válidos — usando esta URL`);
        break;
      }
      console.log('[Caçador] ML: nenhum válido, tentando próxima URL...');
    }

    return await Promise.all(
      produtos
        .filter(p => {
          const atual  = limparPreco(p.precoAtual);
          const orig   = limparPreco(p.precoOrig);
          const nomeOk = p.nome && p.nome.length > 3 && p.nome.toLowerCase() !== 'economiza frete';
          const precoOk = atual > 0;
          // Garante que preço original é MAIOR que atual (se existir)
          const precoCoerente = orig === 0 || orig > atual;
          return nomeOk && precoOk && precoCoerente && p.link;
        })
        .map(async p => {
          const atual  = limparPreco(p.precoAtual);
          const orig   = limparPreco(p.precoOrig);
          const link   = p.link.split('?')[0];
          const linkAf = gerarLinkAfiliadoML(link);
          const linkEnc = await encurtarLink(linkAf || link);

          console.log(`[Caçador] ML ✓ "${p.nome.slice(0,40)}" R$${atual}${orig > 0 ? ` (era R$${orig})` : ''}`);

          return {
            id: uid('ml'),
            produto:       p.nome,
            loja:          'Mercado Livre',
            categoria:     'Eletrônicos',
            precoAntigo:   orig,
            precoAtual:    atual,
            comissaoPct:   8,
            cupom:         null,
            relampago:     false,
            link,
            linkAfiliado:  linkAf || link,
            linkEncurtado: linkEnc,
            imagemUrl:     p.imagemUrl || null,
            encontradoEm:  new Date().toISOString(),
          };
        })
    );
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
    console.error('[ML erro]', e.message);
    return [];
  });
  console.log(`[Caçador] ML: ${ml.length} oferta(s) válidas.`);
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
