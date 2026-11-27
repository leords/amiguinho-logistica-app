// src/logistica/utils/date.js

/**
 * Retorna a data atual no formato ISO 'YYYY-MM-DD' ajustada para o fuso horário oficial do Brasil (UTC-3).
 * Garante que a data seja consistente mesmo se o aparelho do motorista estiver com relógio/fuso desajustado.
 */
export const obterDataHojeIsoBrasil = () => {
  const agora = new Date();
  try {
    const partes = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(agora);

    const ano = partes.find((p) => p.type === 'year')?.value;
    const mes = partes.find((p) => p.type === 'month')?.value;
    const dia = partes.find((p) => p.type === 'day')?.value;

    return `${ano}-${mes}-${dia}`;
  } catch {
    // Fallback caso Intl não esteja disponível no ambiente JS runtime
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset() - 180); // UTC-3
    return d.toISOString().slice(0, 10);
  }
};

/**
 * Retorna a data atual formatada como 'DD/MM/AAAA' para exibição visual ao usuário.
 */
export const obterDataHojeFormatadaPtBr = () => {
  const [ano, mes, dia] = obterDataHojeIsoBrasil().split('-');
  return `${dia}/${mes}/${ano}`;
};

/**
 * Verifica se uma data (em string ISO ou Date) pertence ao dia de hoje no fuso horário do Brasil.
 */
export const ehDataDeHoje = (data) => {
  if (!data) return false;
  const hoje = obterDataHojeIsoBrasil();
  const dataStr = typeof data === 'string' ? data.slice(0, 10) : new Date(data).toISOString().slice(0, 10);
  return dataStr === hoje;
};
