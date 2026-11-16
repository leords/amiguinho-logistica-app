// src/logistica/services/locationTaskService.js
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { GPS_TASK_NAME, GPS_CONFIG, STATUS_SYNC } from '../config/constants';
import * as sqliteService from '../database/sqliteService';
import { dispararSincronizacaoSeConectado } from './syncService';
import { gerarUUID } from '../utils/uuid';

// Intervalo mínimo de 6 segundos entre pontos para curvas e alta precisão (veículo com USB conectado)
const INTERVALO_MINIMO_MS = GPS_CONFIG.MIN_INTERVAL_MS || 6000;

// Referências em memória para evitar timers concorrentes ou duplicados
let timerForeground = null;
let watchSubscription = null;
let maiorVelocidadeJanela = 0;
let ultimoTimestampGravado = 0;
let ultimoPontoCoords = null;
let rastreamentoAtivoLocal = false;

/**
 * Calcula a distância em metros entre duas coordenadas geográficas (Fórmula de Haversine).
 */
const calcularDistanciaMetros = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/**
 * Grava um ponto de telemetria GPS no SQLite local com velocidade em km/h e alta precisão de curva.
 */
export const gravarPontoGps = async (coords, timestamp = Date.now()) => {
  try {
    if (!coords || typeof coords.latitude !== 'number' || typeof coords.longitude !== 'number') {
      return null;
    }

    const agora = Date.now();
    const diferencaMs = agora - ultimoTimestampGravado;

    // Trava de precisão temporal rápida: se ainda não passaram 6 segundos, ignora
    if (ultimoTimestampGravado > 0 && diferencaMs < INTERVALO_MINIMO_MS) {
      return null;
    }

    // COLETOR INTELIGENTE (PARADO vs EM MOVIMENTO):
    // Se o veículo estiver praticamente parado (< 18 metros) e não completou 2 minutos (120s),
    // descarta leituras redundantes para não sujar o histórico com dezenas de pontos no mesmo quintal
    const raioParado = GPS_CONFIG.PARADO_DISTANCIA_METROS || 18;
    const timeoutParado = GPS_CONFIG.PARADO_TIMEOUT_MS || 120000;

    if (ultimoPontoCoords && ultimoTimestampGravado > 0) {
      const distParado = calcularDistanciaMetros(
        ultimoPontoCoords.latitude,
        ultimoPontoCoords.longitude,
        coords.latitude,
        coords.longitude
      );
      if (distParado < raioParado && diferencaMs < timeoutParado) {
        return null;
      }
    }

    const jornadaAtiva = await sqliteService.obterJornadaAtiva();
    if (!jornadaAtiva) {
      return null;
    }

    // 1. Cálculo rigoroso da velocidade em km/h (coords.speed vem em m/s no Android/iOS)
    let velocidadeKmH = 0;
    if (typeof coords.speed === 'number' && coords.speed > 0) {
      velocidadeKmH = coords.speed * 3.6;
    } else if (typeof coords.velocidade === 'number' && coords.velocidade > 0) {
      velocidadeKmH = coords.velocidade > 35 ? coords.velocidade : coords.velocidade * 3.6;
    }

    // 2. Validação cinemática por deslocamento (distância / tempo):
    // Protege contra frenagens abruptas logo antes do ciclo de leitura do sensor
    if (ultimoPontoCoords && diferencaMs > 0) {
      const distMetros = calcularDistanciaMetros(
        ultimoPontoCoords.latitude,
        ultimoPontoCoords.longitude,
        coords.latitude,
        coords.longitude
      );
      const deltaSeg = diferencaMs / 1000;
      if (deltaSeg > 0 && distMetros > 10) {
        const velCalc = (distMetros / deltaSeg) * 3.6;
        if (velCalc > 2 && velCalc < 160) {
          // Se o deslocamento médio for maior que a velocidade pontual no momento do fix, prioriza velCalc
          if (velCalc > velocidadeKmH) {
            velocidadeKmH = velCalc;
          }
        }
      }
    }

    // 3. Captura da velocidade de pico contínua (se o watcher ou background detectou um pico mais alto na janela)
    const picoBuffer = Math.max(
      maiorVelocidadeJanela,
      Number(coords.velocidadePico || 0)
    );
    if (picoBuffer > velocidadeKmH && picoBuffer < 160) {
      velocidadeKmH = picoBuffer;
    }
    // Reseta o acumulador para a próxima janela de coleta
    maiorVelocidadeJanela = 0;

    velocidadeKmH = Math.round(velocidadeKmH * 10) / 10;
    ultimoPontoCoords = { latitude: coords.latitude, longitude: coords.longitude };

    const idLocalizacao = gerarUUID();
    const dataHoraIso = new Date(agora).toISOString();

    await sqliteService.inserirLocalizacao({
      id: idLocalizacao,
      jornadaId: jornadaAtiva.id,
      latitude: coords.latitude,
      longitude: coords.longitude,
      precisao: coords.accuracy || coords.precisao || 0,
      velocidade: velocidadeKmH,
      dataHora: dataHoraIso,
      statusSync: STATUS_SYNC.PENDENTE
    });

    ultimoTimestampGravado = agora;
    console.log(
      `[GPS] Coordenada gravada: Lat ${coords.latitude.toFixed(5)}, Lng ${coords.longitude.toFixed(5)} | Vel: ${velocidadeKmH} km/h (pico/cinemático) (delta: ${Math.round(diferencaMs / 1000)}s)`
    );

    // Dispara sincronização com a API em background se conectado
    dispararSincronizacaoSeConectado();

    return idLocalizacao;
  } catch (err) {
    console.error('[locationTaskService] Falha ao gravar coordenada GPS:', err.message);
    return null;
  }
};

