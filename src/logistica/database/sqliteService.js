// src/logistica/database/sqliteService.js
import * as SQLite from 'expo-sqlite';
import { STATUS_PEDIDO, STATUS_JORNADA, STATUS_SYNC } from '../config/constants';

const DB_NAME = 'amiguinho_logistica.db';

let dbInstance = null;
let inicializacaoPromise = null;

/**
 * Obtém a conexão ativa com o banco SQLite local do Expo.
 * Inicializa a instância de forma preguiçosa e segura.
 */
export const obterBanco = async () => {
  if (dbInstance) return dbInstance;

  if (!inicializacaoPromise) {
    inicializacaoPromise = (async () => {
      try {
        const db = await SQLite.openDatabaseAsync(DB_NAME);
        dbInstance = db;
        await configurarEsquema(db);
        return db;
      } catch (error) {
        console.error('[sqliteService] Erro crítico ao abrir banco SQLite:', error);
        inicializacaoPromise = null;
        throw error;
      }
    })();
  }

  return inicializacaoPromise;
};

/**
 * Inicializa o banco de dados e cria as 4 tabelas essenciais da operação Offline-First.
 */
const configurarEsquema = async (db) => {
  // Ativa modo WAL (Write-Ahead Logging) para alta concorrência e performance
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');

  // 1. Tabela de carga do dia (pedidos)
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS carga_pedidos (
      pedidoId TEXT PRIMARY KEY,
      numero INTEGER,
      valorTotal REAL,
      formaPagamento TEXT,
      status TEXT DEFAULT '${STATUS_PEDIDO.PENDENTE}',
      clienteId TEXT,
      clienteNome TEXT,
      clienteEndereco TEXT,
      clienteLatitude REAL,
      clienteLongitude REAL,
      gpsConfirmado INTEGER DEFAULT 0,
      itensJson TEXT
    );
  `);

  // 2. Tabela de jornadas locais
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS jornadas_locais (
      id TEXT PRIMARY KEY,
      veiculoId TEXT,
      dataInicio TEXT,
      dataFim TEXT,
      status TEXT DEFAULT '${STATUS_JORNADA.EM_ANDAMENTO}',
      sincronizado INTEGER DEFAULT 0
    );
  `);

  // 3. Tabela de coordenadas de telemetria GPS
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS localizacoes_locais (
      id TEXT PRIMARY KEY,
      jornadaId TEXT,
      latitude REAL,
      longitude REAL,
      precisao REAL,
      velocidade REAL,
      dataHora TEXT,
      statusSync TEXT DEFAULT '${STATUS_SYNC.PENDENTE}'
    );
    CREATE INDEX IF NOT EXISTS idx_loc_sync ON localizacoes_locais(statusSync, dataHora);
    CREATE INDEX IF NOT EXISTS idx_loc_jornada ON localizacoes_locais(jornadaId);
  `);

  // 4. Tabela de fila de eventos transacionais (FIFO)
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS fila_eventos (
      id TEXT PRIMARY KEY,
      tipoDestino TEXT,
      payloadJson TEXT,
      tentativas INTEGER DEFAULT 0,
      statusSync TEXT DEFAULT '${STATUS_SYNC.PENDENTE}',
      criadoEm TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_fila_sync ON fila_eventos(statusSync, criadoEm);
  `);

  // Restaura qualquer item que tenha ficado travado em 'ENVIANDO' por encerramento abrupto do app
  await db.runAsync(`
    UPDATE localizacoes_locais SET statusSync = '${STATUS_SYNC.PENDENTE}' WHERE statusSync = '${STATUS_SYNC.ENVIANDO}';
  `);
  await db.runAsync(`
    UPDATE fila_eventos SET statusSync = '${STATUS_SYNC.PENDENTE}' WHERE statusSync = '${STATUS_SYNC.ENVIANDO}';
  `);

  console.log('[sqliteService] Banco local SQLite pronto com 4 tabelas.');
};

/**
 * Inicialização explícita exportada para ser chamada no boot do app.
 */
export const inicializarBanco = async () => {
  return await obterBanco();
};

export const initDatabase = inicializarBanco;

/* ==========================================================================
   MÉTODOS CRUD: CARGA DE PEDIDOS (carga_pedidos)
   ========================================================================== */

/**
 * Salva ou atualiza a lista de pedidos baixada da API Principal.
 * Utiliza INSERT OR REPLACE para garantir integridade e idempotência.
 */
