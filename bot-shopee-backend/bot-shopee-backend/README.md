# Bot Shopee — Backend

Este é o servidor que dá vida ao painel: ele calcula desconto/comissão, gera o
texto de venda com IA, tenta ler links colados pelo usuário e tem o esqueleto
do robô que ficaria rodando 24h.

## Como rodar na sua máquina

```bash
cd bot-shopee-backend
npm install
cp .env.example .env
# edite o .env e cole sua ANTHROPIC_API_KEY (opcional — sem ela usa texto padrão)
npm start
```

O servidor sobe em `http://localhost:3000`.

## Rotas disponíveis

| Rota | Método | O que faz |
|---|---|---|
| `/api/health` | GET | Testa se o servidor está de pé |
| `/api/parse-link` | POST `{ url }` | Tenta ler título, imagem e preço de um link colado |
| `/api/gerar-oferta` | POST `{ produto, loja, precoAntigo, precoAtual, comissaoPct, cupom, link, imagemUrl }` | Roda o pipeline completo (desconto, comissão, texto com IA) |
| `/api/cacador/ofertas` | GET | Devolve as últimas ofertas que o robô (cron) encontrou |

## Ligando ao painel HTML

No arquivo `bot-shopee.html`, troque a chamada direta à Anthropic por uma
chamada para `http://localhost:3000/api/gerar-oferta` (ou para o endereço do
servidor depois que você hospedar ele). Isso já tira a IA do navegador e
coloca no backend, que é o jeito certo de fazer.

---

## O que JÁ funciona de verdade (testado)

- Cálculo de desconto, comissão e classificação 🟢🟡🔴 — **real**.
- Geração de texto de venda com IA (Claude) — **real**, com fallback automático
  se a chave não estiver configurada.
- Bot Caçador rodando em loop (cron) — **real**, mas hoje devolve uma oferta de
  exemplo (placeholder), porque ainda não está ligado a nenhuma loja de verdade.
- Leitura de link colado (`/api/parse-link`) — **real**, mas com uma limitação
  importante explicada abaixo.

## O que ainda falta para ficar 100% automático

1. **Shopee, Amazon e Mercado Livre bloqueiam robôs.**
   Testei agora mesmo e a Shopee devolveu erro 403 (acesso negado) para uma
   requisição automática simples. Isso é esperado: essas lojas detectam e
   bloqueiam scraping direto. Para funcionar de verdade em todas, existem dois
   caminhos:
   - **Caminho recomendado:** usar os **programas oficiais de afiliados**
     (Shopee Affiliate API, Amazon PA-API, e agregadores como Lomadee/Awin que
     já reúnem várias lojas brasileiras numa API só). Você se cadastra, recebe
     uma chave, e passa a receber os dados de produto/preço/comissão de forma
     oficial e estável.
   - **Caminho alternativo (mais frágil):** usar Puppeteer (navegador
     automatizado) para imitar um usuário real. Funciona em mais sites, mas é
     mais lento, quebra quando o site muda o layout, e pode violar os Termos
     de Uso de algumas lojas — vale checar antes de depender disso.
   - AliExpress e alguns outros sites com páginas mais simples costumam
     funcionar bem com a leitura de link atual (`/api/parse-link`).

2. **O Bot Caçador ainda não busca nada sozinho.**
   O cron já roda automaticamente — falta só preencher a função
   `buscarOfertas()` em `lib/cacador.js` com a chamada real de uma das opções
   do item 1.

3. **Persistência e histórico entre dispositivos.**
   Hoje o histórico de ofertas geradas fica salvo só no navegador. Para
   acessar de qualquer aparelho, ou ter login de usuário, é aqui que entra o
   Firebase (Firestore + Auth) — você decide resolver essa parte depois,
   como combinado.

4. **Hospedagem do backend.**
   Hoje ele só roda na sua máquina. Para o painel funcionar de qualquer lugar
   (e o cron rodar 24h de verdade, mesmo com seu computador desligado),
   precisa subir esse backend em algo como Railway ou Render — é simples,
   é só conectar o repositório e configurar as variáveis de ambiente do
   `.env.example`.

5. **CORS em produção.**
   O servidor está liberado para qualquer origem (`cors()` sem restrição) só
   para facilitar o teste agora. Quando for para produção, troque por
   `cors({ origin: "https://seu-dominio-do-painel.com" })`.