/**
 * DEFINIÇÃO GLOBAL DA TASK DE RASTREAMENTO NO ESCOPO RAIZ (BACKGROUND / TASKMANAGER)
 * Invocada pelo sistema operacional quando a tela está desligada ou app em segundo plano.
 */
try {
  if (TaskManager && typeof TaskManager.isTaskDefined === 'function' && !TaskManager.isTaskDefined(GPS_TASK_NAME)) {
    TaskManager.defineTask(GPS_TASK_NAME, async ({ data, error }) => {
      if (error) {
        console.warn(`[${GPS_TASK_NAME}] Erro capturado na task de background:`, error.message);
        return;
      }

      if (!data || !Array.isArray(data.locations) || data.locations.length === 0) {
        return;
      }

      // Varre todo o lote de posições entregues pelo SO para capturar a maior velocidade atingida no trecho
      let maxSpeedBatch = 0;
      for (const loc of data.locations) {
        if (loc && loc.coords && typeof loc.coords.speed === 'number' && loc.coords.speed > 0) {
          const vKmh = loc.coords.speed * 3.6;
          if (vKmh > maxSpeedBatch) maxSpeedBatch = vKmh;
        }
      }

      // Pega a localização mais recente do lote entregue pelo SO
      const ultimaLoc = data.locations[data.locations.length - 1];
      if (ultimaLoc && ultimaLoc.coords) {
        await gravarPontoGps({
          ...ultimaLoc.coords,
          velocidadePico: maxSpeedBatch
        }, ultimaLoc.timestamp);
      }
    });
  }
} catch (taskInitErr) {
  console.warn(`[locationTaskService] Alerta na inicialização da task ${GPS_TASK_NAME}:`, taskInitErr.message);
}

/**
 * Solicita as permissões necessárias de Foreground e Background Location.
 */