export const salvarCargaPedidos = async (pedidos) => {
  const db = await obterBanco();
  if (!Array.isArray(pedidos) || pedidos.length === 0) return 0;

  let inseridos = 0;
  for (const p of pedidos) {
    const pedidoId = String(p.pedidoId || p.id || p.uuid || '');
    const numero = Number(p.numero || p.id || 0);
    const valorTotal = Number(p.valorTotal || p.total || p.valor || 0);
    const formaPagamento = String(p.formaPagamento || p.forma_pagamento || 'DINHEIRO');
    const status = String(p.status || STATUS_PEDIDO.PENDENTE).toUpperCase();
    const clienteId = String(p.clienteId || p.cliente_id || p.cliente?.id || '');
    const clienteNome = String(p.clienteNome || p.cliente?.nome || p.cliente?.razao_social || 'Cliente');
    const clienteEndereco = String(p.clienteEndereco || p.cliente?.endereco || p.endereco || '');
    const clienteLatitude = p.clienteLatitude ?? p.cliente?.latitude ?? null;
    const clienteLongitude = p.clienteLongitude ?? p.cliente?.longitude ?? null;
    const gpsConfirmado = (p.gpsConfirmado === 1 || p.gpsConfirmado === true || p.cliente?.gpsConfirmado) ? 1 : 0;
    const itensJson = typeof p.itens === 'object' ? JSON.stringify(p.itens) : (p.itensJson || '[]');

    await db.runAsync(
      `INSERT OR REPLACE INTO carga_pedidos (
        pedidoId, numero, valorTotal, formaPagamento, status,
        clienteId, clienteNome, clienteEndereco, clienteLatitude, clienteLongitude,
        gpsConfirmado, itensJson
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pedidoId, numero, valorTotal, formaPagamento, status,
        clienteId, clienteNome, clienteEndereco, clienteLatitude, clienteLongitude,
        gpsConfirmado, itensJson
      ]
    );
    inseridos++;
  }

  return inseridos;
};

/**
 * Limpa todos os pedidos da carga atual do banco local.
 * Deve ser chamado antes de baixar uma nova carga para evitar mistura com cargas antigas.
 */
export const limparCargaPedidos = async () => {
  const db = await obterBanco();
  return await db.runAsync('DELETE FROM carga_pedidos');
};

/**
 * Lista pedidos locais, com filtro opcional de status ('PENDENTE', 'ENTREGUE', etc.).
 */
export const listarPedidosLocais = async (filtroStatus = null) => {
  const db = await obterBanco();
  let query = 'SELECT * FROM carga_pedidos';
  const params = [];

  if (filtroStatus) {
    query += ' WHERE status = ?';
    params.push(filtroStatus);
  }

  query += ' ORDER BY numero ASC';
  return await db.getAllAsync(query, params);
};

/**
 * Obtém os dados de um pedido específico por ID.
 */
export const obterPedidoPorId = async (pedidoId) => {
  const db = await obterBanco();
  return await db.getFirstAsync(
    'SELECT * FROM carga_pedidos WHERE pedidoId = ? LIMIT 1',
    [String(pedidoId)]
  );
};

/**
 * Atualiza o status de entrega do pedido no banco local de forma imediata (0ms de latência).
 */
export const atualizarStatusPedido = async (pedidoId, novoStatus) => {
  const db = await obterBanco();
  return await db.runAsync(
    'UPDATE carga_pedidos SET status = ? WHERE pedidoId = ?',
    [novoStatus, String(pedidoId)]
  );
};

/**
 * Atualiza as coordenadas do cliente e marca GPS como confirmado no pedido.
 */
export const atualizarGpsClienteNoPedido = async (pedidoId, latitude, longitude, gpsConfirmado = 1) => {
  const db = await obterBanco();
  return await db.runAsync(
    `UPDATE carga_pedidos 
     SET clienteLatitude = ?, clienteLongitude = ?, gpsConfirmado = ? 
     WHERE pedidoId = ?`,
    [latitude, longitude, gpsConfirmado ? 1 : 0, String(pedidoId)]
  );
};

/**
 * Retorna contagem analítica dos pedidos da carga.
 */
export const obterResumoCarga = async () => {
  const db = await obterBanco();
  const total = await db.getFirstAsync('SELECT COUNT(*) as count, SUM(valorTotal) as valorTotal FROM carga_pedidos');
  const pendentes = await db.getFirstAsync(`SELECT COUNT(*) as count FROM carga_pedidos WHERE status = '${STATUS_PEDIDO.PENDENTE}'`);
  const entregues = await db.getFirstAsync(`SELECT COUNT(*) as count FROM carga_pedidos WHERE status = '${STATUS_PEDIDO.ENTREGUE}'`);
  const naoEntregues = await db.getFirstAsync(`SELECT COUNT(*) as count FROM carga_pedidos WHERE status = '${STATUS_PEDIDO.NAO_ENTREGUE}'`);

  return {
    total: total?.count || 0,
    valorTotal: total?.valorTotal || 0,
    pendentes: pendentes?.count || 0,
    entregues: entregues?.count || 0,
    naoEntregues: naoEntregues?.count || 0
  };
};

/* ==========================================================================
   MÉTODOS CRUD: JORNADAS LOCAIS (jornadas_locais)
   ========================================================================== */

/**
 * Registra o início de uma nova jornada no banco local.
 */
export const criarJornadaLocal = async ({ id, veiculoId, dataInicio }) => {
  const db = await obterBanco();
  await db.runAsync(
    `INSERT INTO jornadas_locais (id, veiculoId, dataInicio, status, sincronizado) 
     VALUES (?, ?, ?, '${STATUS_JORNADA.EM_ANDAMENTO}', 0)`,
    [id, veiculoId || 'PADRAO', dataInicio || new Date().toISOString()]
  );
  return await obterJornadaPorId(id);
};

/**
 * Obtém a jornada atualmente em andamento (se houver).
 */
export const obterJornadaAtiva = async () => {
  const db = await obterBanco();
  return await db.getFirstAsync(
    `SELECT * FROM jornadas_locais WHERE status = '${STATUS_JORNADA.EM_ANDAMENTO}' ORDER BY dataInicio DESC LIMIT 1`
  );
};

/**
 * Busca uma jornada pelo ID.
 */
export const obterJornadaPorId = async (id) => {
  const db = await obterBanco();
  return await db.getFirstAsync('SELECT * FROM jornadas_locais WHERE id = ? LIMIT 1', [id]);
};

/**
 * Encerra uma jornada no banco local.
 */
export const finalizarJornadaLocal = async (id, dataFim = null) => {
  const db = await obterBanco();
  const dataTermino = dataFim || new Date().toISOString();
  await db.runAsync(
    `UPDATE jornadas_locais 
     SET status = '${STATUS_JORNADA.FINALIZADA}', dataFim = ?, sincronizado = 0 
     WHERE id = ?`,
    [dataTermino, id]
  );
  return await obterJornadaPorId(id);
};

/**
 * Marca uma jornada como sincronizada com o backend.
 */
export const marcarJornadaSincronizada = async (id) => {
  const db = await obterBanco();
  return await db.runAsync('UPDATE jornadas_locais SET sincronizado = 1 WHERE id = ?', [id]);
};

/* ==========================================================================
   MÉTODOS CRUD: TELEMETRIA GPS (localizacoes_locais)
   ========================================================================== */

/**
 * Grava um ponto de telemetria GPS capturado pelo TaskManager.
 */
export const inserirLocalizacao = async ({
  id,
  jornadaId,
  latitude,
  longitude,
  precisao,
  velocidade,
  dataHora,
  statusSync = STATUS_SYNC.PENDENTE
}) => {
  const db = await obterBanco();
  return await db.runAsync(
    `INSERT INTO localizacoes_locais (id, jornadaId, latitude, longitude, precisao, velocidade, dataHora, statusSync)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, jornadaId, latitude, longitude, precisao || 0, velocidade || 0, dataHora, statusSync]
  );
};

