// server.js
// Servidor local leve — sem Railway.
// Rode com: node server.js
// Útil apenas para testar endpoints manualmente no seu computador.
// A varredura recorrente de ofertas roda pelo GitHub Actions (cacador.yml).

require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const { parseLink }        = require('./parseLink');
const { gerarCopy }        = require('./copywriter');
const { getUltimasOfertas, buscarOfertas } = require('./cacador');
const { calcularOferta }   = require('./classificador');
const { gerarLinkAfiliado } = require('./afiliado');
const { calcularScoreOferta } = require('./score');
const { testarConexaoInstagram, publicarImagemInstagram } = require('./instagram');
const { getFirestoreAdmin, getStorageBucket, verificarIdToken } = require('./firebaseAdmin');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '8mb' }));

function limparTextoInstagram(texto) {
  return String(texto || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 2000);
}

function gerarLegendaInstagram(oferta, linkAfiliado) {
  const titulo = oferta.copy?.titulo || oferta.produto || 'Oferta';
  const desconto = Number(oferta.descontoPct || 0);
  const linhas = [
    '🔥 OFERTA ENCONTRADA!',
    '',
    titulo,
    '',
  ];
  if (oferta.precoAntigo > 0) linhas.push(`De ${formatarBRL(oferta.precoAntigo)}`);
  linhas.push(`Por ${formatarBRL(oferta.precoAtual)}`);
  if (desconto > 0) linhas.push(`💰 ${Math.round(desconto)}% OFF`);
  if (oferta.cupom) linhas.push(`🎟 Cupom: ${oferta.cupom}`);
  linhas.push('', `🛒 ${oferta.loja || 'Mercado Livre'}`);
  // O link é mantido no backend para validação e para futuras estratégias de CTA.
  // Não o colocamos automaticamente na legenda do feed.
  if (linkAfiliado) linhas.push('', '🔗 Link para comprar no perfil.');
  linhas.push('', '#ofertas #promocao #achadinhos #ofertasdobrasil');
  return limparTextoInstagram(linhas.join('\n'));
}

function formatarBRL(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function autenticarFirebase(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    const erro = new Error('Autenticação necessária. Faça login no painel.');
    erro.status = 401;
    throw erro;
  }
  return verificarIdToken(match[1]);
}

async function uploadImagemTemporaria(dataUrl, uid, offerId) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    throw new Error('A arte precisa ser enviada como imagem data URL.');
  }

  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i);
  if (!match) throw new Error('Formato de imagem não suportado. Use PNG, JPEG ou WEBP.');

  const contentType = match[1].toLowerCase() === 'jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 7 * 1024 * 1024) throw new Error('A arte excede 7 MB.');

  const bucket = getStorageBucket();
  const file = bucket.file(`instagram-offers/${uid}/${offerId}-${Date.now()}.png`);
  await file.save(buffer, { metadata: { contentType, cacheControl: 'public,max-age=900' }, resumable: false });

  const [signedUrl] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 15 * 60 * 1000,
  });
  return { file, signedUrl };
}

// GET /
app.get('/', (req, res) => {
  res.json({
    status:  'online',
    sistema: 'Bot Caçador de Ofertas',
    versao:  '2.1.0',
    ambiente: process.env.NODE_ENV || 'development',
  });
});

