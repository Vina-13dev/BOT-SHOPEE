// instagram.js — integração oficial com Instagram API.
// Primeiro tenta usar a conta conectada via OAuth/Firestore; se não houver,
// mantém compatibilidade com INSTAGRAM_USER_ID + INSTAGRAM_ACCESS_TOKEN do .env.

const { carregarConexaoInstagram, atualizarTokenInstagram } = require('./instagramOAuth');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variável ${name} não configurada.`);
  return value;
}

function graphUrl(path) {
  const version = process.env.META_GRAPH_VERSION || 'v26.0';
  const host = process.env.META_GRAPH_HOST || 'https://graph.instagram.com';
  return `${host}/${version}/${path.replace(/^\//, '')}`;
}

async function resolverCredenciais(uid) {
  if (uid) {
    const conn = await carregarConexaoInstagram(uid);
    if (conn?.accessToken && conn?.instagramUserId) {
      return { token: conn.accessToken, userId: conn.instagramUserId, origem: 'oauth' };
    }
  }
  return {
    token: required('INSTAGRAM_ACCESS_TOKEN'),
    userId: required('INSTAGRAM_USER_ID'),
    origem: 'env',
  };
}

async function graphPost(path, params, token) {
  const body = new URLSearchParams({ ...params, access_token: token });
  const response = await fetch(graphUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const message = data?.error?.message || `Instagram API HTTP ${response.status}`;
    const error = new Error(message);
    error.meta = data;
    error.status = response.status;
    throw error;
  }
  return data;
}

async function graphGet(path, token) {
  const url = new URL(graphUrl(path));
  url.searchParams.set('access_token', token);
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const message = data?.error?.message || `Instagram API HTTP ${response.status}`;
    const error = new Error(message);
    error.meta = data;
    error.status = response.status;
    throw error;
  }
  return data;
}

async function testarConexaoInstagram({ uid } = {}) {
  const { token, userId } = await resolverCredenciais(uid);
  return graphGet(`/${encodeURIComponent(userId)}?fields=id,username`, token);
}

async function aguardarContainerPronto(containerId, token, { tentativas = 10, intervaloMs = 1500 } = {}) {
  for (let i = 0; i < tentativas; i++) {
    const status = await graphGet(`/${encodeURIComponent(containerId)}?fields=status_code`, token);
    if (status.status_code === 'FINISHED') return true;
    if (status.status_code === 'ERROR') throw new Error('A Meta não conseguiu processar a imagem (status ERROR no container).');
    await new Promise((r) => setTimeout(r, intervaloMs));
  }
  return false;
}

async function publicarImagemInstagram({ imageUrl, caption, uid }) {
  if (!imageUrl) throw new Error('URL pública da imagem não informada.');
  if (!caption) throw new Error('Legenda não informada.');

  const { token, userId } = await resolverCredenciais(uid);
  const container = await graphPost(`/${encodeURIComponent(userId)}/media`, { image_url: imageUrl, caption }, token);
  if (!container.id) throw new Error('A Meta não retornou o ID do container de mídia.');

  await aguardarContainerPronto(container.id, token);
  const published = await graphPost(`/${encodeURIComponent(userId)}/media_publish`, { creation_id: container.id }, token);
  return { containerId: container.id, mediaId: published.id || null, raw: published };
}

async function renovarTokenInstagram({ uid } = {}) {
  const cred = await resolverCredenciais(uid);
  const host = process.env.META_GRAPH_HOST || 'https://graph.instagram.com';
  const url = new URL(`${host}/refresh_access_token`);
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', cred.token);

  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const message = data?.error?.message || `Falha ao renovar token (HTTP ${response.status})`;
    const error = new Error(message);
    error.meta = data;
    throw error;
  }

  if (uid && cred.origem === 'oauth' && data.access_token) {
    await atualizarTokenInstagram(uid, data.access_token, data.expires_in || null);
  }
  return data;
}

module.exports = { testarConexaoInstagram, publicarImagemInstagram, renovarTokenInstagram };
