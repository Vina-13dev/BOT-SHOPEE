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

// ─── Categoria + comissão estimada ──────────────────────────────────────────
// A comissão de afiliado do Mercado Livre NÃO é um número único — varia bem
// forte por categoria (eletrônicos fica bem mais baixo, tipo 5%; beleza,
// moda e esporte chegam a 14-16%). O ML também paga diferente se a venda for
// "direta" (a pessoa comprou o produto exato do link) ou "indireta" (comprou
// outra coisa no mesmo carrinho) — às vezes quase metade do valor.
//
// Os números aqui são uma ESTIMATIVA conservadora, baseada em várias fontes
// públicas sobre o programa de afiliados — o ML não expõe uma tabela via
// scraping, então isso não é 100% garantido. Se notar diferença grande do
// que cai de verdade no seu Mercado Pago, é só ajustar os números abaixo —
// é uma tabela simples, não precisa mexer em nenhuma outra lógica.
const CATEGORIAS_COMISSAO = [
  { categoria: 'Beleza e Cuidados Pessoais', comissaoPct: 14, palavras: [
    'creme','shampoo','condicionador','protetor solar','perfume','maquiagem','batom',
    'hidratante','sérum','serum','base facial','esmalte','depilador','barbeador','sabonete',
  ]},
  { categoria: 'Moda e Calçados', comissaoPct: 13, palavras: [
    'tenis','tênis','sapato','sandália','sandalia','bota','chinelo','cueca','calcinha','sutiã','sutia',
    'camiseta','camisa','calça','calca','jaqueta','vestido','bolsa','mochila','óculos de sol','oculos de sol',
    'relógio','relogio','boné','bone',
  ]},
  { categoria: 'Esporte e Fitness', comissaoPct: 13, palavras: [
    'whey','creatina','suplemento','proteina','proteína','bcaa','halter','caneleira','esteira',
    'bicicleta ergométrica','luva de boxe','tapete de yoga','academia',
  ]},
  { categoria: 'Bebê e Infantil', comissaoPct: 10, palavras: [
    'fralda','lenço umedecido','lenco umedecido','mamadeira','carrinho de bebê','carrinho de bebe',
    'brinquedo','boneca','lego',
  ]},
  { categoria: 'Casa e Cozinha', comissaoPct: 10, palavras: [
    'panela','fritadeira','air fryer','liquidificador','sanduicheira','toalha','jogo de cama','lençol','lencol',
    'travesseiro','potes','vidro hermético','vidro hermetico','mangueira','faqueiro','talheres',
    'papel higiênico','papel higienico','detergente','sabão em pó','sabao em po','desinfetante','organizador',
  ]},
  { categoria: 'Ferramentas e Automotivo', comissaoPct: 7, palavras: [
    'furadeira','parafusadeira','roçadeira','rocadeira','chave de fenda','serra elétrica','esmerilhadeira',
    'pneu','óleo automotivo','oleo automotivo','farol','bateria automotiva','torquímetro','torquimetro',
  ]},
  { categoria: 'Eletrônicos', comissaoPct: 5, palavras: [
    'celular','smartphone','notebook',' tv ','televisão','televisao','fone de ouvido','câmera','camera',
    'carregador','power bank','caixa de som','smartwatch','tablet','mouse','teclado','monitor',
  ]},
];

function classificarProduto(nome) {
  const n = ` ${(nome || '').toLowerCase()} `;
  for (const c of CATEGORIAS_COMISSAO) {
    if (c.palavras.some(p => n.includes(p))) return { categoria: c.categoria, comissaoPct: c.comissaoPct };
  }
  return { categoria: 'Geral', comissaoPct: 8 }; // não reconheceu — fica no meio do caminho
}