// POST /api/parse-link  { url }
app.post('/api/parse-link', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ erro: 'Campo obrigatório: url' });
    const dados = await parseLink(url);
    res.json(dados);
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// POST /api/gerar-oferta
app.post('/api/gerar-oferta', async (req, res) => {
  try {
    const { produto, loja, precoAntigo, precoAtual, comissaoPct, cupom, link, imagemUrl, afiliado } = req.body || {};

    const faltando = [];
    if (!produto)    faltando.push('produto');
    if (precoAntigo == null || precoAntigo === '') faltando.push('precoAntigo');
    if (precoAtual  == null || precoAtual  === '') faltando.push('precoAtual');
    if (comissaoPct == null || comissaoPct === '') faltando.push('comissaoPct');
    if (faltando.length)
      return res.status(400).json({ erro: `Campos obrigatórios faltando: ${faltando.join(', ')}` });

    const pA  = Number(precoAntigo);
    const pAt = Number(precoAtual);
    const com = Number(comissaoPct);

    if ([pA, pAt, com].some(n => Number.isNaN(n)))
      return res.status(400).json({ erro: 'precoAntigo, precoAtual e comissaoPct precisam ser números válidos' });
    if (pA <= 0 || pAt <= 0)
      return res.status(400).json({ erro: 'precoAntigo e precoAtual precisam ser maiores que zero' });

    const calculo = calcularOferta({ precoAntigo: pA, precoAtual: pAt, comissaoPct: com });
    const copy    = await gerarCopy({ produto, precoAntigo: pA, precoAtual: pAt, cupom, loja });

    res.json({
      id: `gen-${Date.now()}`,
      produto, loja,
      precoAntigo: pA, precoAtual: pAt, comissaoPct: com,
      cupom: cupom || null,
      link:  link  || null,
      imagemUrl: imagemUrl || null,
      linkAfiliado: gerarLinkAfiliado(loja, link, afiliado || {}),
      ...calculo,
      copy,
      criadoEm: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// GET /api/cacador/ofertas — últimas ofertas capturadas em memória (teste local)
app.get('/api/cacador/ofertas', (req, res) => {
  res.json(getUltimasOfertas());
});

// POST /api/cacador/rodar — dispara uma varredura manual para testar localmente
app.post('/api/cacador/rodar', async (req, res) => {
  try {
    const ofertas = await buscarOfertas();
    res.json({ ok: true, total: ofertas.length, ofertas });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// GET /api/instagram/status — verifica token/conta sem expor o token ao navegador.
app.get('/api/instagram/status', async (req, res) => {
  try {
    await autenticarFirebase(req);
    const data = await testarConexaoInstagram();
    res.json({ ok: true, conectado: true, instagram: data });
  } catch (e) {
    res.status(e.status || 400).json({ ok: false, conectado: false, erro: e.message, detalhe: e.meta || null });
  }
});

// POST /api/instagram/publish
// Publica SOMENTE quando o usuário clicar no painel. O backend valida o Firebase
// token, recupera a oferta no Firestore e exige o link meli.la para Mercado Livre.
app.post('/api/instagram/publish', async (req, res) => {
  let tempFile = null;
  try {
    const decoded = await autenticarFirebase(req);
    const { offerId, imageDataUrl, caption } = req.body || {};
    if (!offerId) return res.status(400).json({ erro: 'Campo obrigatório: offerId' });
    if (!imageDataUrl) return res.status(400).json({ erro: 'A arte da oferta não foi enviada.' });

    const db = getFirestoreAdmin();
    const ofertaSnap = await db.collection('ofertas').doc(String(offerId)).get();
    if (!ofertaSnap.exists) return res.status(404).json({ erro: 'Oferta não encontrada ou já expirou.' });
    const oferta = ofertaSnap.data();

    // Evita publicar duas vezes a mesma oferta para o mesmo usuário.
    const pubRef = db.collection('publicacoes_instagram').doc(`${decoded.uid}_${offerId}`);
    const pubSnap = await pubRef.get();
    if (pubSnap.exists && pubSnap.data()?.status === 'publicada') {
      return res.status(409).json({ erro: 'Esta oferta já foi publicada no Instagram.', publicacao: pubSnap.data() });
    }

    let linkAfiliado = oferta.linkAfiliado || oferta.link || null;
    if (oferta.loja === 'Mercado Livre') {
      const linksSnap = await db.collection('links_prontos').doc(decoded.uid).get();
      const links = linksSnap.exists ? linksSnap.data() : {};
      linkAfiliado = links[String(offerId)] || null;
      if (!linkAfiliado || !/^https?:\/\/(?:www\.)?meli\.la\//i.test(linkAfiliado)) {
        return res.status(400).json({ erro: 'Cole e salve o seu link meli.la antes de publicar.' });
      }
    }

    const score = calcularScoreOferta(oferta);
    const legenda = limparTextoInstagram(caption) || gerarLegendaInstagram(oferta, linkAfiliado);
    const { file, signedUrl } = await uploadImagemTemporaria(imageDataUrl, decoded.uid, String(offerId));
    tempFile = file;

    await pubRef.set({
      uid: decoded.uid,
      offerId: String(offerId),
      status: 'publicando',
      score: score.score,
      caption: legenda,
      iniciadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
    }, { merge: true });

    const resultado = await publicarImagemInstagram({ imageUrl: signedUrl, caption: legenda });

    const publicado = {
      uid: decoded.uid,
      offerId: String(offerId),
      status: 'publicada',
      score: score.score,
      mediaId: resultado.mediaId,
      containerId: resultado.containerId,
      caption: legenda,
      publicadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
      erro: null,
    };
    await pubRef.set(publicado, { merge: true });

    res.json({ ok: true, publicacao: publicado });
  } catch (e) {
    console.error('[Instagram] erro:', e);
    try {
      const decoded = req.headers.authorization ? await autenticarFirebase(req) : null;
      const { offerId } = req.body || {};
      if (decoded && offerId) {
        const db = getFirestoreAdmin();
        await db.collection('publicacoes_instagram').doc(`${decoded.uid}_${offerId}`).set({
          uid: decoded.uid, offerId: String(offerId), status: 'erro',
          erro: e.message, atualizadoEm: new Date().toISOString(),
        }, { merge: true });
      }
    } catch (_) {}
    res.status(e.status || 500).json({ ok: false, erro: e.message, detalhe: e.meta || null });
  }
});

// GET /api/status
app.get('/api/status', (req, res) => {
  res.json({
    backend:   true,
    bots:      true,
    firebase:  true,
    timestamp: Date.now(),
  });
});

// GET /api/bots
app.get('/api/bots', (req, res) => {
  res.json({ cacador: true, copywriter: true, classificador: true });
});

// GET /api/health
app.get('/api/health', (req, res) => {
  res.json({ ok: true, server: true, timestamp: new Date().toISOString() });
});

// Erro global
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

app.listen(PORT, () => {
  console.log(`[Servidor] Rodando em http://localhost:${PORT}`);
  console.log('[Servidor] A varredura recorrente roda pelo GitHub Actions — não por este processo.');
});
