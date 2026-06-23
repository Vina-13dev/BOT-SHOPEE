// scripts/buscarOfertas.js
// Ponto de entrada chamado pelo GitHub Actions a cada 15 minutos
// (.github/workflows/cacador.yml). Roda isolado, sem Express, sem Railway:
//
//   1) Lê o perfil de afiliado salvo no Firestore (config_afiliado/{OWNER_UID})
//   2) Busca ofertas nos três marketplaces via Puppeteer (lib/cacador.js)
//   3) Calcula desconto/comissão e filtra só as aprovadas
//   4) Gera link de afiliado para cada oferta
//   5) Gera copy de venda (Groq → Anthropic → fallback)
//   6) Grava no Firestore (coleção "ofertas") e registra log

require('dotenv').config();
const { getFirestoreAdmin }  = require('./firebaseAdmin');
const { buscarOfertas }      = require('./cacador');
const { calcularOferta }     = require('./classificador');
const { gerarLinkAfiliado }  = require('./afiliado');
const { gerarCopy }          = require('./copywriter');

const MIN_DESCONTO_PCT = Number(process.env.MIN_DESCONTO_PCT || 15);
const MIN_COMISSAO_PCT = Number(process.env.MIN_COMISSAO_PCT || 7);

async function carregarAfiliado(db) {
  const ownerUid = process.env.OWNER_UID;
  if (!ownerUid) {
    console.warn('[Bot Caçador] OWNER_UID não definido — ofertas serão salvas sem link de afiliado.');
    return {};
  }
  const snap = await db.collection('config_afiliado').doc(ownerUid).get();
  if (!snap.exists) {
    console.warn(`[Bot Caçador] Nenhum perfil em config_afiliado/${ownerUid} — salve primeiro no painel.`);
    return {};
  }
  return snap.data();
}

async function run() {
  const db       = getFirestoreAdmin();
  const afiliado = await carregarAfiliado(db);

  console.log('[Bot Caçador] Iniciando varredura nos marketplaces...');
  const brutas = await buscarOfertas();
  console.log(`[Bot Caçador] ${brutas.length} oferta(s) brutas coletadas.`);

  const aprovadas = [];

  for (const oferta of brutas) {
    // Ofertas sem precoAntigo não têm desconto calculável — aprovamos direto
    // se a comissão for boa o suficiente
    const calculo = calcularOferta({
      precoAntigo: oferta.precoAntigo || oferta.precoAtual,
      precoAtual:  oferta.precoAtual,
      comissaoPct: oferta.comissaoPct,
    });

    const descOk  = oferta.precoAntigo > 0
      ? calculo.descontoPct >= MIN_DESCONTO_PCT
      : true;   // sem histórico de preço, não filtra por desconto
    const comOk   = oferta.comissaoPct >= MIN_COMISSAO_PCT;

    if (!descOk || !comOk) continue;

    let copy = null;
    try {
      copy = await gerarCopy({
        produto:    oferta.produto,
        precoAntigo: oferta.precoAntigo,
        precoAtual:  oferta.precoAtual,
        cupom:       oferta.cupom,
        loja:        oferta.loja,
      });
    } catch (e) {
      console.warn(`[Bot Caçador] Copy falhou para "${oferta.produto}":`, e.message);
    }

    aprovadas.push({
      ...oferta,
      ...calculo,
      linkAfiliado: gerarLinkAfiliado(oferta.loja, oferta.link, afiliado),
      copy,
      encontradoEm: new Date().toISOString(),
    });
  }

  console.log(`[Bot Caçador] ${aprovadas.length} oferta(s) aprovada(s) para gravar no Firestore.`);

  // Substitui a coleção "ofertas" inteira pelo lote atual
  const batch  = db.batch();
  const atuais = await db.collection('ofertas').get();
  atuais.forEach(d => batch.delete(d.ref));
  aprovadas.forEach(oferta =>
    batch.set(db.collection('ofertas').doc(oferta.id), oferta)
  );
  await batch.commit();

  await db.collection('logs').add({
    tipo:               'cacador',
    ofertasEncontradas: brutas.length,
    ofertasAprovadas:   aprovadas.length,
    executadoEm:        new Date().toISOString(),
  });

  console.log(`[Bot Caçador] Concluído — ${aprovadas.length}/${brutas.length} gravada(s).`);
}

run()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[Bot Caçador] Erro fatal:', err);
    process.exit(1);
  });
