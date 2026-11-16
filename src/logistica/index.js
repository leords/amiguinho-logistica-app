// src/logistica/index.js

/**
 * Módulo Completo de Operação Offline-First e Logística - Amiguinho Mobile
 * Arquitetura isolada, modular e resiliente para Expo / React Native.
 */

// Importa para registrar a task global de GPS no escopo raiz imediatamente
import './services/locationTaskService';

import * as sqliteService from './database/sqliteService';
import * as locationTaskService from './services/locationTaskService';
import * as syncService from './services/syncService';
import * as entregaService from './services/entregaService';
import * as jornadaService from './services/jornadaService';
import * as cargaService from './services/cargaService';

import { useSyncStatus } from './hooks/useSyncStatus';
import { useJornadaLogistica } from './hooks/useJornadaLogistica';

import { BarraStatusSync } from './components/BarraStatusSync';
import { CardPedidoLogistica } from './components/CardPedidoLogistica';
import { PainelJornadaScreen } from './screens/PainelJornadaScreen';
import { DetalhesPedidoScreen } from './screens/DetalhesPedidoScreen';

import {
  GPS_TASK_NAME,
  GPS_CONFIG,
  BLINDAGEM_GPS,
  STATUS_PEDIDO,
  STATUS_JORNADA,
  STATUS_SYNC,
  TIPO_DESTINO_FILA,
  TIPO_EVENTO
} from './config/constants';

import {
  setApiUrls,
  getApiPrincipalUrl,
  getApiLogisticaUrl,
  obterToken,
  montarHeadersAutenticados,
  obterVeiculoVinculado,
  salvarVeiculoVinculado,
  desvincularVeiculo,
  obterMotoristaAtual,
  salvarMotoristaAtual
} from './config/apiConfig';

/**
 * Função de inicialização rápida da camada de logística:
 * - Abre/inicializa o banco SQLite local com as 4 tabelas
 * - Inicia os observadores de conectividade (NetInfo) e temporizador de envio
 * - Configura opcionalmente URLs customizadas de API
 */
export const inicializarLogistica = async (opcoes = {}) => {
  if (opcoes.principalUrl || opcoes.logisticaUrl) {
    setApiUrls({
      principalUrl: opcoes.principalUrl,
      logisticaUrl: opcoes.logisticaUrl
    });
  }

  // 1. Inicializa esquema SQLite
  await sqliteService.inicializarBanco();

  // 2. Inicia monitor de rede e sincronizador
  syncService.iniciarMonitorSincronizacao();

  console.log('[Logística Offline-First] Módulo inicializado com sucesso.');
};

export const initDatabase = sqliteService.initDatabase;

// Exportações dos Serviços
export {
  sqliteService,
  locationTaskService,
  syncService,
  entregaService,
  jornadaService,
  cargaService
};

// Exportações dos Hooks
export {
  useSyncStatus,
  useJornadaLogistica
};

// Exportações dos Componentes e Telas
export {
  BarraStatusSync,
  CardPedidoLogistica,
  PainelJornadaScreen,
  DetalhesPedidoScreen
};

// Exportações de Configurações e Constantes
export {
  setApiUrls,
  getApiPrincipalUrl,
  getApiLogisticaUrl,
  obterToken,
  montarHeadersAutenticados,
  obterVeiculoVinculado,
  salvarVeiculoVinculado,
  desvincularVeiculo,
  obterMotoristaAtual,
  salvarMotoristaAtual,
  GPS_TASK_NAME,
  GPS_CONFIG,
  BLINDAGEM_GPS,
  STATUS_PEDIDO,
  STATUS_JORNADA,
  STATUS_SYNC,
  TIPO_DESTINO_FILA,
  TIPO_EVENTO
};

export default {
  inicializar: inicializarLogistica,
  PainelJornadaScreen,
  BarraStatusSync
};