/**
 * Busca até N localizações com status 'PENDENTE' para envio em lote (FIFO).
 */
export const obterLocalizacoesPendentes = async (limite = 100) => {
  const db = await obterBanco();
  return await db.getAllAsync(
    `SELECT * FROM localizacoes_locais 
     WHERE statusSync = '${STATUS_SYNC.PENDENTE}' 
     ORDER BY dataHora ASC 
     LIMIT ?`,
    [limite]
  );
};

/**
 * Atualiza o status de sincronização de uma lista de IDs de localização.
 */
export const atualizarStatusLocalizacoes = async (ids, novoStatus) => {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const db = await obterBanco();
  const placeholders = ids.map(() => '?').join(',');
  return await db.runAsync(
    `UPDATE localizacoes_locais SET statusSync = ? WHERE id IN (${placeholders})`,
    [novoStatus, ...ids]
  );
};

/**
 * Conta os pontos de GPS pendentes de envio.
 */
export const contarLocalizacoesPendentes = async () => {
  const db = await obterBanco();
  const res = await db.getFirstAsync(
    `SELECT COUNT(*) as count FROM localizacoes_locais WHERE statusSync = '${STATUS_SYNC.PENDENTE}'`
  );
  return res?.count || 0;
};

/**
 * Limpa registros antigos já sincronizados para evitar consumo excessivo de disco.
 */
