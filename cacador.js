const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const randomUserAgent = require('random-useragent');
const cron = require('node-cron');

puppeteer.use(StealthPlugin());

// Configurações de lançamento otimizadas para stealth
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
'--lang=pt-BR',
],
ignoreHTTPSErrors: true,
};

let ultimasOfertas = [];
let ultimaExecucao = null;

// ─── UTILS ──────────────────────────────────────────────────────────────────

function limparPreco(texto) {
if (!texto) return 0;
// Normaliza formato brasileiro (1.234,56) e americano (1,234.56)
let cleaned = texto.replace(/\s/g, '').replace(/[^\d.,-]/g, '');
if (cleaned.includes(',')) {
if (cleaned.indexOf(',') > cleaned.indexOf('.')) {
// Formato BR: 1.234,56 -> 1234.56
cleaned = cleaned.replace(/\./g, '').replace(',', '.');
} else {
// Formato US: 1,234.56 -> 1234.56
cleaned = cleaned.replace(/,/g, '');
}
}
const num = parseFloat(cleaned);
return isNaN(num)? 0: num;
}

function uid(p) { return `${p}-${Date.now()}-${Math.random().toString(36).substr(2,9)}`; }

function delay(ms) { return new Promise(r => setTimeout(r, ms + Math.random() * 500)); }

// Gerenciamento de Proxies (Simulação para estrutura, ideal usar env var)
function getRandomProxy() {
const proxyStr = process.env.PROXY_LIST;
if (!proxyStr) return null;

try {
const proxies = JSON.parse(proxyStr);
if (!Array.isArray(proxies) || proxies.length === 0) return null;
return proxies[Math.floor(Math.random() * proxies.length)];
} catch (e) {
console.warn(' Erro ao parsear PROXY_LIST:', e.message);
return null;
}
}

async function novaPagina(browser) {
const page = await browser.newPage();

// Configuração de Proxy
const proxy = getRandomProxy();
if (proxy) {
// Formato esperado no env: { host: "ip:port", user: "user", pass: "pass" }
await page.authenticate({
username: proxy.user,
password: proxy.pass,
});
// Nota: Puppeteer nativo usa --proxy-server no launch, aqui usamos authenticate se suportado pelo provider
// Para proxies HTTP(S) que requerem auth, o authenticate funciona.
}

const ua = randomUserAgent.getRandom(u => u.browserName === 'Chrome' && parseFloat(u.browserVersion) >= 110)
|| 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

await page.setUserAgent(ua);
await page.setExtraHTTPHeaders({
'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="126"',
'sec-ch-ua-mobile': '?0',
'sec-ch-ua-platform': '"Windows"',
});

await page.setViewport({ width: 1366, height: 768 });

// Bloqueio de recursos pesados para velocidade e redução de fingerprint
await page.setRequestInterception(true);
page.on('request', (req) => {
const resourceTypes = ['image', 'stylesheet', 'font', 'media', 'websocket'];
if (resourceTypes.includes(req.resourceType())) {
req.abort();
} else {
req.continue();
}
});

// Evasão de detecção via JS
await page.evaluateOnNewDocument(() => {
Object.defineProperty(navigator, 'webdriver', { get: () => false });
Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });
window.chrome = { runtime: {} };
// Remove propriedades de automação
Object.defineProperty(window, 'navigator', {
value: new Proxy(window.navigator, {
get: (target, key) => {
if (key === 'webdriver') return false;
return target[key];
}
})
});
});

return page;
}

// ─── SHOPEE ──────────────────────────────────────────────────────────────────

