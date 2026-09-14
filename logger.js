// src/utils/logger.js
// Logger simples e estruturado. Nunca imprime segredos — qualquer chave de
// objeto que pareça sensível é trocada por "[oculto]" antes de logar,
// mesmo que alguém esqueça de filtrar na chamada.

const PADROES_SEGREDO = [
  "access_token", "app_secret", "service_account", "authorization",
  "verify_token", "password", "senha", "secret", "token",
];

function pareceSegredo(chave) {
  const k = chave.toLowerCase();
  return PADROES_SEGREDO.some((p) => k.includes(p));
}

function limparRecursivo(valor, profundidade = 0) {
  if (profundidade > 5 || valor === null || typeof valor !== "object") return valor;
  if (Array.isArray(valor)) return valor.map((v) => limparRecursivo(v, profundidade + 1));
  const copia = {};
  for (const chave of Object.keys(valor)) {
    copia[chave] = pareceSegredo(chave) ? "[oculto]" : limparRecursivo(valor[chave], profundidade + 1);
  }
  return copia;
}

function registrar(nivel, tag, mensagem, extra) {
  const linha = `[${new Date().toISOString()}] ${nivel.toUpperCase()} ${tag} ${mensagem}`;
  const fn = nivel === "error" ? console.error : nivel === "warn" ? console.warn : console.log;
  if (extra !== undefined) fn(linha, limparRecursivo(extra));
  else fn(linha);
}

module.exports = {
  info: (tag, mensagem, extra) => registrar("info", tag, mensagem, extra),
  warn: (tag, mensagem, extra) => registrar("warn", tag, mensagem, extra),
  error: (tag, mensagem, extra) => registrar("error", tag, mensagem, extra),
  _limparRecursivo: limparRecursivo, // exportado só pra testes
};
