// instagram.js — integração oficial com Instagram API.
// Credenciais ficam somente no backend/Secrets.

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

async function graphPost(path, params) {
  const token = required('INSTAGRAM_ACCESS_TOKEN');
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
    throw error;
  }
  return data;
}

async function graphGet(path) {
  const token = required('INSTAGRAM_ACCESS_TOKEN');
  const url = new URL(graphUrl(path));
  url.searchParams.set('access_token', token);
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const message = data?.error?.message || `Instagram API HTTP ${response.status}`;
    const error = new Error(message);
    error.meta = data;
    throw error;
  }
  return data;
}

async function testarConexaoInstagram() {
  const userId = required('INSTAGRAM_USER_ID');
  return graphGet(`/${encodeURIComponent(userId)}?fields=id,username`);
}

async function publicarImagemInstagram({ imageUrl, caption }) {
  if (!imageUrl) throw new Error('URL pública da imagem não informada.');
  if (!caption) throw new Error('Legenda não informada.');

  const userId = required('INSTAGRAM_USER_ID');

  // 1) Cria o container da imagem.
  const container = await graphPost(`/${encodeURIComponent(userId)}/media`, {
    image_url: imageUrl,
    caption,
  });

  if (!container.id) throw new Error('A Meta não retornou o ID do container de mídia.');

  // 2) Publica o container.
  const published = await graphPost(`/${encodeURIComponent(userId)}/media_publish`, {
    creation_id: container.id,
  });

  return {
    containerId: container.id,
    mediaId: published.id || null,
    raw: published,
  };
}

module.exports = { testarConexaoInstagram, publicarImagemInstagram };