export const solicitarPermissoesLocalizacao = async () => {
  try {
    // 1. Permissão em Primeiro Plano (Foreground)
    const fg = await Location.requestForegroundPermissionsAsync();
    const foregroundGranted = fg.status === 'granted';

    if (!foregroundGranted) {
      return {
        concedida: false,
        foreground: false,
        background: false,
        mensagem: 'Permissão de localização em primeiro plano foi negada pelo usuário.'
      };
    }

    // 2. Permissão em Segundo Plano (Background / Always) - opcional / resiliente
    let backgroundGranted = false;
    try {
      const bg = await Location.requestBackgroundPermissionsAsync();
      backgroundGranted = bg.status === 'granted';
    } catch (bgErr) {
      console.warn('[locationTaskService] Background permission não disponível ou ignorada:', bgErr.message);
    }

    return {
      concedida: true,
      foreground: true,
      background: backgroundGranted
    };
  } catch (error) {
    console.error('[locationTaskService] Erro ao solicitar permissões de GPS:', error);
    return {
      concedida: false,
      foreground: false,
      background: false,
      mensagem: error.message
    };
  }
};

/**
 * Inicia o rastreamento GPS contínuo estritamente a cada 15 segundos:
 * - Cancela qualquer timer anterior para prevenir execuções concorrentes duplicadas.
 * - Coleta imediata do ponto inicial de largada.
 * - Intervalo periódico único de 15 segundos para ler e gravar a posição.
 * - Background Task com Foreground Service para quando a tela for bloqueada.
 */
export const iniciarRastreamentoGps = async () => {
  try {
    // 1. Garante permissão de localização
    const permissao = await solicitarPermissoesLocalizacao();
    if (!permissao.concedida) {
      throw new Error(permissao.mensagem || 'Permissão de GPS em primeiro plano não concedida.');
    }

    // 2. Limpa qualquer timer anterior para garantir uma única thread de coleta ativa
    if (timerForeground) {
      clearInterval(timerForeground);
      timerForeground = null;
    }

    if (watchSubscription) {
      watchSubscription.remove();
      watchSubscription = null;
    }
    maiorVelocidadeJanela = 0;

    rastreamentoAtivoLocal = true;

    // 3. Captura imediata do ponto de largada (se já passaram mais de 14s desde a última)
    try {
      const posAtual = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High
      });
      if (posAtual && posAtual.coords) {
        await gravarPontoGps(posAtual.coords, posAtual.timestamp);
      }
    } catch (posErr) {
      console.warn('[locationTaskService] Alerta ao obter posição inicial:', posErr.message);
    }

    // 4. Inicia monitor contínuo de velocidade instantânea (watchPositionAsync a cada 2s)
    // Garante que picos curtos de aceleração (ex: > 80 km/h por 3 a 5 segundos) não sejam perdidos entre os ciclos
    try {
      if (watchSubscription) {
        watchSubscription.remove();
        watchSubscription = null;
      }
      watchSubscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: GPS_CONFIG.WATCH_INTERVAL_MS || 2000,
          distanceInterval: 3
        },
        (loc) => {
          if (loc && loc.coords && typeof loc.coords.speed === 'number' && loc.coords.speed > 0) {
            const vKmh = loc.coords.speed * 3.6;
            if (vKmh > maiorVelocidadeJanela) {
              maiorVelocidadeJanela = vKmh;
            }
          }
        }
      );
    } catch (watchErr) {
      console.warn('[locationTaskService] Alerta no watchPositionAsync de velocidade contínua:', watchErr.message);
    }

    // 5. Timer Periódico ÚNICO e CONTROLADO a cada 8 segundos (grava no banco SQLite)
    timerForeground = setInterval(async () => {
      try {
        const jornadaAtiva = await sqliteService.obterJornadaAtiva();
        if (!jornadaAtiva) {
          pararRastreamentoGps();
          return;
        }

        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High
        }).catch(() => Location.getLastKnownPositionAsync().catch(() => null));

        if (pos && pos.coords) {
          await gravarPontoGps(pos.coords, pos.timestamp);
        }
      } catch (errLoop) {
        console.warn('[locationTaskService] Erro no ciclo de 8s:', errLoop.message);
      }
    }, GPS_CONFIG.TIME_INTERVAL_MS);

    // 6. Inicia a Background Task se o dispositivo suportar segundo plano
    if (permissao.background) {
      try {
        const jaIniciado = await Location.hasStartedLocationUpdatesAsync(GPS_TASK_NAME).catch(() => false);
        if (!jaIniciado) {
          await Location.startLocationUpdatesAsync(GPS_TASK_NAME, {
            accuracy: Location.Accuracy.High,
            timeInterval: GPS_CONFIG.TIME_INTERVAL_MS,
            distanceInterval: GPS_CONFIG.DISTANCE_INTERVAL_M,
            deferredUpdatesInterval: GPS_CONFIG.TIME_INTERVAL_MS,
            deferredUpdatesDistance: GPS_CONFIG.DISTANCE_INTERVAL_M,
            showsBackgroundLocationIndicator: true,
            pausesLocationUpdatesAutomatically: false,
            foregroundService: {
              notificationTitle: GPS_CONFIG.ANDROID_NOTIFICATION.TITLE,
              notificationBody: GPS_CONFIG.ANDROID_NOTIFICATION.BODY,
              notificationColor: GPS_CONFIG.ANDROID_NOTIFICATION.COLOR
            }
          });
          console.log(`[${GPS_TASK_NAME}] Task de background registrada.`);
        }
      } catch (bgErr) {
        console.warn('[locationTaskService] Background Location Task indisponível no ambiente atual:', bgErr.message);
      }
    }

    console.log(`[locationTaskService] Rastreamento contínuo padronizado a cada ${GPS_CONFIG.TIME_INTERVAL_MS / 1000}s / ${GPS_CONFIG.DISTANCE_INTERVAL_M}m ATIVADO.`);
    return true;
  } catch (error) {
    console.error('[locationTaskService] Erro ao iniciar rastreamento GPS:', error);
    throw error;
  }
};

