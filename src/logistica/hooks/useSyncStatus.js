// src/logistica/hooks/useSyncStatus.js
import { useState, useEffect, useCallback } from 'react';
import {
  adicionarOuvinteSync,
  obterStatusAtual,
  processarFilaSincronizacao
} from '../services/syncService';

/**
 * Hook React para expor em tempo real o status de rede e a quantidade de pendências na fila.
 */
export const useSyncStatus = () => {
  const [status, setStatus] = useState({
    estaOnline: true,
    sincronizacaoEmAndamento: false,
    pontosGpsPendentes: 0,
    eventosPendentes: 0,
    totalPendencias: 0,
    ultimaSincronizacao: null
  });

  useEffect(() => {
    // 1. Busca estado inicial
    obterStatusAtual().then((atual) => {
      if (atual) setStatus((prev) => ({ ...prev, ...atual }));
    });

    // 2. Inscreve ouvinte reativo
    const desinscrever = adicionarOuvinteSync((novoEstado) => {
      setStatus((prev) => ({ ...prev, ...novoEstado }));
    });

    return () => {
      desinscrever();
    };
  }, []);

  // Força uma sincronização manual acionada pelo usuário
  const sincronizarAgora = useCallback(async () => {
    return await processarFilaSincronizacao();
  }, []);

  return {
    ...status,
    sincronizarAgora
  };
};
