require('dotenv').config();
const { getFirestoreAdmin } = require('./firebaseAdmin');
const { buscarOfertas } = require('./cacador');
const { gerarLinkAfiliado } = require('./afiliado');
const { gerarCopy } = require('./copywriter');

const MIN_COMISSAO_PCT = Number(process.env.MIN_COMISSAO_PCT || 5);
const MIN_DESLIGAMENTO_MIN = Number(process.env.MIN_DESLIGAMENTO_MIN || 30); // Se nenhum produto novo em X minutos, desliga alerta

async function carregarAfiliado(db) {
const ownerUid = process.env.OWNER_UID;
if (!ownerUid) { console.warn(' OWNER_UID não definido.'); return {}; }
const snap = await db.collection('config_afiliado').doc(ownerUid).get();
return snap.exists? snap.data(): {};
}

function calcularDesconto(antigo, atual) {
if (!antigo || antigo <= 0) return 0;
return Math.round(((antigo - atual) / antigo) * 100);
}

function jaGravadoRecentemente(db, novosIds) {
// Verifica se algum produto já existe no Firestore recentemente
const cutoff = new Date();
cutoff.setMinutes(cutoff.getMinutes() - 60); // últimos 60 minutos

return db.collection('ofertas')
.where('encontradoEm', '>=', cutoff.toISOString())
.get()
.then(snap => {
const existentes = new Set();
snap.forEach(doc => {
const data = doc.data();
if (novosIds.includes(data.id)) {
existentes.add(data.id);
}
});
return existentes;
});
}

// Validação agressiva: só aprova produtos com preço > R$10 e comissão > MIN_COMISSAO_PCT
async function validarOferta(oferta, afiliado, db) {
if (oferta.precoAtual < 10) { console.log(` Rejeitado (preço < 10): ${oferta.produto}`); return false; }
if (oferta.comissaoPct < MIN_COMISSAO_PCT) { console.log(` Rejeitado (comissão < ${MIN_COMISSAO_PCT}%): ${oferta.produto}`); return false; }
if (!oferta.link ||!oferta.produto) { console.log(` Rejeitado (link/produto inválido)`); return false; }
if (oferta.link.includes('club') || oferta.link.includes('affiliate')) { console.log(` Rejeitado (já afiliado)`); return false; }

// Evita duplicação no Firestore
const snap = await db.collection('ofertas').doc(oferta.id).get();
if (snap.exists) {
console.log(` Rejeitado (duplicado ID ${oferta.id})`);
return false;
}

return true;
}

async function run() {
const db = getFirestoreAdmin();
const afiliado = await carregarAfiliado(db);

console.log(' Iniciando varredura...');
const brutas = await buscarOfertas();
console.log(` ${brutas.length} oferta(s) brutas.`);

if (brutas.length === 0) {
console.log(' Nenhuma oferta capturada — encerrando.');
await db.collection('logs').add({
tipo: 'cacador',
ofertasEncontradas: 0,
ofertasAprovadas: 0,
executadoEm: new Date().toISOString(),
alerta: 'sem_dados'
});
return;
}

// Validação agressiva
const aprovadas = [];
const novosIds = brutas.map(o => o.id);
const existentes = await jaGravadoRecentemente(db, novosIds);

for (const oferta of brutas) {
if (existentes.has(oferta.id)) {
console.log(` Pulando duplicado ID: ${oferta.id}`);
continue;
}

const valida = await validarOferta(oferta, afiliado, db);
if (!valida) continue;

let copy = null;
try {
copy = await gerarCopy({
produto: oferta.produto,
precoAntigo: oferta.precoAntigo,
precoAtual: oferta.precoAtual,
cupom: oferta.cupom,
loja: oferta.loja
});
} catch (e) {
console.warn(` Copy falhou: ${e.message}`);
copy = `🔔 Oferta relâmpago! ${oferta.loja} - ${oferta.produto} agora por R$ ${oferta.precoAtual} 🔔`;
}

const desconto = calcularDesconto(oferta.precoAntigo, oferta.precoAtual);

aprovadas.push({
...oferta,
descontoPct: desconto,
linkAfiliado: gerarLinkAfiliado(oferta.loja, oferta.link, afiliado),
copy,
encontradoEm: new Date().toISOString(),
});
console.log(` ✅ ${oferta.produto} (${oferta.loja}) — R${oferta.precoAtual} | ${desconto}% OFF`);
}

console.log(` ${aprovadas.length}/${brutas.length} aprovada(s) para gravar.`);
if (aprovadas.length === 0) {
console.log(' Nenhum novo produto validado — possível blacklist ou queda de tráfego.');
await db.collection('logs').add({
tipo: 'cacador',
ofertasEncontradas: brutas.length,
ofertasAprovadas: 0,
executadoEm: new Date().toISOString(),
alerta: 'vazios_validacao'
});
return;
}

// Substitui TUDO na coleção
const batch = db.batch();
const atuais = await db.collection('ofertas').get();
atuais.forEach(d => batch.delete(d.ref));

aprovadas.forEach(o => batch.set(db.collection('ofertas').doc(o.id), o));
await batch.commit();

await db.collection('logs').add({
tipo: 'cacador',
ofertasEncontradas: brutas.length,
ofertasAprovadas: aprovadas.length,
executadoEm: new Date().toISOString(),
novosIds: aprovadas.map(o => o.id),
totalOfertas: db.collection('ofertas').count()
});

console.log(` Concluído — ${aprovadas.length} produtos gravados (Firestore).`);
}

run()
.then(() => process.exit(0))
.catch(err => {
console.error(' Erro fatal:', err);
process.exit(1);
});
