// src/logistica/config/constants.js

/**
 * Constantes operacionais do módulo Amiguinho Mobile Logística Offline-First.
 */

// Nome da tarefa global registrada no TaskManager do Expo
export const GPS_TASK_NAME = 'AMIGUINHO_GPS_TRACKING';

// Configurações de coleta de GPS (Otimizado para smartphone conectado ao USB do veículo)
export const GPS_CONFIG = {
  TIME_INTERVAL_MS: 8000,        // Grava no banco a cada 8 segundos em movimento
  WATCH_INTERVAL_MS: 2000,       // Amostragem contínua do sensor a cada 2s para capturar picos de velocidade
  DISTANCE_INTERVAL_M: 10,       // 10 metros para registrar esquinas e curvas com alta fidelidade
  MIN_INTERVAL_MS: 6000,         // Trava mínima de segurança temporal (6 segundos)
  PARADO_DISTANCIA_METROS: 18,   // Raio de 18m para filtrar deriva e oscilação natural parado
  PARADO_TIMEOUT_MS: 120000,     // Quando parado, grava apenas 1 ponto a cada 2 minutos (auditoria de descarga)
  ANDROID_NOTIFICATION: {
    TITLE: 'Amiguinho Logística',
    BODY: 'Rastreamento de rota e velocidade ativo em tempo real',
    COLOR: '#FF8C00'
  }
};

// Blindagem Anti-Erro / Anti-WhatsApp na Baixa de Pedidos
// Só atualiza as coordenadas do cliente se a precisão for excelente (<= 25m)
// e o motorista estiver praticamente parado (< 1.5 m/s ou ~5.4 km/h)
export const BLINDAGEM_GPS = {
  MAX_PRECISAO_METROS: 25,
  MAX_VELOCIDADE_MPS: 1.5
};

// Configurações do Motor de Sincronização
export const SYNC_CONFIG = {
  BATCH_SIZE_GPS: 100,         // Até 100 pontos por requisição
  INTERVALO_PERIODICO_MS: 60000, // Sincronização automática a cada 60 segundos
  TIMEOUT_REQUISICAO_MS: 15000,
  MAX_TENTATIVAS_FALHA: 5
};

// Status dos Pedidos
export const STATUS_PEDIDO = {
  PENDENTE: 'PENDENTE',
  ENTREGUE: 'ENTREGUE',
  NAO_ENTREGUE: 'NAO_ENTREGUE'
};

// Status da Jornada
export const STATUS_JORNADA = {
  EM_ANDAMENTO: 'EM_ANDAMENTO',
  FINALIZADA: 'FINALIZADA'
};

// Status de Sincronização
export const STATUS_SYNC = {
  PENDENTE: 'PENDENTE',
  ENVIANDO: 'ENVIANDO',
  SINCRONIZADO: 'SINCRONIZADO'
};

// Tipos de Destino da Fila de Eventos
export const TIPO_DESTINO_FILA = {
  API_PRINCIPAL_BAIXA: 'API_PRINCIPAL_BAIXA',
  API_PRINCIPAL_CONCLUIR_CARGA: 'API_PRINCIPAL_CONCLUIR_CARGA',
  API_LOGISTICA_EVENTO: 'API_LOGISTICA_EVENTO',
  API_LOGISTICA_JORNADA: 'API_LOGISTICA_JORNADA'
};

// Tipos de Eventos Operacionais
export const TIPO_EVENTO = {
  BAIXA_ENTREGA: 'BAIXA_ENTREGA',
  INICIO_JORNADA: 'INICIO_JORNADA',
  FIM_JORNADA: 'FIM_JORNADA',
  CLIENTE_AUSENTE: 'CLIENTE_AUSENTE',
  RETORNO_MERCADORIA: 'RETORNO_MERCADORIA'
};
