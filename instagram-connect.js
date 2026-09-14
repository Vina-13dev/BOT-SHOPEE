// instagram-connect.js
// Widget temporário de teste. Depois você pode integrar o botão no layout definitivo.
(() => {
  const API = () => window.BOT_API_URL || '';

  async function authHeader() {
    if (!window.firebaseAuth) throw new Error('Firebase ainda não carregou.');
    const token = await window.firebaseAuth.getIdToken();
    return { Authorization: `Bearer ${token}` };
  }

  async function status() {
    const r = await fetch(`${API()}/api/instagram/oauth/connection`, { headers: await authHeader() });
    return r.json();
  }

  async function conectar() {
    const btn = document.getElementById('instagramConnectBtn');
    try {
      if (btn) { btn.disabled = true; btn.textContent = 'Abrindo Instagram...'; }
      const r = await fetch(`${API()}/api/instagram/oauth/start`, { headers: await authHeader() });
      const data = await r.json();
      if (!r.ok || !data.authorizationUrl) throw new Error(data.erro || 'Não foi possível iniciar o login.');
      window.location.assign(data.authorizationUrl);
    } catch (e) {
      alert(e.message);
      if (btn) { btn.disabled = false; btn.textContent = 'Conectar Instagram'; }
    }
  }

  async function desconectar() {
    if (!confirm('Desconectar o Instagram deste bot?')) return;
    const r = await fetch(`${API()}/api/instagram/oauth/disconnect`, {
      method: 'POST',
      headers: await authHeader(),
    });
    const data = await r.json();
    if (!r.ok) return alert(data.erro || 'Falha ao desconectar.');
    await atualizar();
  }

  async function atualizar() {
    const box = document.getElementById('instagramConnectWidget');
    if (!box) return;
    try {
      const data = await status();
      if (data.conectado) {
        box.innerHTML = `
          <div style="font-size:12px;color:#34d399;margin-bottom:8px">Instagram conectado ✅</div>
          <div style="font-size:13px;margin-bottom:8px">@${data.instagram?.username || 'conta conectada'}</div>
          <button id="instagramDisconnectBtn" style="width:100%;padding:9px;border-radius:9px;border:1px solid rgba(255,255,255,.12);background:#171b24;color:#fff;cursor:pointer">Desconectar</button>`;
        document.getElementById('instagramDisconnectBtn').onclick = desconectar;
      } else {
        box.innerHTML = `<button id="instagramConnectBtn" style="width:100%;padding:10px;border:0;border-radius:10px;background:linear-gradient(90deg,#833ab4,#fd1d1d,#fcb045);color:#fff;font-weight:700;cursor:pointer">Conectar Instagram</button>`;
        document.getElementById('instagramConnectBtn').onclick = conectar;
      }
    } catch (e) {
      box.innerHTML = `<button id="instagramConnectBtn" style="width:100%;padding:10px;border:0;border-radius:10px;background:linear-gradient(90deg,#833ab4,#fd1d1d,#fcb045);color:#fff;font-weight:700;cursor:pointer">Conectar Instagram</button>`;
      document.getElementById('instagramConnectBtn').onclick = conectar;
    }
  }

  function montar() {
    if (document.getElementById('instagramConnectWidget')) return;
    const box = document.createElement('div');
    box.id = 'instagramConnectWidget';
    box.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:9999;width:210px;background:#12161F;border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:12px;box-shadow:0 10px 30px rgba(0,0,0,.35)';
    box.innerHTML = '<div style="font-size:12px;color:rgba(255,255,255,.55)">Entre com Google no painel e conecte seu Instagram.</div>';
    document.body.appendChild(box);
    setTimeout(atualizar, 900);
  }

  window.conectarInstagram = conectar;
  window.desconectarInstagram = desconectar;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})();
