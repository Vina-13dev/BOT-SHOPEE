// server.js
// Servidor local leve — sem Railway.
// Rode com: node server.js
// Útil apenas para testar endpoints manualmente no seu computador.
// A varredura recorrente de ofertas roda pelo GitHub Actions (cacador.yml).

require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const { parseLink }        = require('./lib/parseLink');
const { gerarCopy }        = require('./lib/copywriter');
const { getUltimasOfertas, buscarOfertas } = require('./lib/cacador');
const { calcularOferta }   = require('./lib/classificador');
const { gerarLinkAfiliado } = require('./lib/afiliado');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// GET /
app.get('/', (req, res) => {
  res.json({
    status:  'online',
    sistema: 'Bot Caçador de Ofertas',
    versao:  '2.0.0',
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