async function buscarShopee(browser, retries = 0) {
console.log(` Shopee: iniciando (Tentativa ${retries + 1})...`);
const page = await novaPagina(browser);
try {
// Tenta API primeiro (mais rápido e limpo)
// Atualizado para v5 e parâmetros comuns de 2026
const keyword = 'eletronicos';
const apiUrl = `https://shopee.com.br/api/v5/search/search_items?by=relevancy&keyword=${keyword}&limit=10&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=5`;

let resp;
try {
resp = await page.evaluate(async (url) => {
try {
const r = await fetch(url, {
method: 'GET',
credentials: 'include',
headers: {
'X-Requested-With': 'XMLHttpRequest',
'if-none-match-': '' // Força cache miss
}
});
return { status: r.status, body: await r.text() };
} catch(e) { return { status: 0, body: '' }; }
}, apiUrl);
} catch (e) {
resp = { status: 0, body: '' };
}

console.log(` Shopee API status: ${resp.status}`);

let items = [];
// Se der 403 ou erro, tenta HTML fallback imediatamente ou retry
if (resp.status === 403 || resp.status === 0) {
console.warn(' Shopee API bloqueada/erro. Fallback para HTML...');
await page.close();
// Recursão controlada para retry com novo proxy (se configurado)
if (retries < 2) {
return await buscarShopee(browser, retries + 1);
}
// Se falhar API, vai direto pro HTML abaixo
} else if (resp.status === 200) {
try {
const json = JSON.parse(resp.body);
items = json?.items || json?.data?.items || [];
} catch (e) {
console.error(' Erro parse JSON Shopee:', e.message);
}
}

if (items.length > 0) {
console.log(` Shopee API: ${items.length} itens`);
const resultados = items.slice(0, 6).map(item => {
const info = item.item_basic || item;
const price = info.price || 0;
const priceBefore = info.price_before_discount || 0;

return {
id: uid('shopee'),
produto: (info.name || '').trim(),
loja: 'Shopee',
categoria: 'Eletrônicos',
precoAntigo: Math.round((priceBefore / 100000) * 100) / 100,
precoAtual: Math.round((price / 100000) * 100) / 100,
comissaoPct: 10,
cupom: null,
relampago:!!(info.flash_sale),
link: info.shopid && info.itemid? `https://shopee.com.br/product/${info.shopid}/${info.itemid}`: '',
imagemUrl: info.image? `https://cf.shopee.com.br/file/${info.image}`: null,
encontradoEm: new Date().toISOString(),
};
}).filter(o => o.produto && o.precoAtual > 0);

if (resultados.length > 0) return resultados;
}

// Fallback HTML
console.log(' Shopee: executando fallback HTML...');
await page.goto('https://shopee.com.br/busca?keyword=eletronicos', { waitUntil: 'networkidle2', timeout: 25000 });
await delay(3000);
await page.evaluate(() => window.scrollTo({ top: 1000, behavior: 'instant' }));
await delay(2000);

const prods = await page.evaluate(() => {
const els = Array.from(document.querySelectorAll('[data-sqe="item"]'));
return els.slice(0, 8).map(el => {
const nameEl = el.querySelector('[data-sqe="name"]');
const priceEl = el.querySelector('[class*="price"]'); // Seletor genérico de preço
const imgEl = el.querySelector('img');
const linkEl = el.querySelector('a[href*="/product/"]');

let precoTexto = '';
if (priceEl) {
// Tenta pegar o texto puro, removendo span de centavos se necessário
precoTexto = priceEl.innerText.trim();
}

return {
nome: nameEl? nameEl.innerText.trim(): '',
preco: precoTexto,
img: imgEl? imgEl.src: '',
link: linkEl? linkEl.href: '',
};
});
});

console.log(` Shopee HTML: ${prods.length} encontrados.`);

return prods.filter(p => p.nome && p.link).map(p => ({
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
imagemUrl: p.img || null,
encontradoEm: new Date().toISOString(),
})).filter(o => o.precoAtual > 0);

} catch(e) {
console.error(' Shopee falhou:', e.message);
return [];
} finally {
await page.close();
}
}

// // ─── MERCADO LIVRE ───────────────────────────────────────────────────────────
async function buscarMercadoLivre(browser) {
console.log(' ML: iniciando...');
const page = await novaPagina(browser);
try {
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
console.log(` ML título: "${title}" url: ${url}`);

produtos = await page.evaluate(() => {
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
const nome = (
card.querySelector('p.promotion-item__title')?.innerText ||
card.querySelector('h2.ui-search-item__title')?.innerText ||
card.querySelector('.poly-component__title')?.innerText ||
card.querySelector('h2, h3, [class*="title"]')?.innerText ||
''
).trim();

const fracEl = card.querySelector('.andes-money-amount__fraction');
const centsEl = card.querySelector('.andes-money-amount__cents');

const frac = fracEl? (fracEl.firstChild?.textContent || fracEl.innerText || '').trim().replace(/\D/g,''): '0';
const cents = centsEl? (centsEl.firstChild?.textContent || centsEl.innerText || '').trim().replace(/\D/g,''): '00';
const precoAtual = cents!== '00'? `${frac},${cents}`: frac;

const img = card.querySelector('img')?.src || card.querySelector('img')?.dataset?.src || '';
const link = card.querySelector('a[href*="mercadolivre"], a[href*="mercadolibre"]')?.href || '';

return { nome, precoAtual, img, link };
});
});

console.log(` ML: ${produtos.length} produto(s).`);
produtos.forEach((p,i) => console.log(` [${i}] nome="${p.nome.slice(0,40)}" preço="${p.precoAtual}"`));

