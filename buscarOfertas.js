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
const { calcularScoreOferta } = require('./score');

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

// ─── Histórico de menor preço (30 dias) ─────────────────────────────────────
// Usa o ID ESTÁVEL do produto (ml-MLBUxxxx / shopee-xxxx) — só existe porque
// já resolvemos isso antes. Guarda só o mínimo + quando foi visto, não cada
// preço de cada varredura (senão ia virar milhares de registros por mês).
// Se o "menor preço" registrado tem mais de 30 dias, reseta — não faz
// sentido continuar comparando com um preço de 2 meses atrás.
async function atualizarHistoricoPreco(db, produtoId, precoAtual) {
  const ref = db.collection('historico_precos').doc(produtoId);
  const snap = await ref.get().catch(() => null);
  const agora = new Date();
  const dados = snap?.exists ? snap.data() : null;

  let menorPreco = precoAtual;
  let menorPrecoEm = agora.toISOString();

  if (dados?.menorPreco != null && dados?.menorPrecoEm) {
    const dias = (agora - new Date(dados.menorPrecoEm)) / (1000 * 60 * 60 * 24);
    if (dias <= 30 && dados.menorPreco <= precoAtual) {
      menorPreco = dados.menorPreco;
      menorPrecoEm = dados.menorPrecoEm;
    }
    // senão: preço atual é o novo menor, OU o registro antigo já passou de
    // 30 dias — os dois casos resetam pro preço de agora.
  }

  await ref.set({ menorPreco, menorPrecoEm, ultimoPreco: precoAtual, atualizadoEm: agora.toISOString() }, { merge: true })
    .catch((e) => console.warn(`[Histórico preço] falhou pra ${produtoId}:`, e.message));

  return { menorPreco30d: menorPreco, ehMenorPreco: precoAtual <= menorPreco };
}

// ─── Monitor de saúde ────────────────────────────────────────────────────────
// Se o ML/Shopee mudar o site e o scraping quebrar, o bot passa a achar 0
// ofertas sem dar erro nenhum (do jeito que ele foi feito pra não travar).
// Isso avisa quando isso acontecer, em vez de você só descobrir quando abrir
// o app e ver tudo vazio. Funciona com Discord ou Slack (formato de webhook
// é compatível com os dois) — configure HEALTH_WEBHOOK_URL nos Secrets do
// GitHub pra ativar. Sem essa variável, só ignora (não quebra o bot).
async function verificarSaude(db, totalEncontrado) {
  const webhookUrl = process.env.HEALTH_WEBHOOK_URL;
  const LIMITE_VARREDURAS_VAZIAS = 2; // 2 varreduras seguidas vazias = ~30 min sem nada

  const ref = db.collection('bot_status').doc('saude');
  const snap = await ref.get().catch(() => null);
  const anterior = snap?.exists ? snap.data() : { vaziasSeguidas: 0, alertaEnviado: false };

  const vaziasSeguidas = totalEncontrado > 0 ? 0 : (anterior.vaziasSeguidas || 0) + 1;
  const estavaEmAlerta = !!anterior.alertaEnviado;
  const deveAlertar = vaziasSeguidas >= LIMITE_VARREDURAS_VAZIAS && !estavaEmAlerta;
  const deveAvisarRecuperado = totalEncontrado > 0 && estavaEmAlerta;

  await ref.set({
    vaziasSeguidas,
    alertaEnviado: estavaEmAlerta && !deveAvisarRecuperado ? true : (deveAlertar ? true : false),
    ultimaChecagem: new Date().toISOString(),
  }).catch((e) => console.warn('[Saúde] falhou ao salvar status:', e.message));

  if (!webhookUrl) return; // ninguém configurou alerta, tudo bem

  try {
    if (deveAlertar) {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `⚠️ *Bot Caçador de Ofertas*: ${vaziasSeguidas} varreduras seguidas sem encontrar nada. O Mercado Livre (ou Shopee) pode ter mudado o site — vale conferir o log do GitHub Actions.` }),
      });
    } else if (deveAvisarRecuperado) {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `✅ *Bot Caçador de Ofertas*: voltou a encontrar ofertas normalmente (${totalEncontrado} agora).` }),
      });
    }
  } catch (e) {
    console.warn('[Saúde] falhou ao enviar webhook:', e.message);
  }
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
        produto:      oferta.produto,
        precoAntigo:  oferta.precoAntigo,
        precoAtual:   oferta.precoAtual,
        cupom:        oferta.cupom,
        loja:         oferta.loja,
        nota:         oferta.nota ?? null,
        vendas:       oferta.vendas ?? null,
        freteGratis:  !!oferta.freteGratis,
        vendedorLider: !!oferta.vendedorLider,
      });
    } catch (e) {
      console.warn(`[Bot] Copy falhou: ${e.message}`);
    }
const descontoPct = calcularDesconto(
  oferta.precoAntigo,
  oferta.precoAtual
);

// Histórico de menor preço — só faz sentido pra quem tem ID ESTÁVEL
// (ml-... ou shopee-...). Anúncios patrocinados/redirect ainda usam ID
// aleatório às vezes (ver cacador.js) e não dá pra rastrear histórico
// deles de forma confiável.
let precoInfo = {
  menorPreco30d: oferta.precoAtual,
  ehMenorPreco: true
};

if (/^(ml|shopee)-/.test(oferta.id)) {
  precoInfo = await atualizarHistoricoPreco(
    db,
    oferta.id,
    oferta.precoAtual
  );
}

// Calcula o score somente DEPOIS de obter a informação de menor preço.
const scoreInfo = calcularScoreOferta({
  ...oferta,
  descontoPct,
  ehMenorPreco: precoInfo.ehMenorPreco
});

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
      pixOnly:      !!oferta.pixOnly,
      nota:         oferta.nota ?? null,
      vendas:       oferta.vendas ?? null,
      freteGratis:  !!oferta.freteGratis,
      vendedorLider: !!oferta.vendedorLider,
      menorPreco30d: precoInfo.menorPreco30d,
      ehMenorPreco:  precoInfo.ehMenorPreco,
      score:          scoreInfo.score,
      scoreNivel:     scoreInfo.nivel,
      scoreIcone:     scoreInfo.icone,
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

  // Monitor de saúde — avisa (se HEALTH_WEBHOOK_URL estiver configurado)
  // quando o bot passa a achar 0 ofertas por varreduras seguidas, sinal de
  // que o site mudou e o scraping quebrou.
  await verificarSaude(db, brutas.length);

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
