// src/logistica/services/syncService.js
import NetInfo from '@react-native-community/netinfo';
import {
  SYNC_CONFIG,
  STATUS_SYNC,
  TIPO_DESTINO_FILA,
  TIPO_EVENTO
} from '../config/constants';
import {
  getApiPrincipalUrl,
  getApiLogisticaUrl,
  montarHeadersAutenticados,
  obterToken
} from '../config/apiConfig';
import * as sqliteService from '../database/sqliteService';

// Estado em memória do serviço de sincronização
let estaOnline = true;
let sincronizacaoEmAndamento = false;
let intervaloTimer = null;
let ultimaSincronizacao = null;
const ouvintes = new Set();

/**
 * Notifica todos os componentes registrados sobre mudanças de estado ou contagens.
 */
const notificarOuvintes = async () => {
  try {
    const pendencias = await sqliteService.obterResumoFilaSync();
    const dados = {
      estaOnline,
      sincronizacaoEmAndamento,
      ultimaSincronizacao,
      ...pendencias
    };
    ouvintes.forEach((fn) => {
      try {
        fn(dados);
      } catch (err) {
        console.warn('[syncService] Erro em listener:', err);
      }
    });
  } catch (err) {
    console.warn('[syncService] Falha ao obter resumo de pendências:', err.message);
  }
};

/**
 * Registra um callback para receber atualizações do estado da sincronização em tempo real.
 */
export const adicionarOuvinteSync = (callback) => {
  if (typeof callback === 'function') {
    ouvintes.add(callback);
    // Notifica imediatamente o estado atual
    notificarOuvintes();
  }
  return () => removerOuvinteSync(callback);
};

export const removerOuvinteSync = (callback) => {
  ouvintes.delete(callback);
};

/**
 * Inicializa os monitores de rede e o ciclo periódico de sincronização.
 */
export const iniciarMonitorSincronizacao = () => {
  // 1. Escuta alterações de conectividade em tempo real via NetInfo
  NetInfo.addEventListener((state) => {
    const conectado = Boolean(state.isConnected);
    const mudouDeOfflineParaOnline = !estaOnline && conectado;
    estaOnline = conectado;

    console.log(`[syncService] Rede alterada: ${estaOnline ? 'ONLINE' : 'OFFLINE'}`);
    notificarOuvintes();

    // Ao recuperar o sinal, processa imediatamente a fila represada
    if (mudouDeOfflineParaOnline) {
      processarFilaSincronizacao();
    }
  });

  // 2. Timer periódico (a cada 30s) para manter a telemetria fluindo continuamente
  if (!intervaloTimer) {
    intervaloTimer = setInterval(() => {
      if (estaOnline && !sincronizacaoEmAndamento) {
        processarFilaSincronizacao();
      }
    }, 30000); // 30 segundos
  }

  // Verifica estado inicial
  NetInfo.fetch().then((state) => {
    estaOnline = Boolean(state.isConnected);
    notificarOuvintes();
  });
};

/**
 * Para o monitoramento periódico (ex: ao deslogar).
 */
export const pararMonitorSincronizacao = () => {
  if (intervaloTimer) {
    clearInterval(intervaloTimer);
    intervaloTimer = null;
  }
};

/**
 * Disparo não-bloqueante acionado após eventos operacionais (como baixa de entregas).
 */
export const dispararSincronizacaoSeConectado = () => {
  if (estaOnline && !sincronizacaoEmAndamento) {
    // Executa de forma assíncrona sem travar a thread de UI
    setTimeout(() => {
      processarFilaSincronizacao().catch((err) =>
        console.warn('[syncService] Erro na sincronização disparada:', err.message)
      );
    }, 100);
  }
};

/**
 * MOTOR PRINCIPAL DE SINCRONIZAÇÃO:
 * Coordena o envio em lotes de telemetria GPS e os eventos da fila transacional.
 */
