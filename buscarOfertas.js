// scripts/buscarOfertas.js
// Ponto de entrada chamado pelo GitHub Actions a cada 15 minutos
// (.github/workflows/cacador.yml). NÃO depende do Express nem do Railway —
// roda isolado, sozinho, e faz tudo num único processo curto:
//
//   1) Lê o perfil de afiliado salvo no Firestore (config_afiliado/{OWNER_UID})
//   2) Busca ofertas (lib/cacador.js — troque por uma fonte real quando tiver)
//   3) Calcula desconto/comissão e filtra só as melhores
//   4) Aplica o link de afiliado certo pra cada loja
//   5) Gera a copy de venda (opcional, se houver GROQ_API_KEY/ANTHROPIC_API_KEY)
//   6) Grava tudo no Firestore (coleção "ofertas") e um registro em "logs"

require("dotenv").config();
const { getFirestoreAdmin } = require("../lib/firebaseAdmin");
const { buscarOfertas } = require("../lib/cacador");
const { calcularOferta } = require("../lib/classificador");
const { gerarLinkAfiliado } = require("../lib/afiliado");
const { gerarCopy } = require("../lib/copywriter");

const MIN_DESCONTO_PCT = Number(process.env.MIN_DESCONTO_PCT || 25);
const MIN_COMISSAO_PCT = Number(process.env.MIN_COMISSAO_PCT || 7);

async function carregarAfiliado(db) {
  const ownerUid = process.env.OWNER_UID;
  if (!ownerUid) {
    console.warn("[Bot Caçador] OWNER_UID não definido — ofertas serão salvas sem link de afiliado aplicado.");
    return {};
  }
  const snap = await db.collection("config_afiliado").doc(ownerUid).get();
  if (!snap.exists) {
    console.warn(`[Bot Caçador] Nenhum documento em config_afiliado/${ownerUid} — salve seu perfil na aba "Perfil de Afiliado" primeiro.`);
    return {};
  }
  return snap.data();
}

async function run() {
  const db = getFirestoreAdmin();
  const afiliado = await carregarAfiliado(db);

  const brutas = await buscarOfertas(); // hoje é placeholder — ver lib/cacador.js para ligar a uma fonte real

  const aprovadas = [];
  for (const oferta of brutas) {
    const calculo = calcularOferta({
      precoAntigo: oferta.precoAntigo,
      precoAtual: oferta.precoAtual,
      comissaoPct: oferta.comissaoPct,
    });

    if (calculo.descontoPct < MIN_DESCONTO_PCT || oferta.comissaoPct < MIN_COMISSAO_PCT) {
      continue; // descarta ofertas fracas — ajuste os mínimos via env/secret
    }

    let copy = null;
    try {
      copy = await gerarCopy({
        produto: oferta.produto,
        precoAntigo: oferta.precoAntigo,
        precoAtual: oferta.precoAtual,
        cupom: oferta.cupom,
        loja: oferta.loja,
      });
    } catch (e) {
      console.warn(`[Bot Caçador] Copywriter falhou para "${oferta.produto}":`, e.message);
    }

    aprovadas.push({
      ...oferta,
      ...calculo,
      linkAfiliado: gerarLinkAfiliado(oferta.loja, oferta.link, afiliado),
      copy,
      encontradoEm: new Date().toISOString(),
    });
  }

  // Substitui o lote anterior pelo novo (coleção pequena — simples e evita acumular lixo).
  const batch = db.batch();
  const atuais = await db.collection("ofertas").get();
  atuais.forEach((d) => batch.delete(d.ref));
  aprovadas.forEach((oferta) => batch.set(db.collection("ofertas").doc(oferta.id), oferta));
  await batch.commit();

  await db.collection("logs").add({
    tipo: "cacador",
    ofertasEncontradas: brutas.length,
    ofertasAprovadas: aprovadas.length,
    executadoEm: new Date().toISOString(),
  });

  console.log(`[Bot Caçador] ${aprovadas.length}/${brutas.length} oferta(s) aprovada(s) e salva(s) no Firestore.`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[Bot Caçador] Erro fatal:", err);
    process.exit(1);
  });
