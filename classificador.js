// lib/classificador.js
// Bot Classificador — calcula desconto real, ganho estimado e os "tiers"
// (Alta/Média/Baixa comissão, Excelente/Boa/Fraca desconto).
//
// Extraído do server.js para poder ser reaproveitado também pelo script do
// Bot Caçador que roda no GitHub Actions (scripts/buscarOfertas.js), sem
// duplicar a mesma lógica em dois lugares.

function calcularOferta({ precoAntigo, precoAtual, comissaoPct }) {
  const descontoPct = ((precoAntigo - precoAtual) / precoAntigo) * 100;
  const ganhoEstimado = precoAtual * (comissaoPct / 100);

  const tierDesconto = descontoPct >= 50 ? "Excelente" : descontoPct >= 25 ? "Boa" : "Fraca";
  const tierComissao = comissaoPct >= 15 ? "Alta" : comissaoPct >= 7 ? "Média" : "Baixa";

  return {
    descontoPct: Math.round(descontoPct * 10) / 10,
    ganhoEstimado: Math.round(ganhoEstimado * 100) / 100,
    tierDesconto,
    tierComissao,
  };
}

module.exports = { calcularOferta };
