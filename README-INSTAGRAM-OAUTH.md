# OAuth Instagram — BOT-SHOPEE / Cata Ofertas

Este patch adiciona **Conectar Instagram** ao bot usando o **Instagram API with Instagram Login**.

## O que ele faz

1. Você continua entrando no painel com Google/Firebase.
2. Clica em **Conectar Instagram**.
3. O backend cria a URL OAuth do Instagram.
4. Você autoriza a conta profissional do Instagram.
5. O Instagram volta para `/api/instagram/oauth/callback`.
6. O backend troca o `code` por token, gera token de longa duração e salva o token **criptografado** no Firestore.
7. O `instagram.js` passa a usar o token da conta conectada, com fallback para as variáveis antigas do `.env`.

## Arquivos

- `instagramOAuth.js` — OAuth + Firestore + criptografia do token.
- `instagram.js` — substitui o arquivo atual.
- `instagram-connect.js` — botão/widget temporário para testar.
- `.env.instagram-oauth.example` — novas variáveis.
- `SERVER-PATCH.txt` — 5 pequenas alterações no `server.js`/`index.html`.

## Importante: GitHub Pages não executa Node.js

O `index.html` pode ficar no GitHub Pages, mas o `server.js` precisa estar publicado em um backend HTTPS (Render, Railway, Cloud Run, etc.). O callback OAuth precisa ser uma URL pública HTTPS.

Exemplo:

`https://seu-backend.exemplo.com/api/instagram/oauth/callback`

Essa URL deve ser cadastrada **exatamente igual** na configuração OAuth da Meta e em `INSTAGRAM_OAUTH_REDIRECT_URI`.

## Credenciais corretas

Use **ID do app do Instagram** e **Chave secreta do app do Instagram** que aparecem dentro de:

Meta for Developers → Casos de uso → Gerenciar mensagens e conteúdo no Instagram → Configuração da API com login do Instagram.

Não confunda com o ID/Secret principal do app Meta.

## Segurança

Nunca salve `.env` real no GitHub. Use Secrets/Environment Variables do serviço onde o backend está hospedado.

A chave secreta principal que foi mostrada durante o teste deve ser redefinida antes de produção.

## Depois que conectar

Quando a tela mostrar `Instagram conectado ✅`, o próximo passo é:

1. configurar o webhook público do Instagram;
2. assinar eventos de `comments`;
3. conectar o módulo Comment-to-DM;
4. deixar `INSTAGRAM_DRY_RUN=false` somente no teste final real.