// A Shopee paga uma estrutura de comissão BEM diferente do ML (beleza chega
// a ser o dobro do que o ML paga, eletrônicos é bem mais baixo) — por isso
// é uma tabela separada, não os mesmos números. Mesma ressalva: estimativa
// de fontes públicas, não API oficial.
const COMISSAO_SHOPEE_POR_CATEGORIA = {
  'Beleza e Cuidados Pessoais': 18,
  'Moda e Calçados': 14,
  'Esporte e Fitness': 12,
  'Bebê e Infantil': 10,
  'Casa e Cozinha': 9,
  'Ferramentas e Automotivo': 6,
  'Eletrônicos': 4,
  'Geral': 8,
};

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

// O link de afiliado NÃO é gerado aqui. O caçador varre as lojas uma vez só,
// pra todo mundo; cada usuário tem um ID de afiliado diferente, então o link
// final é montado depois — em buscarOfertas.js (para quem não está logado)
// ou no navegador de cada usuário (lib/afiliado.js), usando o link cru daqui.

// ─── Mercado Livre ───────────────────────────────────────────────────────────

// Filtros de qualidade — ajustáveis por variável de ambiente, sem precisar
// mexer no código. Nota/vendas/frete só filtram quando a página realmente
// expõe esse dado (ver aviso no log); desconto sempre filtra, porque esse
// a gente sempre consegue calcular.
const MIN_DESCONTO_PCT   = Number(process.env.MIN_DESCONTO_PCT   || 25);
const MIN_NOTA           = Number(process.env.MIN_NOTA           || 4.6);
const MIN_VENDAS         = Number(process.env.MIN_VENDAS         || 100);
const EXIGIR_FRETE_GRATIS = String(process.env.EXIGIR_FRETE_GRATIS || 'false') === 'true';