export const processarFilaSincronizacao = async () => {
  if (sincronizacaoEmAndamento) {
    console.log('[syncService] Sincronização já em execução. Aguardando término...');
    return;
  }

  // Verifica se há conectividade antes de gastar recursos
  const rede = await NetInfo.fetch();
  estaOnline = Boolean(rede.isConnected);
  if (!estaOnline) {
    console.log('[syncService] Sem conexão de internet. Dados permanecem protegidos no SQLite.');
    notificarOuvintes();
    return;
  }

  sincronizacaoEmAndamento = true;
  notificarOuvintes();

  try {
    // Etapa 1: Envia lotes de coordenadas GPS
    await sincronizarLotesGps();

    // Etapa 2: Processa a fila de eventos transacionais (baixas e jornadas)
    await sincronizarEventosTransacionais();

    ultimaSincronizacao = new Date().toISOString();
  } catch (error) {
    console.error('[syncService] Erro no ciclo de sincronização:', error.message);
  } finally {
    sincronizacaoEmAndamento = false;
    notificarOuvintes();
  }
};

/**
 * ENVIO DE COORDENADAS EM LOTE (API LOGÍSTICA):
 * Busca até 100 registros com statusSync = 'PENDENTE'.
 * Regra de Ouro: Só marca como 'SINCRONIZADO' após HTTP 200/201.
 * Em caso de falha, reverte para 'PENDENTE'.
 */
const sincronizarLotesGps = async () => {
  const BATCH_SIZE = SYNC_CONFIG.BATCH_SIZE_GPS;
  const pendentes = await sqliteService.obterLocalizacoesPendentes(BATCH_SIZE);

  if (!pendentes || pendentes.length === 0) {
    return;
  }

  // Agrupa pontos por jornadaId para envio consistente
  const pontosPorJornada = {};
  for (const ponto of pendentes) {
    if (!pontosPorJornada[ponto.jornadaId]) {
      pontosPorJornada[ponto.jornadaId] = [];
    }
    pontosPorJornada[ponto.jornadaId].push(ponto);
  }

  const apiLogisticaUrl = getApiLogisticaUrl();
  const headers = await montarHeadersAutenticados();

  for (const jornadaId of Object.keys(pontosPorJornada)) {
    const lote = pontosPorJornada[jornadaId];
    const ids = lote.map((p) => p.id);

    // Marca provisoriamente como 'ENVIANDO'
    await sqliteService.atualizarStatusLocalizacoes(ids, STATUS_SYNC.ENVIANDO);

    const payload = {
      jornadaId,
      coordenadas: lote.map((p) => ({
        id: p.id,
        latitude: p.latitude,
        longitude: p.longitude,
        precisao: p.precisao,
        velocidade: p.velocidade,
        dataHora: p.dataHora
      }))
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SYNC_CONFIG.TIMEOUT_REQUISICAO_MS);

      const response = await fetch(`${apiLogisticaUrl}/api/v1/localizacoes/lote`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      // REGRA DE OURO: Somente após 200 ou 201 marca como SINCRONIZADO
      if (response.ok) {
        await sqliteService.atualizarStatusLocalizacoes(ids, STATUS_SYNC.SINCRONIZADO);
        console.log(`[syncService] Lote de ${ids.length} coordenadas enviado com sucesso (Jornada: ${jornadaId}).`);
      } else {
        throw new Error(`Servidor respondeu HTTP ${response.status}`);
      }
    } catch (err) {
      console.warn(`[syncService] Falha ao enviar lote GPS. Revertendo ${ids.length} pontos para PENDENTE:`, err.message);
      // Reverte os registros para 'PENDENTE' sem perda de dados
      await sqliteService.atualizarStatusLocalizacoes(ids, STATUS_SYNC.PENDENTE);
      // Interrompe envio de outros lotes para não sobrecarregar
      break;
    }
  }

  // Limpa registros antigos já sincronizados (> 3 dias) para liberar espaço
  sqliteService.limparLocalizacoesSincronizadas(3).catch(() => {});
};

/**
 * PROCESSAMENTO FIFO DA FILA DE EVENTOS:
 * Roteia cada evento para a API correspondente e preserva a ordem cronológica.
 */
