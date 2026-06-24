// buscarOfertas.js
// Chamado pelo GitHub Actions a cada 15 minutos.

require('dotenv').config();
const { getFirestoreAdmin }  = require('./firebaseAdmin');
const { buscarOfertas }      = require('./cacador');
const { gerarLinkAfiliado }  = require('./afiliado');
const { gerarCopy }          = require('./copywriter');

const MIN_COMISSAO_PCT = Number(process.env.MIN_COMISSAO_PCT || 5);

async function carregarAfiliado(db) {
  const ownerUid = process.env.OWNER_UID;
  if (!ownerUid) { console.warn('[Bot] OWNER_UID não definido.'); return {}; }
  const snap = await db.collection('config_afiliado').doc(ownerUid).get();
  return snap.exists ? snap.data() : {};
}

function calcularDesconto(antigo, atual) {
  if (!antigo || antigo <= 0) return 0;
  return Math.round(((antigo - atual) / antigo) * 100);
}

async function run() {
  const db       = getFirestoreAdmin();
  const afiliado = await carregarAfiliado(db);

  console.log('[Bot] Iniciando varredura...');
  const brutas = await buscarOfertas();
  console.log(`[Bot] ${brutas.length} oferta(s) brutas.`);

  if (brutas.length === 0) {
    console.log('[Bot] Nenhuma oferta encontrada — encerrando.');
    await db.collection('logs').add({
      tipo: 'cacador', ofertasEncontradas: 0, ofertasAprovadas: 0,
      executadoEm: new Date().toISOString(),
    });
    return;
  }

  const aprovadas = [];
  for (const oferta of brutas) {
    // Aceita qualquer oferta com comissão mínima e preço > 0
    if (oferta.precoAtual <= 0) { console.log(`[Bot] Ignorando sem preço: ${oferta.produto}`); continue; }
    if (oferta.comissaoPct < MIN_COMISSAO_PCT) { console.log(`[Bot] Comissão baixa: ${oferta.produto}`); continue; }
    if (!oferta.produto || oferta.produto === 'Produto') { console.log(`[Bot] Sem nome: pulando`); continue; }

    let copy = null;
    try { copy = await gerarCopy({ produto: oferta.produto, precoAntigo: oferta.precoAntigo, precoAtual: oferta.precoAtual, cupom: oferta.cupom, loja: oferta.loja }); }
    catch (e) { console.warn(`[Bot] Copy falhou: ${e.message}`); }

    aprovadas.push({
      ...oferta,
      descontoPct: calcularDesconto(oferta.precoAntigo, oferta.precoAtual),
      linkAfiliado: gerarLinkAfiliado(oferta.loja, oferta.link, afiliado),
      copy,
      encontradoEm: new Date().toISOString(),
    });
    console.log(`[Bot] ✓ ${oferta.produto} (${oferta.loja}) — R$ ${oferta.precoAtual}`);
  }

  console.log(`[Bot] ${aprovadas.length} aprovada(s) para gravar.`);

  // Substitui coleção ofertas pelo lote atual
  const batch  = db.batch();
  const atuais = await db.collection('ofertas').get();
  atuais.forEach(d => batch.delete(d.ref));
  aprovadas.forEach(o => batch.set(db.collection('ofertas').doc(o.id), o));
  await batch.commit();

  await db.collection('logs').add({
    tipo: 'cacador', ofertasEncontradas: brutas.length,
    ofertasAprovadas: aprovadas.length, executadoEm: new Date().toISOString(),
  });

  console.log(`[Bot] Concluído — ${aprovadas.length}/${brutas.length} gravada(s).`);
}

run()
  .then(() => process.exit(0))
  .catch(err => { console.error('[Bot] Erro fatal:', err); process.exit(1); });