// Mesmo regex usado dentro do navegador (idDoAnuncio), mas em Node — usado
// pra gerar um ID ESTÁVEL por produto. Sem isso, cada varredura de 15 em 15
// min gerava um ID novo aleatório pro mesmo produto, e o link que o usuário
// colou na tela ficava órfão (parecia ter "sumido" na próxima varredura).
function idAnuncioDoLink(link) {
  if (!link) return null;
  const m = link.match(/(MLBU?-?\d{6,})/i);
  return m ? m[1].replace('-', '').toUpperCase() : null;
}

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

          // Extrai o ID real do anúncio do link (ex: MLBU4052258844) — é o
          // jeito confiável de saber se é o MESMO produto, mesmo que ele
          // apareça em mais de um carrossel/seção da página.
          function idDoAnuncio(href) {
            if (!href) return null;
            const m = href.match(/(MLBU?-?\d{6,})/i);
            return m ? m[1].replace('-', '').toUpperCase() : null;
          }

          // Extração BEST-EFFORT de sinais de qualidade. A página de
          // "ofertas" (diferente da busca normal) às vezes não mostra
          // nota/vendas por card — por isso aqui é tolerante: se não achar,
          // devolve null em vez de inventar um número.
          function extrairSinaisQualidade(card) {
            const texto = card.innerText || '';

            // Nota: procura primeiro em elemento com classe de rating,
            // senão tenta um padrão "4,8" perto de estrelas/avaliações
            let nota = null;
            const notaEl = card.querySelector('[class*="rating"],[class*="review"]');
            const notaTexto = notaEl?.innerText || texto;
            const mNota = notaTexto.match(/([0-5][.,]\d)\b/);
            if (mNota) nota = parseFloat(mNota[1].replace(',', '.'));

            // Vendas: padrão tipo "500 vendidos" ou "+500 vendidos"
            let vendas = null;
            const mVendas = texto.match(/\+?\s*(\d[\d.]*)\s*vendid/i);
            if (mVendas) vendas = parseInt(mVendas[1].replace(/\./g, ''), 10);

            const freteGratis = /frete gr[áa]tis/i.test(texto);
            const vendedorLider = /mercado\s*l[íi]der|l[íi]der\b/i.test(texto);
            // Preço "no Pix" — o ML às vezes mostra um valor menor que só
            // vale pagando no Pix. Precisa avisar isso ANTES da pessoa
            // clicar, senão ela acha que é o preço normal (cartão/boleto).
            const pixOnly = /\bpix\b/i.test(texto);

            return { nota, vendas, freteGratis, vendedorLider, pixOnly };
          }

          const brutos = cards.map((card, i) => {
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

            // Link: prioriza o link que ENVOLVE a imagem do produto (é
            // quase sempre o link certo, o card inteiro costuma ser
            // clicável através da própria foto). Só cai pro "primeiro link
            // que achar em qualquer lugar do card" se isso falhar — esse
            // fallback é mais impreciso, porque em containers muito largos
            // (a estratégia genérica às vezes sobe demais) pode pegar um
            // link de outro produto vizinho ou de um banner, e o produto
            // "parece expirado" quando na real o link nunca foi o certo.
            const imgEl = card.querySelector('img');
            const linkViaImagem = imgEl?.closest('a[href*="mercadolivre"],a[href*="mercadolibre"]');
            const link = linkViaImagem?.href
              || card.querySelector('a[href*="mercadolivre"],a[href*="mercadolibre"]')?.href
              || '';

            const sinais = extrairSinaisQualidade(card);

            console.log(`[${i}] "${nome.slice(0,35)}" atual="${precoAtual}" orig="${precoOrig}" nota=${sinais.nota} vendas=${sinais.vendas} frete=${sinais.freteGratis} lider=${sinais.vendedorLider} pix=${sinais.pixOnly}`);
            return { nome, precoAtual, precoOrig, img, link, ...sinais };
          });

          // Dedup por ID do anúncio (fallback: nome+preço, se não achar ID)
          const vistos = new Set();
          const unicos = [];
          for (const p of brutos) {
            const chave = idDoAnuncio(p.link) || `${p.nome.toLowerCase()}|${p.precoAtual}`;
            if (vistos.has(chave)) continue;
            vistos.add(chave);
            unicos.push(p);
          }

          return unicos.slice(0, 15);
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

    // Quantos vieram com cada sinal de qualidade preenchido — se der 0 aqui
    // sempre, é sinal de que essa página não expõe esse dado por card, e o
    // filtro correspondente não vai conseguir fazer nada (fica sempre "sem
    // dado, deixa passar").
    const comNota   = produtos.filter(p => p.nota !== null).length;
    const comVendas = produtos.filter(p => p.vendas !== null).length;
    console.log(`[Caçador] ML: sinais de qualidade disponíveis — nota em ${comNota}/${produtos.length}, vendas em ${comVendas}/${produtos.length}.`);

    // Processa e filtra
    const resultado = await Promise.all(
      produtos
        .filter(p => {
          const atual = limparPreco(p.precoAtual);
          const orig  = limparPreco(p.precoOrig);
          const ok = p.nome && p.nome.length > 3 && p.link && atual > 0
            && p.nome.toLowerCase() !== 'economiza frete'
            && (orig === 0 || orig > atual); // preço original sempre maior
          if (!ok) return false;

          const desc = orig > 0 ? Math.round((orig - atual) / orig * 100) : 0;
          if (desc < MIN_DESCONTO_PCT) return false;
          if (p.nota !== null && p.nota < MIN_NOTA) return false;
          if (p.vendas !== null && p.vendas < MIN_VENDAS) return false;
          if (EXIGIR_FRETE_GRATIS && !p.freteGratis) return false;
          return true;
        })
        .map(async p => {
          const atual  = limparPreco(p.precoAtual);
          const orig   = limparPreco(p.precoOrig);
          // Anúncio patrocinado costuma vir como link de REDIRECIONAMENTO
          // (ex: click1.mercadolivre.com.br/...), onde a query string é a
          // instrução de pra onde ir — cortar ela manda pra home do ML. Só
          // corta quando o link já aponta direto pro produto (tem o código
          // MLB reconhecível no caminho).
          const idDoLinkOriginal = idAnuncioDoLink(p.link);
          const link = idDoLinkOriginal ? p.link.split('?')[0] : p.link;
          const desc   = orig > 0 ? Math.round((orig - atual) / orig * 100) : 0;
          const selos  = [
            p.nota ? `nota ${p.nota}` : null,
            p.vendas ? `${p.vendas} vendidos` : null,
            p.freteGratis ? 'frete grátis' : null,
            p.vendedorLider ? 'líder' : null,
            p.pixOnly ? 'preço no Pix' : null,
          ].filter(Boolean).join(', ');
          console.log(`[Caçador] ML ✓ "${p.nome.slice(0,40)}" R$${atual}${desc > 0 ? ` (${desc}% OFF)` : ''}${selos ? ` [${selos}]` : ''}${!idDoLinkOriginal ? ' [link patrocinado/redirect]' : ''}`);
          // ID estável: baseado no código real do anúncio, não em número
          // aleatório — assim ele não muda a cada varredura de 15 min, e o
          // link que o usuário colou continua valendo pro mesmo produto.
          const idEstavel = idDoLinkOriginal;
          const classe = classificarProduto(p.nome);
          return {
            id: idEstavel ? `ml-${idEstavel}` : uid('ml'),
            produto: p.nome, loja: 'Mercado Livre', categoria: classe.categoria,
            precoAntigo: orig, precoAtual: atual, comissaoPct: classe.comissaoPct, cupom: null, relampago: false,
            nota: p.nota, vendas: p.vendas, freteGratis: p.freteGratis, vendedorLider: p.vendedorLider,
            pixOnly: !!p.pixOnly,
            link, // link cru — o de afiliado é montado depois, por usuário
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

// ─── Shopee ──────────────────────────────────────────────────────────────────
// Diferente do ML, a Shopee renderiza tudo via React com classes hash
// aleatórias — ler o HTML final é muito frágil. O jeito estável é deixar o
// navegador carregar a página de verdade e ESCUTAR as respostas JSON que a
// própria Shopee busca por trás dos panos (api/v4/...), que é de onde os
// dados realmente vêm. Preço da Shopee vem como inteiro *100000 (ex:
// 4990000 = R$49,90).
function extrairItensDoJson(obj, out = [], vistos = new Set()) {
  if (!obj || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) {
    for (const el of obj) extrairItensDoJson(el, out, vistos);
    return out;
  }
  // Um "item" da Shopee sempre tem itemid + shopid juntos, em algum nível.
  if (obj.itemid && obj.shopid && !vistos.has(obj.itemid)) {
    vistos.add(obj.itemid);
    out.push(obj);
  }
  for (const k in obj) {
    if (obj[k] && typeof obj[k] === 'object') extrairItensDoJson(obj[k], out, vistos);
  }
  return out;
}

function precoShopee(v) {
  // Shopee manda o preço com 5 casas decimais embutidas (ex: 4990000 -> 49.90)
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  if (!n) return 0;
  return Math.round((n / 100000) * 100) / 100;
}

async function buscarShopee() {
  console.log('[Caçador] Shopee: iniciando Puppeteer mobile...');
  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();
  await page.setUserAgent(UA_MOBILE);
  await page.setViewport({ width: 390, height: 844, isMobile: true });

  const capturados = [];
  page.on('response', async (res) => {
    try {
      const url = res.url();
      if (!url.includes('/api/v4/')) return;
      const tipo = res.headers()['content-type'] || '';
      if (!tipo.includes('application/json')) return;
      const json = await res.json().catch(() => null);
      if (json) capturados.push({ url, json });
    } catch (e) { /* resposta não-JSON ou já consumida — ignora */ }
  });

  const urls = [
    'https://shopee.com.br/flash_sale',
    'https://shopee.com.br/daily_discover',
    'https://shopee.com.br/',
  ];

  try {
    let carregou = false;
    for (const url of urls) {
      try {
        console.log(`[Caçador] Shopee tentando: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await delay(3000);
        // rola a página — várias seções da Shopee só disparam a chamada
        // JSON quando o carrossel entra na tela
        await page.evaluate(async () => {
          for (let i = 0; i < 6; i++) {
            window.scrollBy(0, window.innerHeight);
            await new Promise(r => setTimeout(r, 600));
          }
        });
        await delay(2000);
        if (capturados.length > 0) { carregou = true; break; }
      } catch (e) {
        console.warn(`[Caçador] Shopee "${url}" falhou: ${e.message}`);
      }
    }

    if (!carregou) {
      console.warn('[Caçador] Shopee: nenhuma resposta JSON capturada em nenhuma URL — provável bloqueio anti-bot.');
      return [];
    }

    console.log(`[Caçador] Shopee: ${capturados.length} resposta(s) JSON interceptada(s), extraindo itens...`);
    const itensBrutos = [];
    const vistos = new Set();
    for (const json of capturados) extrairItensDoJson(json, itensBrutos, vistos);

    console.log(`[Caçador] Shopee: ${itensBrutos.length} item(ns) único(s) encontrado(s) nos JSONs.`);

    const produtos = itensBrutos.map(it => {
      const nome = it.name || it.item_name || '';
      // O preço/preço-antes-do-desconto aparece em nomes de campo diferentes
      // dependendo de qual endpoint respondeu — tenta os mais comuns.
      const precoRaw =
        it.price ?? it.item_card_display_price?.price ?? it.price_min ?? it.item_data?.price ?? null;
      const precoOrigRaw =
        it.price_before_discount ?? it.item_card_display_price?.price_before_discount ??
        it.price_max_before_discount ?? it.item_data?.price_before_discount ?? null;

      const atual = precoShopee(precoRaw);
      const orig  = precoShopee(precoOrigRaw) > atual ? precoShopee(precoOrigRaw) : 0;

      const imgKey = it.image || it.item_card_display_asset?.image || '';
      const imagemUrl = imgKey ? `https://down-br.img.susercontent.com/file/${imgKey}` : null;

      const link = `https://shopee.com.br/product/${it.shopid}/${it.itemid}`;

      return { nome, atual, orig, imagemUrl, link, itemid: it.itemid };
    }).filter(p => p.nome && p.atual > 0);

    const resultado = produtos.slice(0, 15).map(p => {
      const desc = p.orig > 0 ? Math.round((p.orig - p.atual) / p.orig * 100) : 0;
      console.log(`[Caçador] Shopee ✓ "${p.nome.slice(0, 40)}" R$${p.atual}${desc > 0 ? ` (${desc}% OFF)` : ''}`);
      const classe = classificarProduto(p.nome);
      const comissaoPct = COMISSAO_SHOPEE_POR_CATEGORIA[classe.categoria] ?? 8;
      return {
        id: `shopee-${p.itemid}`, produto: p.nome, loja: 'Shopee', categoria: classe.categoria,
        precoAntigo: p.orig, precoAtual: p.atual, comissaoPct, cupom: null, relampago: false,
        link, // link cru — o de afiliado é montado depois, por usuário
        imagemUrl: p.imagemUrl,
        encontradoEm: new Date().toISOString(),
      };
    });

    return resultado;
  } catch (e) {
    console.error('[Caçador] Shopee falhou:', e.message);
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
  console.log(`[Caçador] Total ML: ${ml.length} oferta(s).`);

  const shopee = await buscarShopee().catch(e => {
    console.error('[Shopee erro fatal]', e.message);
    return [];
  });
  console.log(`[Caçador] Total Shopee: ${shopee.length} oferta(s).`);

  return [...ml, ...shopee];
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
