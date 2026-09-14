// instagramOAuth.js
// OAuth do Instagram API with Instagram Login.
// Salva o token de forma criptografada no Firestore, vinculado ao UID do Firebase.

const express = require('express');
const crypto = require('crypto');
const { getFirestoreAdmin, verificarIdToken } = require('./firebaseAdmin');

const router = express.Router();
const COLLECTION = 'instagram_conexoes';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variável ${name} não configurada.`);
  return value;
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function hmac(value) {
  const secret = process.env.INSTAGRAM_OAUTH_STATE_SECRET || required('INSTAGRAM_APP_SECRET');
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function criarState(uid) {
  const payload = base64url(JSON.stringify({
    uid,
    exp: Date.now() + 10 * 60 * 1000,
    nonce: crypto.randomBytes(16).toString('hex'),
  }));
  return `${payload}.${hmac(payload)}`;
}

function validarState(state) {
  if (!state || !state.includes('.')) throw new Error('OAuth state ausente ou inválido.');
  const [payload, assinatura] = state.split('.');
  const esperada = hmac(payload);
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('OAuth state inválido.');
  }
  const dados = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!dados.uid || !dados.exp || Date.now() > dados.exp) throw new Error('OAuth state expirado.');
  return dados;
}

function chaveCriptografia() {
  const segredo = process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY || required('INSTAGRAM_APP_SECRET');
  return crypto.createHash('sha256').update(segredo).digest();
}

function criptografar(texto) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', chaveCriptografia(), iv);
  const data = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString('base64'), tag: tag.toString('base64'), data: data.toString('base64') };
}

function descriptografar(obj) {
  if (!obj?.iv || !obj?.tag || !obj?.data) return null;
  const decipher = crypto.createDecipheriv('aes-256-gcm', chaveCriptografia(), Buffer.from(obj.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(obj.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(obj.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

async function autenticarFirebase(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    const e = new Error('Faça login no painel antes de conectar o Instagram.');
    e.status = 401;
    throw e;
  }
  return verificarIdToken(match[1]);
}

function redirectUri() {
  return required('INSTAGRAM_OAUTH_REDIRECT_URI');
}

function scopes() {
  return (process.env.INSTAGRAM_OAUTH_SCOPES || [
    'instagram_business_basic',
    'instagram_business_manage_comments',
    'instagram_business_manage_messages',
    'instagram_business_content_publish',
  ].join(',')).split(',').map(s => s.trim()).filter(Boolean).join(',');
}

function montarUrlAutorizacao(uid) {
  const url = new URL(process.env.INSTAGRAM_OAUTH_AUTH_URL || 'https://www.instagram.com/oauth/authorize');
  url.searchParams.set('client_id', required('INSTAGRAM_APP_ID'));
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes());
  url.searchParams.set('state', criarState(uid));
  // Parâmetros usados pelo fluxo atual do Instagram Login.
  url.searchParams.set('enable_fb_login', '0');
  url.searchParams.set('force_authentication', '1');
  return url.toString();
}

async function trocarCodePorToken(code) {
  const body = new URLSearchParams({
    client_id: required('INSTAGRAM_APP_ID'),
    client_secret: required('INSTAGRAM_APP_SECRET'),
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(),
    code,
  });

  const response = await fetch(process.env.INSTAGRAM_OAUTH_TOKEN_URL || 'https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error_type || data.error) {
    const e = new Error(data.error_message || data.error?.message || `Falha ao trocar code por token (HTTP ${response.status}).`);
    e.meta = data;
    throw e;
  }
  return data;
}

async function trocarPorLongaDuracao(shortToken) {
  const url = new URL(process.env.INSTAGRAM_LONG_TOKEN_URL || 'https://graph.instagram.com/access_token');
  url.searchParams.set('grant_type', 'ig_exchange_token');
  url.searchParams.set('client_secret', required('INSTAGRAM_APP_SECRET'));
  url.searchParams.set('access_token', shortToken);

  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const e = new Error(data.error?.message || `Falha ao gerar token de longa duração (HTTP ${response.status}).`);
    e.meta = data;
    throw e;
  }
  return data;
}

async function buscarPerfil(accessToken) {
  const version = process.env.META_GRAPH_VERSION || 'v26.0';
  const url = new URL(`https://graph.instagram.com/${version}/me`);
  url.searchParams.set('fields', 'id,username');
  url.searchParams.set('access_token', accessToken);
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const e = new Error(data.error?.message || `Falha ao consultar conta do Instagram (HTTP ${response.status}).`);
    e.meta = data;
    throw e;
  }
  return data;
}

