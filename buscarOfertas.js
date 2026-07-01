// buscarOfertas.js — chamado pelo GitHub Actions a cada 15 minutos
//
// IMPORTANTE: este script varre as lojas UMA VEZ e grava as ofertas numa
// coleção compartilhada (`ofertas`), vista por todos os usuários do app.
// Por isso ele NÃO grava mais um link de afiliado fixo aqui — cada pessoa
// tem um ID de afiliado diferente. O `link` gravado é o link cru do
// produto; o link de afiliado de cada usuário é montado no navegador dele
// (index.html), usando o perfil salvo em config_afiliado/{uid} de quem
// está logado no momento. Veja lib/afiliado.js para a lógica compartilhada.
require('dotenv').config();
const { getFirestoreAdmin } = require('./firebaseAdmin');
const { buscarOfertas }     = require('./cacador');
const { gerarLinkAfiliado } = require('./afiliado');
const { gerarCopy }         = require('./copywriter');

const MIN_COMISSAO_PCT = Number(process.env.MIN_COMISSAO_PCT || 5);
const MIN_PRECO        = Number(process.env.MIN_PRECO || 5);

// Usado só como fallback de exibição para quem abre o app sem estar logado
// (visitante/demo). Quem está logado sempre vê o próprio link, gerado no
// navegador — isso aqui nunca sobrescreve o link de outro usuário.
async function carregarAfiliadoDono(db) {
  const ownerUid = process.env.OWNER_UID;
  if (!ownerUid) return {};
  const snap = await db.collection('config_afiliado').doc(ownerUid).get();
  return snap.exists ? snap.data() : {};
}

function calcularDesconto(antigo, atual) {
  if (!antigo || antigo <= 0 || !atual) return 0;
  return Math.round(((antigo - atual) / antigo) * 100);
}

async function run() {
  const db       = getFirestoreAdmin();
  const afiliadoDono = await carregarAfiliadoDono(db); // só fallback pra visitante não logado

  console.log(' Iniciando varredura...');
  const brutas = await buscarOfertas();
  console.log(`[Bot] ${brutas.length} oferta(s) brutas coletadas.`);

  const aprovadas = [];

  for (const oferta of brutas) {
    if (!oferta.produto || oferta.produto.length < 3) continue;
    if (!oferta.precoAtual || oferta.precoAtual < MIN_PRECO) continue;
    if (oferta.comissaoPct < MIN_COMISSAO_PCT) continue;

    let copy = null;
    try {
      copy = await gerarCopy({
        produto:     oferta.produto,
        precoAntigo: oferta.precoAntigo,
        precoAtual:  oferta.precoAtual,
        cupom:       oferta.cupom,
        loja:        oferta.loja,
      });
    } catch (e) {
      console.warn(`[Bot] Copy falhou: ${e.message}`);
    }

    const descontoPct = calcularDesconto(oferta.precoAntigo, oferta.precoAtual);

    // Monta objeto com apenas tipos primitivos — sem objetos especiais do Firestore
    const doc = {
      id:           oferta.id,
      produto:      oferta.produto,
      loja:         oferta.loja,
      categoria:    oferta.categoria || 'Geral',
      precoAntigo:  oferta.precoAntigo || 0,
      precoAtual:   oferta.precoAtual,
      descontoPct,
      comissaoPct:  oferta.comissaoPct,
      cupom:        oferta.cupom || null,
      relampago:    oferta.relampago || false,
      link:         oferta.link || null,
      imagemUrl:    oferta.imagemUrl || null,
      // fallback de demo (dono da conta); cada usuário logado recalcula com
      // o próprio perfil no navegador — ver linkParaMim() no index.html
      linkAfiliado: gerarLinkAfiliado(oferta.loja, oferta.link, afiliadoDono) || null,
      copy:         copy ? {
        titulo:    copy.titulo    || null,
        texto:     copy.texto     || null,
        hashtags:  Array.isArray(copy.hashtags) ? copy.hashtags : [],
      } : null,
      encontradoEm: new Date().toISOString(),
    };

    aprovadas.push(doc);
    console.log(` ✅ ${doc.produto} (${doc.loja}) — R$${doc.precoAtual}${descontoPct > 0 ? ` | ${descontoPct}% OFF` : ''}`);
  }

  console.log(` ${aprovadas.length} aprovada(s) para gravar.`);

  // Substitui coleção "ofertas" pelo lote atual
  const batch  = db.batch();
  const atuais = await db.collection('ofertas').get();
  atuais.forEach(d => batch.delete(d.ref));
  aprovadas.forEach(o => batch.set(db.collection('ofertas').doc(o.id), o));
  await batch.commit();

  // Log simples com apenas primitivos — sem AggregateQuery
  await db.collection('logs').add({
    tipo:               'cacador',
    ofertasEncontradas: brutas.length,
    ofertasAprovadas:   aprovadas.length,
    shopee:             brutas.filter(o => o.loja === 'Shopee').length,
    mercadoLivre:       brutas.filter(o => o.loja === 'Mercado Livre').length,
    amazon:             brutas.filter(o => o.loja === 'Amazon').length,
    executadoEm:        new Date().toISOString(),
  });

  console.log(` Concluído — ${aprovadas.length}/${brutas.length} gravada(s).`);
}

run()
  .then(() => process.exit(0))
  .catch(err => { console.error('[Bot] Erro fatal:', err); process.exit(1); });