const sincronizarEventosTransacionais = async () => {
  const eventos = await sqliteService.obterEventosPendentes(20);
  if (!eventos || eventos.length === 0) return;

  const apiPrincipalUrl = getApiPrincipalUrl();
  const apiLogisticaUrl = getApiLogisticaUrl();
  const headers = await montarHeadersAutenticados();

  for (const item of eventos) {
    let payload = null;
    try {
      payload = typeof item.payloadJson === 'string' ? JSON.parse(item.payloadJson) : item.payloadJson;
    } catch (parseErr) {
      console.error('[syncService] Payload inválido no evento ID:', item.id, parseErr);
      await sqliteService.atualizarStatusEvento(item.id, STATUS_SYNC.SINCRONIZADO);
      continue;
    }

    // Marca como 'ENVIANDO'
    await sqliteService.atualizarStatusEvento(item.id, STATUS_SYNC.ENVIANDO);

    try {
      let respostaOk = false;

      // 1. EVENTOS PARA A API PRINCIPAL (Baixa Comercial e GPS do Cliente)
      if (item.tipoDestino === TIPO_DESTINO_FILA.API_PRINCIPAL_BAIXA) {
        respostaOk = await enviarBaixaApiPrincipal(apiPrincipalUrl, headers, payload);
      }
      // 1.1 CONCLUSÃO DE CARGA NA API PRINCIPAL
      else if (item.tipoDestino === TIPO_DESTINO_FILA.API_PRINCIPAL_CONCLUIR_CARGA) {
        respostaOk = await enviarConcluirCargaApiPrincipal(apiPrincipalUrl, headers, payload);
      }
      // 2. EVENTOS OPERACIONAIS PARA A API LOGÍSTICA
      else if (item.tipoDestino === TIPO_DESTINO_FILA.API_LOGISTICA_EVENTO) {
        respostaOk = await enviarEventoApiLogistica(apiLogisticaUrl, headers, payload);
      }
      // 3. CICLO DE VIDA DA JORNADA PARA A API LOGÍSTICA
      else if (item.tipoDestino === TIPO_DESTINO_FILA.API_LOGISTICA_JORNADA) {
        respostaOk = await enviarJornadaApiLogistica(apiLogisticaUrl, headers, payload);
      }

      if (respostaOk) {
        await sqliteService.atualizarStatusEvento(item.id, STATUS_SYNC.SINCRONIZADO);
        console.log(`[syncService] Evento ${item.tipoDestino} (ID: ${item.id}) sincronizado com sucesso.`);
      } else {
        throw new Error('Falha na resposta do endpoint de destino.');
      }
    } catch (error) {
      console.warn(`[syncService] Erro ao sincronizar evento ${item.tipoDestino} (tentativas + 1):`, error.message);
      // Reverte para 'PENDENTE' e incrementa tentativas para reprocessamento futuro
      await sqliteService.atualizarStatusEvento(item.id, STATUS_SYNC.PENDENTE, true);
      // Em falha de rede, não avança para os próximos eventos para manter estrita ordenação FIFO
      break;
    }
  }
};

/**
 * Envia confirmação de entrega de pedido externo para a API Principal (ERP Amiguinho).
 * Rota oficial: PATCH /pedidos/externo/:id/entregar
 */
const enviarBaixaApiPrincipal = async (baseUrl, headers, payload) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SYNC_CONFIG.TIMEOUT_REQUISICAO_MS);

  const identificador = payload.pedidoId; // Aceita ID numérico (ex: 138) ou UUID
  const urlOficial = `${baseUrl}/pedidos/externo/${identificador}/entregar`;

  try {
    let res = await fetch(urlOficial, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // Se o token expirou (401), renova silenciosamente e tenta mais uma vez
    if (res.status === 401) {
      console.warn('[syncService] Token expirado ao enviar baixa. Renovando silenciosamente...');
      const novoToken = await obterToken(true);
      if (novoToken) {
        const novosHeaders = await montarHeadersAutenticados();
        res = await fetch(urlOficial, {
          method: 'PATCH',
          headers: novosHeaders,
          body: JSON.stringify(payload)
        });
      }
    }

    // 200 (OK) ou 409 (Já entregue/idempotência) são considerados sucesso pleno
    if (res.ok || res.status === 409) {
      console.log(`[syncService] Pedido ${identificador} confirmado com sucesso na API Principal.`);
      return true;
    }

    // Se o pedido já tiver sido cancelado ou devolvido no ERP (HTTP 400),
    // considera processado para desobstruir a fila FIFO
    if (res.status === 400) {
      const errJson = await res.json().catch(() => ({}));
      const codigoErro = errJson?.erro?.codigo;
      if (codigoErro === 'PEDIDO_JA_DEVOLVIDO' || codigoErro === 'PEDIDO_JA_CANCELADO') {
        console.warn(`[syncService] Pedido ${identificador} já cancelado/devolvido no ERP. Baixa desobstruída:`, codigoErro);
        return true;
      }
    }

    // Fallback de contingência caso seja rota delivery legada
    if (res.status === 404) {
      const fallbackUrl = `${baseUrl}/finalizar-pedido-delivery/${identificador}`;
      const fallbackRes = await fetch(fallbackUrl, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          status: 'concluido',
          dataHora: payload.dataHora,
          latitude: payload.latitude,
          longitude: payload.longitude,
        })
      });
      return fallbackRes.ok || fallbackRes.status === 409;
    }

    return false;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
};

