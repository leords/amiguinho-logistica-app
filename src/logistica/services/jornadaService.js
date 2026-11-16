// src/logistica/services/jornadaService.js
import { STATUS_JORNADA, TIPO_DESTINO_FILA } from '../config/constants';
import * as sqliteService from '../database/sqliteService';
import {
  iniciarRastreamentoGps,
  pararRastreamentoGps,
  verificarRastreamentoAtivo
} from './locationTaskService';
import { dispararSincronizacaoSeConectado } from './syncService';
import { gerarUUID } from '../utils/uuid';

/**
 * Inicia uma nova jornada de entregas:
 * 1. Gera UUID v4 local único.
 * 2. Grava a jornada no SQLite local (status 'EM_ANDAMENTO').
 * 3. Inicia o serviço de GPS contínuo em segundo plano (Foreground Service).
 * 4. Enfileira a notificação de abertura para a API Logística.
 */
export const iniciarJornada = async ({ veiculoId = 'VEICULO_PADRAO' } = {}) => {
  // 1. Verifica se já existe uma jornada em aberto
  const jornadaAtiva = await sqliteService.obterJornadaAtiva();
  if (jornadaAtiva) {
    // Garante que o rastreador esteja ativo
    await iniciarRastreamentoGps();
    return {
      jaExistente: true,
      jornada: jornadaAtiva
    };
  }

  const id = gerarUUID();
  const dataInicio = new Date().toISOString();

  // 2. Persiste localmente no SQLite
  const novaJornada = await sqliteService.criarJornadaLocal({
    id,
    veiculoId,
    dataInicio
  });

  // 3. Enfileira o evento de início para a API de Logística
  await sqliteService.enfileirarEvento({
    id: gerarUUID(),
    tipoDestino: TIPO_DESTINO_FILA.API_LOGISTICA_JORNADA,
    payloadJson: {
      acao: 'INICIAR',
      id,
      veiculoId,
      dataInicio
    }
  });

  // 4. Inicia a captura de GPS em segundo plano
  try {
    await iniciarRastreamentoGps();
  } catch (gpsErr) {
    console.warn('[jornadaService] Jornada iniciada, mas com alerta de GPS:', gpsErr.message);
  }

  // 5. Tenta sincronizar a abertura com o backend se houver internet
  dispararSincronizacaoSeConectado();

  return {
    jaExistente: false,
    jornada: novaJornada
  };
};

/**
 * Finaliza a jornada ativa de entregas:
 * 1. Encerra o rastreador de GPS em background.
 * 2. Atualiza status para 'FINALIZADA' no SQLite.
 * 3. Enfileira o evento de encerramento para a API Logística.
 * 4. Força sincronização final dos dados residuais.
 */
export const finalizarJornada = async ({ distanciaTotalKm = 0 } = {}) => {
  const jornadaAtiva = await sqliteService.obterJornadaAtiva();
  if (!jornadaAtiva) {
    throw new Error('Não há nenhuma jornada em andamento para ser finalizada.');
  }

  const dataFim = new Date().toISOString();

  // 1. Interrompe a coleta de GPS em background imediatamente
  await pararRastreamentoGps();

  // 2. Calcula a distância real percorrida gravada no SQLite local se não tiver sido informada
  let distFinalKm = Number(distanciaTotalKm || 0);
  if (distFinalKm <= 0) {
    distFinalKm = await sqliteService.calcularDistanciaJornadaKm(jornadaAtiva.id);
  }

  // 3. Atualiza a jornada no SQLite
  const jornadaEncerrada = await sqliteService.finalizarJornadaLocal(jornadaAtiva.id, dataFim);

  // 4. Enfileira encerramento para envio à API Logística
  await sqliteService.enfileirarEvento({
    id: gerarUUID(),
    tipoDestino: TIPO_DESTINO_FILA.API_LOGISTICA_JORNADA,
    payloadJson: {
      acao: 'FINALIZAR',
      id: jornadaAtiva.id,
      dataFim,
      distanciaTotalKm: distFinalKm
    }
  });

  // 4. Dispara sincronização imediata para limpar a fila
  dispararSincronizacaoSeConectado();

  return jornadaEncerrada;
};

/**
 * Consulta a jornada ativa e o estado do rastreamento.
 */
export const obterStatusJornada = async () => {
  const jornadaAtiva = await sqliteService.obterJornadaAtiva();
  const rastreamentoAtivo = await verificarRastreamentoAtivo();

  return {
    emAndamento: Boolean(jornadaAtiva),
    jornada: jornadaAtiva,
    rastreamentoAtivo
  };
};

/**
 * Garante que o rastreamento contínuo de 15 segundos esteja ativo se houver jornada em andamento.
 * Essencial para religar o timer/observador quando o app é reaberto ou recarregado.
 */
export const garantirRastreamentoAtivo = async () => {
  const jornadaAtiva = await sqliteService.obterJornadaAtiva();
  if (jornadaAtiva) {
    const jaAtivo = await verificarRastreamentoAtivo();
    if (!jaAtivo) {
      console.log('[jornadaService] Reativando rastreador GPS de 15s para a jornada em andamento:', jornadaAtiva.id);
      await iniciarRastreamentoGps().catch((err) =>
        console.warn('[jornadaService] Alerta ao reativar GPS:', err.message)
      );
    }
  }
};
