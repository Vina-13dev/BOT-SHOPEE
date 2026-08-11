// score.js — pontuação de qualidade da oferta (0–100)
function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function calcularScoreOferta(oferta = {}) {
  const desconto = Number(oferta.descontoPct ?? 0);
  const comissao = Number(oferta.comissaoPct ?? 0);
  const nota = Number(oferta.nota ?? 0);
  const vendas = Number(oferta.vendas ?? 0);

  let score = 0;

  if (desconto >= 60) score += 30;
  else if (desconto >= 50) score += 27;
  else if (desconto >= 40) score += 24;
  else if (desconto >= 30) score += 18;
  else if (desconto >= 25) score += 12;

  if (comissao >= 15) score += 20;
  else if (comissao >= 12) score += 17;
  else if (comissao >= 9) score += 14;
  else if (comissao >= 6) score += 10;
  else if (comissao >= 5) score += 7;
  else if (comissao > 0) score += 3;

  if (nota > 0) {
    if (nota >= 4.8) score += 15;
    else if (nota >= 4.7) score += 13;
    else if (nota >= 4.6) score += 11;
    else if (nota >= 4.5) score += 8;
    else score += 3;
  }

  if (vendas > 0) {
    if (vendas >= 5000) score += 15;
    else if (vendas >= 1000) score += 13;
    else if (vendas >= 500) score += 11;
    else if (vendas >= 100) score += 8;
    else score += 4;
  }

  if (oferta.freteGratis === true) score += 10;
  if (oferta.ehMenorPreco === true) score += 10;

  const total = clamp(score);
  let nivel = 'FRACA';
  let icone = '⚪';
  if (total >= 90) { nivel = 'EXCELENTE'; icone = '🚨'; }
  else if (total >= 80) { nivel = 'MUITO BOA'; icone = '🔥'; }
  else if (total >= 70) { nivel = 'BOA'; icone = '🟢'; }
  else if (total >= 60) { nivel = 'REGULAR'; icone = '🟡'; }

  return { score: total, nivel, icone };
}

module.exports = { calcularScoreOferta };