/**
 * Notifica a conclusão de uma carga para a API Principal (ERP Amiguinho).
 * Rota oficial: PATCH /cargas/:id/concluir
 */
const enviarConcluirCargaApiPrincipal = async (baseUrl, headers, payload) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SYNC_CONFIG.TIMEOUT_REQUISICAO_MS);

  const cargaId = payload.cargaId || payload.id;
  const urlOficial = `${baseUrl}/cargas/${cargaId}/concluir`;

  try {
    let res = await fetch(urlOficial, {
      method: 'PATCH',
      headers,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // Se o token expirou (401), renova silenciosamente e tenta mais uma vez
    if (res.status === 401) {
      console.warn('[syncService] Token expirado ao concluir carga. Renovando silenciosamente...');
      const novoToken = await obterToken(true);
      if (novoToken) {
        const novosHeaders = await montarHeadersAutenticados();
        res = await fetch(urlOficial, {
          method: 'PATCH',
          headers: novosHeaders
        });
      }
    }

    // 200 (OK) ou 400 com CARGA_JA_FINALIZADA são considerados sucesso pleno
    if (res.ok) {
      console.log(`[syncService] Carga #${cargaId} concluída com sucesso na API Principal.`);
      return true;
    }

    if (res.status === 400) {
      const errJson = await res.json().catch(() => ({}));
      const codigoErro = errJson?.erro?.codigo || errJson?.codigo;
      if (codigoErro === 'CARGA_JA_FINALIZADA') {
        console.warn(`[syncService] Carga #${cargaId} já se encontrava finalizada na API Principal.`);
        return true;
      }
    }

    return false;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
};

/**
 * Envia evento operacional para a API de Logística.
 */
const enviarEventoApiLogistica = async (baseUrl, headers, payload) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SYNC_CONFIG.TIMEOUT_REQUISICAO_MS);

  try {
    const url = `${baseUrl}/api/v1/jornadas/${payload.jornadaId}/eventos`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: payload.id,
        pedidoId: payload.pedidoId,
        tipoEvento: payload.tipoEvento || TIPO_EVENTO.BAIXA_ENTREGA,
        latitude: payload.latitude,
        longitude: payload.longitude,
        precisao: payload.precisao,
        velocidade: payload.velocidade,
        dataHora: payload.dataHora
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    return res.ok || res.status === 409;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
};

/**
 * Envia abertura ou encerramento de jornada para a API de Logística.
 */
const enviarJornadaApiLogistica = async (baseUrl, headers, payload) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SYNC_CONFIG.TIMEOUT_REQUISICAO_MS);

  try {
    let url = '';
    let body = {};

    if (payload.acao === 'INICIAR') {
      url = `${baseUrl}/api/v1/jornadas/iniciar`;
      body = {
        id: payload.id,
        veiculoId: payload.veiculoId,
        dataInicio: payload.dataInicio
      };
    } else {
      url = `${baseUrl}/api/v1/jornadas/${payload.id}/finalizar`;
      body = {
        dataFim: payload.dataFim,
        distanciaTotalKm: payload.distanciaTotalKm || 0
      };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    return res.ok || res.status === 409;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
};

/**
 * Retorna uma foto instantânea do status atual para componentes e hooks.
 */
export const obterStatusAtual = async () => {
  const resumo = await sqliteService.obterResumoFilaSync();
  return {
    estaOnline,
    sincronizacaoEmAndamento,
    ultimaSincronizacao,
    ...resumo
  };
};
