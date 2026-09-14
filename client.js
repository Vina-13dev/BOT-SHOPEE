// src/instagram/client.js
// Cliente HTTP de baixo nível pra API do Instagram (Instagram API with
// Instagram Login — host graph.instagram.com). Credenciais só existem
// aqui no backend, nunca chegam no navegador.

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variável ${name} não configurada.`);
  return value;
}

function graphUrl(path) {
  const version = process.env.META_GRAPH_VERSION || "v26.0";
  const host = process.env.META_GRAPH_HOST || "https://graph.instagram.com";
  return `${host}/${version}/${path.replace(/^\//, "")}`;
}

// Chamadas "clássicas" da Graph API — parâmetros como form-urlencoded,
// token na própria query/body. Usado por /media, /media_publish, etc.
async function graphPost(path, params) {
  const token = required("INSTAGRAM_ACCESS_TOKEN");
  const body = new URLSearchParams({ ...params, access_token: token });
  const response = await fetch(graphUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
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

async function graphGet(path) {
  const token = required("INSTAGRAM_ACCESS_TOKEN");
  const url = new URL(graphUrl(path));
  url.searchParams.set("access_token", token);
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

// A Meta documenta o endpoint de mensagens (Private Reply) usando corpo
// JSON de verdade (objetos aninhados: recipient.comment_id,
// message.text) e o token no header Authorization — diferente do padrão
// form-urlencoded acima. Por isso é uma função separada, seguindo
// exatamente o formato oficial, sem inventar.
async function graphPostJson(path, jsonBody) {
  const token = required("INSTAGRAM_ACCESS_TOKEN");
  const response = await fetch(graphUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(jsonBody),
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

module.exports = { required, graphUrl, graphGet, graphPost, graphPostJson };
