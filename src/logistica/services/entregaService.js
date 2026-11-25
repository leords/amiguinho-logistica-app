// src/logistica/services/entregaService.js
import { BLINDAGEM_GPS, STATUS_PEDIDO, TIPO_DESTINO_FILA, TIPO_EVENTO } from '../config/constants';
import * as sqliteService from '../database/sqliteService';
import { capturarPosicaoInstantanea } from './locationTaskService';
import { dispararSincronizacaoSeConectado } from './syncService';
import { gerarUUID } from '../utils/uuid';

/**
 * Avalia se o ponto de localização atende aos critérios da Blindagem Anti-Erro / Anti-WhatsApp:
 * 1. Precisão estrita de alta fidelidade: precisao <= 25 metros
 * 2. Motorista parado ou em passo humano: velocidade < 1.5 m/s (~5.4 km/h)
 */
export const validarBlindagemGps = (precisao, velocidade) => {
  const precisaoValida = typeof precisao === 'number' && precisao > 0 && precisao <= BLINDAGEM_GPS.MAX_PRECISAO_METROS;
  const velocidadeValida = typeof velocidade === 'number' && velocidade >= 0 && velocidade < BLINDAGEM_GPS.MAX_VELOCIDADE_MPS;

  return {
    passou: precisaoValida && velocidadeValida,
    motivos: {
      precisaoOk: precisaoValida,
      velocidadeOk: velocidadeValida,
      precisao,
      velocidade
    }
  };
};

/**
 * Realiza o fluxo completo de baixa de um pedido:
 * 1. Captura a localização atual via GPS de alta precisão.
 * 2. Executa a blindagem anti-erro do GPS do cliente.
 * 3. Atualiza o pedido localmente para 'ENTREGUE' no SQLite (0ms de latência percebida pelo motorista).
 * 4. Enfileira Tarefa 1 (API Principal) e Tarefa 2 (API Logística).
 * 5. Dispara tentativa imediata de sincronização caso haja conexão.
 */
export const registrarBaixaEntrega = async (pedidoId, opcoes = {}) => {
  const dataHoraIso = new Date().toISOString();

  // 1. Busca os dados do pedido no banco local
  const pedido = await sqliteService.obterPedidoPorId(pedidoId);
  if (!pedido) {
    throw new Error(`Pedido com ID ${pedidoId} não foi encontrado na base local.`);
  }

  // 2. Captura a posição instantânea via GPS
  let posicao = null;
  let erroGps = null;

  try {
    posicao = await capturarPosicaoInstantanea();
  } catch (err) {
    erroGps = err.message;
    console.warn('[entregaService] GPS não pôde ser obtido no momento da baixa:', erroGps);
    // Coordenadas neutras para não impedir a baixa em locais sem visada de satélite (ex: subsolo)
    posicao = {
      latitude: pedido.clienteLatitude || 0,
      longitude: pedido.clienteLongitude || 0,
      precisao: 999,
      velocidade: 0
    };
  }

  // 3. Aplica a Blindagem Anti-Erro / Anti-WhatsApp
  const { passou: passouNaBlindagem, motivos } = validarBlindagemGps(posicao.precisao, posicao.velocidade);
  const gpsJaConfirmado = pedido.gpsConfirmado === 1;
  const deveAtualizarCliente = Boolean(passouNaBlindagem && !gpsJaConfirmado);

  console.log(`[entregaService] Blindagem GPS do Pedido ${pedido.numero || pedidoId}:`, {
    passouNaBlindagem,
    gpsJaConfirmado,
    deveAtualizarCliente,
    motivos
  });

  // 4. Atualiza o status no SQLite local imediatamente (experiência 100% offline instantânea)
  await sqliteService.atualizarStatusPedido(pedidoId, STATUS_PEDIDO.ENTREGUE);

  // Se o GPS do cliente deve ser atualizado, reflete já na base local
  if (deveAtualizarCliente) {
    await sqliteService.atualizarGpsClienteNoPedido(
      pedidoId,
      posicao.latitude,
      posicao.longitude,
      1
    );
  }

  // 5. Identifica a jornada ativa
  const jornadaAtiva = await sqliteService.obterJornadaAtiva();
  const jornadaId = jornadaAtiva ? jornadaAtiva.id : (pedido.jornadaId || 'JORNADA_AVULSA');

  // 6. Enfileira Tarefa 1: API PRINCIPAL (Baixa Comercial + Atualização Cadastral de GPS do Cliente)
  const eventoPrincipalId = gerarUUID();
  const payloadPrincipal = {
    pedidoId: pedido.pedidoId,
    status: STATUS_PEDIDO.ENTREGUE,
    dataHora: dataHoraIso,
    formaPagamento: pedido.formaPagamento,
    valorTotal: pedido.valorTotal,
    latitude: posicao.latitude,
    longitude: posicao.longitude,
    precisao: posicao.precisao,
    atualizarGpsCliente: deveAtualizarCliente,
    gpsConfirmado: deveAtualizarCliente
  };

  await sqliteService.enfileirarEvento({
    id: eventoPrincipalId,
    tipoDestino: TIPO_DESTINO_FILA.API_PRINCIPAL_BAIXA,
    payloadJson: payloadPrincipal
  });

  // 7. Enfileira Tarefa 2: API LOGÍSTICA (Evento Operacional de Rota)
  const eventoLogisticaId = gerarUUID();
  const payloadLogistica = {
    id: eventoLogisticaId,
    jornadaId,
    pedidoId: pedido.pedidoId,
    tipoEvento: TIPO_EVENTO.BAIXA_ENTREGA,
    latitude: posicao.latitude,
    longitude: posicao.longitude,
    precisao: posicao.precisao,
    velocidade: posicao.velocidade,
    dataHora: dataHoraIso,
    observacao: opcoes.observacao || null
  };

  await sqliteService.enfileirarEvento({
    id: eventoLogisticaId,
    tipoDestino: TIPO_DESTINO_FILA.API_LOGISTICA_EVENTO,
    payloadJson: payloadLogistica
  });

  // 8. Dispara o sincronizador imediatamente (caso haja sinal de internet)
  dispararSincronizacaoSeConectado();

  return {
    sucesso: true,
    pedidoId,
    novoStatus: STATUS_PEDIDO.ENTREGUE,
    deveAtualizarCliente,
    blindagem: {
      passouNaBlindagem,
      motivos
    },
    posicao
  };
};