async function salvarConexaoInstagram(uid, { accessToken, instagramUserId, username, expiresIn }) {
  const db = getFirestoreAdmin();
  const agora = Date.now();
  const expiresAt = expiresIn ? new Date(agora + Number(expiresIn) * 1000).toISOString() : null;
  await db.collection(COLLECTION).doc(uid).set({
    uid,
    instagramUserId: String(instagramUserId || ''),
    username: username || null,
    accessTokenEncrypted: criptografar(accessToken),
    tokenExpiresAt: expiresAt,
    conectadoEm: new Date(agora).toISOString(),
    atualizadoEm: new Date(agora).toISOString(),
  }, { merge: true });
}

async function carregarConexaoInstagram(uid) {
  if (!uid) return null;
  const snap = await getFirestoreAdmin().collection(COLLECTION).doc(uid).get();
  if (!snap.exists) return null;
  const data = snap.data();
  const accessToken = descriptografar(data.accessTokenEncrypted);
  if (!accessToken) return null;
  return { ...data, accessToken };
}

async function buscarConexaoPorInstagramUserId(instagramUserId) {
  if (!instagramUserId) return null;
  const snap = await getFirestoreAdmin().collection(COLLECTION)
    .where('instagramUserId', '==', String(instagramUserId))
    .limit(1)
    .get();
  if (snap.empty) return null;
  const data = snap.docs[0].data();
  const accessToken = descriptografar(data.accessTokenEncrypted);
  if (!accessToken) return null;
  return { ...data, accessToken };
}

async function atualizarTokenInstagram(uid, accessToken, expiresIn) {
  const ref = getFirestoreAdmin().collection(COLLECTION).doc(uid);
  await ref.set({
    accessTokenEncrypted: criptografar(accessToken),
    tokenExpiresAt: expiresIn ? new Date(Date.now() + Number(expiresIn) * 1000).toISOString() : null,
    atualizadoEm: new Date().toISOString(),
  }, { merge: true });
}

router.get('/start', async (req, res) => {
  try {
    const decoded = await autenticarFirebase(req);
    res.json({ ok: true, authorizationUrl: montarUrlAutorizacao(decoded.uid) });
  } catch (e) {
    res.status(e.status || 400).json({ ok: false, erro: e.message });
  }
});

router.get('/callback', async (req, res) => {
  try {
    if (req.query.error) {
      throw new Error(req.query.error_description || req.query.error || 'Autorização cancelada pelo Instagram.');
    }
    const code = req.query.code;
    if (!code) throw new Error('Instagram não retornou o parâmetro code.');
    const { uid } = validarState(req.query.state);

    const curto = await trocarCodePorToken(code);
    const longo = await trocarPorLongaDuracao(curto.access_token);
    const accessToken = longo.access_token || curto.access_token;
    const perfil = await buscarPerfil(accessToken);

    await salvarConexaoInstagram(uid, {
      accessToken,
      instagramUserId: perfil.id || curto.user_id,
      username: perfil.username || null,
      expiresIn: longo.expires_in || null,
    });

    const successUrl = process.env.INSTAGRAM_OAUTH_SUCCESS_URL || '/?instagram=connected';
    return res.redirect(successUrl);
  } catch (e) {
    console.error('[Instagram OAuth]', e);
    const fail = process.env.INSTAGRAM_OAUTH_ERROR_URL;
    if (fail) {
      const url = new URL(fail);
      url.searchParams.set('instagram', 'error');
      url.searchParams.set('message', e.message);
      return res.redirect(url.toString());
    }
    res.status(400).send(`Falha ao conectar Instagram: ${e.message}`);
  }
});

router.get('/connection', async (req, res) => {
  try {
    const decoded = await autenticarFirebase(req);
    const conn = await carregarConexaoInstagram(decoded.uid);
    if (!conn) return res.json({ ok: true, conectado: false });
    res.json({
      ok: true,
      conectado: true,
      instagram: { id: conn.instagramUserId, username: conn.username },
      tokenExpiresAt: conn.tokenExpiresAt || null,
    });
  } catch (e) {
    res.status(e.status || 400).json({ ok: false, erro: e.message });
  }
});

router.post('/disconnect', async (req, res) => {
  try {
    const decoded = await autenticarFirebase(req);
    await getFirestoreAdmin().collection(COLLECTION).doc(decoded.uid).delete();
    res.json({ ok: true, conectado: false });
  } catch (e) {
    res.status(e.status || 400).json({ ok: false, erro: e.message });
  }
});

module.exports = router;
module.exports.carregarConexaoInstagram = carregarConexaoInstagram;
module.exports.buscarConexaoPorInstagramUserId = buscarConexaoPorInstagramUserId;
module.exports.atualizarTokenInstagram = atualizarTokenInstagram;
