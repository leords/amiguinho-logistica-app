// src/logistica/utils/uuid.js
import * as Crypto from 'expo-crypto';

/**
 * Gera um identificador único universal (UUID v4) local no dispositivo.
 * Utiliza preferencialmente a biblioteca nativa expo-crypto (Crypto.randomUUID()).
 */
export const gerarUUID = () => {
  try {
    if (Crypto && typeof Crypto.randomUUID === 'function') {
      return Crypto.randomUUID();
    }
  } catch (err) {
    console.warn('[uuid] expo-crypto indisponível, utilizando fallback RFC4122:', err.message);
  }

  // Fallback seguro em conformidade com RFC4122 v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};