/**
 * Registra a não-entrega de um pedido (ex: cliente ausente, endereço incorreto).
 */
export const registrarNaoEntrega = async (pedidoId, motivo = 'CLIENTE_AUSENTE') => {
  const dataHoraIso = new Date().toISOString();
  const pedido = await sqliteService.obterPedidoPorId(pedidoId);
  if (!pedido) {
    throw new Error(`Pedido com ID ${pedidoId} não foi encontrado.`);
  }

  let posicao = { latitude: 0, longitude: 0, precisao: 999, velocidade: 0 };
  try {
    posicao = await capturarPosicaoInstantanea();
  } catch (_) {}

  await sqliteService.atualizarStatusPedido(pedidoId, STATUS_PEDIDO.NAO_ENTREGUE);

  const jornadaAtiva = await sqliteService.obterJornadaAtiva();
  const jornadaId = jornadaAtiva ? jornadaAtiva.id : 'JORNADA_AVULSA';

  // Evento na API Principal
  await sqliteService.enfileirarEvento({
    id: gerarUUID(),
    tipoDestino: TIPO_DESTINO_FILA.API_PRINCIPAL_BAIXA,
    payloadJson: {
      pedidoId,
      status: STATUS_PEDIDO.NAO_ENTREGUE,
      motivo,
      dataHora: dataHoraIso
    }
  });

  // Evento na API Logística
  await sqliteService.enfileirarEvento({
    id: gerarUUID(),
    tipoDestino: TIPO_DESTINO_FILA.API_LOGISTICA_EVENTO,
    payloadJson: {
      id: gerarUUID(),
      jornadaId,
      pedidoId,
      tipoEvento: motivo === 'CLIENTE_AUSENTE' ? TIPO_EVENTO.CLIENTE_AUSENTE : TIPO_EVENTO.RETORNO_MERCADORIA,
      latitude: posicao.latitude,
      longitude: posicao.longitude,
      precisao: posicao.precisao,
      velocidade: posicao.velocidade,
      dataHora: dataHoraIso,
      motivo
    }
  });

  dispararSincronizacaoSeConectado();

  return {
    sucesso: true,
    pedidoId,
    novoStatus: STATUS_PEDIDO.NAO_ENTREGUE
  };
};