/**
 * Interrompe a coleta contínua de GPS em background e primeiro plano.
 */
export const pararRastreamentoGps = async () => {
  try {
    rastreamentoAtivoLocal = false;

    if (timerForeground) {
      clearInterval(timerForeground);
      timerForeground = null;
    }

    if (watchSubscription) {
      watchSubscription.remove();
      watchSubscription = null;
    }
    maiorVelocidadeJanela = 0;

    const jaIniciado = await Location.hasStartedLocationUpdatesAsync(GPS_TASK_NAME).catch(() => false);
    if (jaIniciado) {
      await Location.stopLocationUpdatesAsync(GPS_TASK_NAME).catch(() => {});
      console.log(`[${GPS_TASK_NAME}] Rastreamento GPS background interrompido.`);
    }

    return true;
  } catch (error) {
    console.error('[locationTaskService] Erro ao parar rastreamento GPS:', error);
    return false;
  }
};

/**
 * Verifica se o rastreamento contínuo está ativo no momento.
 */
export const verificarRastreamentoAtivo = async () => {
  if (timerForeground !== null || rastreamentoAtivoLocal) return true;
  try {
    return await Location.hasStartedLocationUpdatesAsync(GPS_TASK_NAME);
  } catch (err) {
    return false;
  }
};

/**
 * Captura a posição instantânea com precisão máxima para operações pontuais (ex: baixa de entregas).
 */
export const capturarPosicaoInstantanea = async () => {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      const req = await Location.requestForegroundPermissionsAsync();
      if (req.status !== 'granted') {
        throw new Error('Permissão de GPS necessária para confirmar a entrega.');
      }
    }

    const posicao = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High
    });

    return {
      latitude: posicao.coords.latitude,
      longitude: posicao.coords.longitude,
      precisao: posicao.coords.accuracy || 0,
      velocidade: Math.max(0, posicao.coords.speed || 0),
      timestamp: posicao.timestamp || Date.now()
    };
  } catch (error) {
    console.warn('[locationTaskService] Não foi possível obter posição instantânea em alta precisão:', error.message);
    try {
      const ultima = await Location.getLastKnownPositionAsync();
      if (ultima) {
        return {
          latitude: ultima.coords.latitude,
          longitude: ultima.coords.longitude,
          precisao: ultima.coords.accuracy || 50,
          velocidade: 0,
          timestamp: ultima.timestamp || Date.now()
        };
      }
    } catch (_) {}

    throw error;
  }
};
