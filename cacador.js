const puppeteer = require('puppeteer-extra');
const randomUserAgent = require('random-useragent');
const cron = require("node-cron");

const launchOptions = {
headless: "new",
args: [
'--no-sandbox',
'--disable-setuid-sandbox',
'--disable-dev-shm-usage',
'--disable-accelerated-2d-canvas',
'--no-first-run',
'--no-zygote',
'--single-process',
'--disable-gpu',
'--disable-web-security'
],
ignoreHTTPSErrors: true
};

let ultimasOfertas = [];
let ultimaExecucao = null;

const limparPreco = (texto) => {
if (!texto) return 0;
let limpo = texto.replace('R, '').replace(/\s/g, '').replace('.', '').replace(',', '.');
return parseFloat(limpo) || 0;
};

async function buscarOfertas(plataforma = 'shopee') {
let browser;
try {
console.log(` Iniciando coleta na ${plataforma}...`);
browser = await puppeteer.launch(launchOptions);
const page = await browser.newPage();

const ua = randomUserAgent.getRandom();
await page.setUserAgent(ua);
await page.setViewport({ width: 1366, height: 768 });

let ofertasColetadas = [];

if (plataforma === 'shopee') {
await page.goto('https://shopee.com.br/busca?keyword=eletronicos', { waitUntil: 'networkidle2' });
await page.evaluate(() => window.scrollBy(0, 500));
await new Promise(r => setTimeout(r, 3000));

const produtos = await page.evaluate(() => {
const items = Array.from(document.querySelectorAll('div._1UcHxe, div._4S4sJt, div._93LF16'));
return items.slice(0, 5).map(item => {
const nomeEl = item.querySelector('div._2J3kUS, span._3l3p9h, div._6lW1wL');
const precoEl = item.querySelector('div.1_WHN1, div._1oR3b, span._29Xj9K');
const imgEl = item.querySelector('img');
const linkEl = item.querySelector('a');

return {
nome: nomeEl? nomeEl.innerText: 'Produto Sem Nome',
preco: precoEl? precoEl.innerText: '0',
imagem: imgEl? imgEl.src: '',
link: linkEl? linkEl.href: ''
};
});
});

ofertasColetadas = produtos.map(p => ({
id: shopee-${Date.now()}-${Math.random().toString(36).substr(2, 9)},
produto: p.nome,
loja: "Shopee",
categoria: "Eletrônicos",
precoAntigo: 0,
precoAtual: limparPreco(p.preco),
comissaoPct: 10,
cupom: null,
relampago: false,
link: p.link,
imagemUrl: p.imagem,
encontradoEm: new Date().toISOString(),
}));

} else if (plataforma === 'mercadolivre') {
await page.goto('https://lista.mercadolivre.com.br/eletronicos', { waitUntil: 'networkidle2' });

const produtos = await page.evaluate(() => {
const items = Array.from(document.querySelectorAll('li.ui-search-layout__item'));
return items.slice(0, 5).map(item => {
const nomeEl = item.querySelector('h2.ui-search-item__title');
const precoEl = item.querySelector('.andes-money-amount__fraction');
const imgEl = item.querySelector('img.ui-search-result-image__element');
const linkEl = item.querySelector('a.ui-search-item__link');

return {
nome: nomeEl? nomeEl.innerText: 'Produto Sem Nome',
preco: precoEl? precoEl.innerText: '0',
imagem: imgEl? imgEl.src: '',
link: linkEl? linkEl.href: ''
};
});
});

ofertasColetadas = produtos.map(p => ({
id: ml-${Date.now()}-${Math.random().toString(36).substr(2, 9)},
produto: p.nome,
loja: "Mercado Livre",
categoria: "Eletrônicos",
precoAntigo: 0,
precoAtual: limparPreco(p.preco),
comissaoPct: 8,
cupom: null,
relampago: false,
link: p.link,
imagemUrl: p.imagem,
encontradoEm: new Date().toISOString(),
}));

} else if (plataforma === 'amazon') {
await page.goto('https://www.amazon.com.br/s?k=eletronicos', { waitUntil: 'networkidle2' });

const produtos = await page.evaluate(() => {
const items = Array.from(document.querySelectorAll('div[data-component-type="s-search-result"]'));
return items.slice(0, 5).map(item => {
const nomeEl = item.querySelector('h2 a span');
const precoEl = item.querySelector('.a-price.a-offscreen');
const imgEl = item.querySelector('img.s-image');
const linkEl = item.querySelector('h2 a');

return {
nome: nomeEl? nomeEl.innerText: 'Produto Sem Nome',
preco: precoEl? precoEl.innerText: '0',
imagem: imgEl? imgEl.src: '',
link: linkEl? linkEl.href: ''
};
});
});

ofertasColetadas = produtos.map(p => ({
id: amz-${Date.now()}-${Math.random().toString(36).substr(2, 9)},
produto: p.nome,
loja: "Amazon",
categoria: "Eletrônicos",
precoAntigo: 0,
precoAtual: limparPreco(p.preco),
comissaoPct: 12,
cupom: null,
relampago: false,
link: p.link,
imagemUrl: p.imagem,
encontradoEm: new Date().toISOString(),
}));
}

return ofertasColetadas;

} catch (error) {
console.error(` Erro na ${plataforma}:`, error.message);
return [];
} finally {
if (browser) await browser.close();
}
}

async function executarVarredura() {
try {
const ofertasShopee = await buscarOfertas('shopee');
const ofertasML = await buscarOfertas('mercadolivre');
const ofertasAmazon = await buscarOfertas('amazon');

const todasOfertas = [...ofertasShopee,...ofertasML,...ofertasAmazon];

ultimasOfertas = todasOfertas;
ultimaExecucao = new Date().toISOString();
console.log(` Varredura finalizada. Total: ${todasOfertas.length} ofertas.`);
} catch (e) {
console.error(" Erro geral na varredura:", e.message);
}
}

function iniciarCacador({ intervaloCron = "0 * * * *" } = {}) {
executarVarredura();
cron.schedule(intervaloCron, executarVarredura);
console.log(` Agendado para rodar a cada hora.`);
}

function getUltimasOfertas() {
return { ofertas: ultimasOfertas, ultimaExecucao };
}

module.exports = { iniciarCacador, getUltimasOfertas, buscarOfertas };
