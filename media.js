// src/instagram/media.js
// Lista as publicações (posts/reels) da conta conectada, pra montar a
// automação sem precisar digitar media_id na mão.

const { required, graphGet } = require("./client");

const CAMPOS = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp";

async function listarMedia({ after, limit = 25 } = {}) {
  const userId = required("INSTAGRAM_USER_ID");
  let path = `/${encodeURIComponent(userId)}/media?fields=${CAMPOS}&limit=${Number(limit) || 25}`;
  if (after) path += `&after=${encodeURIComponent(after)}`;

  const data = await graphGet(path);
  return {
    items: Array.isArray(data.data) ? data.data : [],
    nextCursor: data.paging?.cursors?.after || null,
    hasMore: !!data.paging?.next,
  };
}

module.exports = { listarMedia };