export const limparLocalizacoesSincronizadas = async (diasRetencao = 3) => {
  const db = await obterBanco();
  const dataCorte = new Date(Date.now() - diasRetencao * 24 * 60 * 60 * 1000).toISOString();
  return await db.runAsync(
    `DELETE FROM localizacoes_locais 
     WHERE statusSync = '${STATUS_SYNC.SINCRONIZADO}' AND dataHora < ?`,
    [dataCorte]
  );
};

/* ==========================================================================
   MÉTODOS CRUD: FILA DE EVENTOS TRANSACIONAIS (fila_eventos)
   ========================================================================== */

/**
 * Adiciona uma ação transacional na fila de sincronização (FIFO).
 */
export const enfileirarEvento = async ({ id, tipoDestino, payloadJson }) => {
  const db = await obterBanco();
  const criadoEm = new Date().toISOString();
  const payloadString = typeof payloadJson === 'string' ? payloadJson : JSON.stringify(payloadJson);

  return await db.runAsync(
    `INSERT INTO fila_eventos (id, tipoDestino, payloadJson, tentativas, statusSync, criadoEm)
     VALUES (?, ?, ?, 0, '${STATUS_SYNC.PENDENTE}', ?)`,
    [id, tipoDestino, payloadString, criadoEm]
  );
};

/**
 * Obtém eventos pendentes na fila em ordem cronológica (FIFO).
 */
export const obterEventosPendentes = async (limite = 20) => {
  const db = await obterBanco();
  return await db.getAllAsync(
    `SELECT * FROM fila_eventos 
     WHERE statusSync = '${STATUS_SYNC.PENDENTE}' 
     ORDER BY criadoEm ASC 
     LIMIT ?`,
    [limite]
  );
};

/**
 * Atualiza o status de sincronização de um evento na fila.
 */
export const atualizarStatusEvento = async (id, statusSync, incrementarTentativa = false) => {
  const db = await obterBanco();
  if (incrementarTentativa) {
    return await db.runAsync(
      `UPDATE fila_eventos 
       SET statusSync = ?, tentativas = tentativas + 1 
       WHERE id = ?`,
      [statusSync, id]
    );
  } else {
    return await db.runAsync(
      'UPDATE fila_eventos SET statusSync = ? WHERE id = ?',
      [statusSync, id]
    );
  }
};

/**
 * Conta eventos pendentes na fila.
 */
export const contarEventosPendentes = async () => {
  const db = await obterBanco();
  const res = await db.getFirstAsync(
    `SELECT COUNT(*) as count FROM fila_eventos WHERE statusSync = '${STATUS_SYNC.PENDENTE}'`
  );
  return res?.count || 0;
};

/**
 * Retorna o resumo total das pendências para a barra de status.
 */
export const obterResumoFilaSync = async () => {
  const [pontosGps, eventos] = await Promise.all([
    contarLocalizacoesPendentes(),
    contarEventosPendentes()
  ]);

  return {
    pontosGpsPendentes: pontosGps,
    eventosPendentes: eventos,
    totalPendencias: pontosGps + eventos
  };
};

/**
 * Calcula a distância real acumulada em km de uma jornada a partir dos pontos gravados no SQLite local.
 */
export const calcularDistanciaJornadaKm = async (jornadaId) => {
  try {
    const db = await obterBanco();
    const pontos = await db.getAllAsync(
      `SELECT latitude, longitude, precisao FROM localizacoes_locais WHERE jornadaId = ? ORDER BY dataHora ASC`,
      [jornadaId]
    );
    if (!pontos || pontos.length < 2) return 0;

    let metrosTotal = 0;
    let ultimo = null;
    for (let i = 0; i < pontos.length; i++) {
      const p = pontos[i];
      if (p.precisao && Number(p.precisao) > 40 && i !== 0 && i !== pontos.length - 1) continue;
      if (!ultimo) {
        ultimo = p;
        continue;
      }
      const R = 6371e3;
      const dLat = ((p.latitude - ultimo.latitude) * Math.PI) / 180;
      const dLon = ((p.longitude - ultimo.longitude) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((ultimo.latitude * Math.PI) / 180) *
          Math.cos((p.latitude * Math.PI) / 180) *
          Math.sin(dLon / 2) ** 2;
      const d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      if (d >= 10 || i === pontos.length - 1) {
        metrosTotal += d;
        ultimo = p;
      }
    }
    return Number((metrosTotal / 1000).toFixed(2));
  } catch (err) {
    console.warn('[sqliteService] Erro ao calcular distancia acumulada da jornada:', err.message);
    return 0;
  }
};
