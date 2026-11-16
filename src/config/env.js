// src/config/env.js

/**
 * Configurações de Ambiente Centralizadas - Amiguinho Entregas (Mobile)
 * 
 * Prioriza variáveis de ambiente do Expo (prefixadas com EXPO_PUBLIC_)
 * e fornece fallbacks seguros para desenvolvimento local e testes em emulador ou dispositivo físico.
 */

// 1. API Principal (ERP, cargas de pedidos, baixas comerciais e cadastro de clientes)
export const API_PRINCIPAL_URL =
  (process.env.EXPO_PUBLIC_API_PRINCIPAL_URL && !process.env.EXPO_PUBLIC_API_PRINCIPAL_URL.includes('192.168'))
    ? process.env.EXPO_PUBLIC_API_PRINCIPAL_URL
    : 'https://unmetered-dynamogenously-giuseppina.ngrok-free.dev/central';

// 2. API de Logística (Telemetria GPS, abertura de jornada e eventos de auditoria)
export const API_LOGISTICA_URL =
  (process.env.EXPO_PUBLIC_API_LOGISTICA_URL && !process.env.EXPO_PUBLIC_API_LOGISTICA_URL.includes('192.168'))
    ? process.env.EXPO_PUBLIC_API_LOGISTICA_URL
    : 'https://unmetered-dynamogenously-giuseppina.ngrok-free.dev';

export const ENV = {
  API_PRINCIPAL_URL,
  API_LOGISTICA_URL,
  IS_DEV: __DEV__
};

export default ENV;