if (produtos.filter(p => p.nome && p.link).length > 0) break;
console.log(' ML: nenhum produto válido, tentando próxima URL...');
}

return produtos.filter(p => p.nome && p.link).map(p => ({
id: uid('ml'), produto: p.nome, loja: 'Mercado Livre', categoria: 'Eletrônicos',
precoAntigo: 0,
precoAtual: limparPreco(p.precoAtual),
comissaoPct: 8, cupom: null, relampago: false,
link: p.link.split('?'),<span class="citation-group citation-pending"><span class="citation-pill">0</span></span> imagemUrl: p.img || null,
encontradoEm: new Date().toISOString(),
})).filter(o => o.precoAtual > 0);
} catch(e) {
console.error(' ML falhou:', e.message);
return [];
} finally { await page.close(); }
}

// ─── AMAZON ──────────────────────────────────────────────────────────────────
async function buscarAmazon(browser) {
console.log(' Amazon: iniciando...');
const page = await novaPagina(browser);
try {
await page.setExtraHTTPHeaders({
'Accept-Language': 'pt-BR,pt;q=0.9',
'sec-ch-ua': '"Not_A_Brand";v="8", "Chromium";v="126"',
});

await page.goto('https://www.amazon.com.br/s?k=eletronicos&s=price-desc-rank', {
waitUntil: 'networkidle2', timeout: 30000
});

await delay(4000 + Math.random() * 3000);

const produtos = await page.evaluate(() => {
const cards = Array.from(document.querySelectorAll('[data-component-type="s-search-result"]'));
return cards.slice(0,12).map(card => {
// Nome: pega o span mais longo dentro do h2 (ignora badges curtos)
const h2 = card.querySelector('h2');
const spans = h2? Array.from(h2.querySelectorAll('span')): [];
const nome = spans
.map(s => s.textContent?.trim() || '')
.filter(t => t.length > 5 &&!t.match(/^(Escolha|Mais vendido|Patrocinado|Resultados|Garantia)/i))
.sort((a,b) => b.length - a.length)<span class="citation-group citation-pending"><span class="citation-pill">0</span></span> || '';

// Preço: separa whole e fraction para maior precisão
const whole = card.querySelector('.a-price-whole')?.innerText?.trim().replace(/[^0-9]/g, '') || '0';
const fraction = card.querySelector('.a-price-fraction')?.innerText?.trim() || '00';
const preco = `${whole},${fraction}`;

const img = card.querySelector('img.s-image')?.src || '';
const link = card.querySelector('h2 a[href]')?.getAttribute('href') || '';

return { nome, preco, img, link: link? 'https://www.amazon.com.br' + link: '' };
});
});

console.log(` Amazon: ${produtos.length} extraídos.`);
produtos.forEach((p,i) => console.log(` [${i}] nome="${p.nome.slice(0,50)}" preço="${p.preco}"`));

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
console.error(' Amazon falhou:', e.message);
return [];
} finally { await page.close(); }
}

// ─── PRINCIPAL ───────────────────────────────────────────────────────────────
async function buscarOfertas() {
let browser;
try {
browser = await puppeteer.launch(launchOptions);
console.log(' Navegador iniciado.');

// Lógica de Retry para Shopee
let shopee = [];
let retries = 0;
const maxRetries = 3;

while (retries < maxRetries && shopee.length === 0) {
shopee = await buscarShopee(browser, retries);
if (shopee.length === 0 && retries < maxRetries - 1) {
retries++;
console.log(` Shopee vazio, retry ${retries}...`);
await delay(5000);
}
}

const ml = await buscarMercadoLivre(browser);
const amazon = await buscarAmazon(browser);

console.log(` Shopee: ${shopee.length} | ML: ${ml.length} | Amazon: ${amazon.length}`);
return [...shopee,...ml,...amazon];
} finally {
if (browser) await browser.close();
}
}

async function executarVarredura() {
try {
const ofertas = await buscarOfertas();
ultimasOfertas = ofertas; ultimaExecucao = new Date().toISOString();
console.log(` Concluído — ${ofertas.length} oferta(s).`);
} catch(e) { console.error(' Erro:', e.message); }
}

function iniciarCacador({ intervaloCron = '*/15 * * * ' } = {}) {
executarVarredura();
cron.schedule(intervaloCron, executarVarredura);
}
function getUltimasOfertas() { return { ofertas: ultimasOfertas, ultimaExecucao }; }
module.exports = { iniciarCacador, getUltimasOfertas, buscarOfertas };
