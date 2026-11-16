// src/logistica/hooks/useJornadaLogistica.js
import { useState, useEffect, useCallback } from 'react';
import { Alert } from 'react-native';
import * as jornadaService from '../services/jornadaService';
import * as cargaService from '../services/cargaService';
import * as entregaService from '../services/entregaService';
import * as sqliteService from '../database/sqliteService';
import { dispararSincronizacaoSeConectado } from '../services/syncService';
import { obterVeiculoVinculado, obterMotoristaAtual } from '../config/apiConfig';
import { STATUS_PEDIDO } from '../config/constants';

/**
 * Hook orquestrador do ciclo de vida da jornada de entregas e da carga local.
 */
export const useJornadaLogistica = () => {
  const [jornadaAtiva, setJornadaAtiva] = useState(null);
  const [rastreamentoAtivo, setRastreamentoAtivo] = useState(false);
  const [pedidos, setPedidos] = useState([]);
  const [resumoCarga, setResumoCarga] = useState({ total: 0, pendentes: 0, entregues: 0, valorTotal: 0 });
  const [filtroStatus, setFiltroStatus] = useState(null); // null = Todos
  const [carregando, setCarregando] = useState(true);
  const [processandoAcao, setProcessandoAcao] = useState(false);
  const [veiculo, setVeiculo] = useState(null);
  const [motorista, setMotorista] = useState(null);

  // Recarrega todos os dados locais do SQLite e do dispositivo
  const recarregarDados = useCallback(async () => {
    try {
      // 1. Status da jornada
      const statusJ = await jornadaService.obterStatusJornada();
      setJornadaAtiva(statusJ.jornada);
      setRastreamentoAtivo(statusJ.rastreamentoAtivo);

      // Se há jornada em andamento, garante que o rastreamento GPS de 15s esteja rodando
      if (statusJ.emAndamento) {
        await jornadaService.garantirRastreamentoAtivo();
      }

      // 2. Veículo e motorista vinculados
      const v = await obterVeiculoVinculado();
      const m = await obterMotoristaAtual();
      setVeiculo(v);
      setMotorista(m);

      // 3. Pedidos locais da carga
      const lista = await cargaService.carregarPedidosLocais(filtroStatus);
      setPedidos(lista || []);

      // 4. Resumo numérico
      const resumo = await cargaService.obterEstatisticasCarga();
      setResumoCarga(resumo);
    } catch (err) {
      console.warn('[useJornadaLogistica] Erro ao recarregar dados locais:', err);
    } finally {
      setCarregando(false);
    }
  }, [filtroStatus]);

  useEffect(() => {
    sqliteService.inicializarBanco().then(() => {
      recarregarDados();
      dispararSincronizacaoSeConectado();
    });
  }, [recarregarDados]);

  // Iniciar Rota do Dia (1 Clique: Baixa a Carga do Servidor + Inicia Jornada e GPS em Segundo Plano)
  const iniciarRotaDoDia = useCallback(async () => {
    setProcessandoAcao(true);
    try {
      // 1. Tenta baixar a carga ativa da API
      let cargaBaixada = null;
      let erroBaixa = null;
      try {
        cargaBaixada = await cargaService.baixarCargaDoDia();
      } catch (err) {
        erroBaixa = err;
        console.warn('[useJornadaLogistica] Falha na rede ao baixar carga:', err.message);
      }

      // Se a API respondeu e a carga não está com status 'rota', bloqueia o início da jornada
      if (cargaBaixada && !cargaBaixada.sucesso) {
        throw new Error(cargaBaixada.mensagem);
      }

      // 2. Verifica se há pedidos disponíveis (já gravados no SQLite)
      const pedidosLocais = await cargaService.carregarPedidosLocais();
      if (!pedidosLocais || pedidosLocais.length === 0) {
        const msg = erroBaixa
          ? erroBaixa.message
          : 'Nenhuma rota despachada com status \'rota\' foi encontrada para este caminhão.';
        throw new Error(msg);
      }

      // 3. Inicia o serviço de jornada e rastreamento GPS
      const v = await obterVeiculoVinculado();
      const veiculoNome = v ? `${v.nome || ''} (${v.placa || ''})`.trim() : 'VEICULO_PADRAO';
      const resJornada = await jornadaService.iniciarJornada({ veiculoId: veiculoNome });

      // 4. Recarrega estado local
      await recarregarDados();

      return {
        sucesso: true,
        carga: cargaBaixada,
        jornada: resJornada,
        offline: Boolean(erroBaixa),
        totalPedidos: pedidosLocais.length || cargaBaixada?.total || 0
      };
    } catch (err) {
      Alert.alert('Não foi possível iniciar a rota', err.message);
      throw err;
    } finally {
      setProcessandoAcao(false);
    }
  }, [recarregarDados]);

  // Baixar carga do dia da API Principal (filtrada por veiculoId e status 'rota')
  const baixarCarga = useCallback(async () => {
    setProcessandoAcao(true);
    try {
      const resultado = await cargaService.baixarCargaDoDia();
      await recarregarDados();
      return resultado;
    } catch (err) {
      Alert.alert('Aviso da Carga', err.message);
      throw err;
    } finally {
      setProcessandoAcao(false);
    }
  }, [recarregarDados]);

  // Iniciar Jornada
  const iniciarJornada = useCallback(async () => {
    setProcessandoAcao(true);
    try {
      const veiculoNome = veiculo ? `${veiculo.nome || ''} (${veiculo.placa || ''})`.trim() : 'VEICULO_PADRAO';
      const res = await jornadaService.iniciarJornada({ veiculoId: veiculoNome });
      await recarregarDados();
      return res;
    } catch (err) {
      Alert.alert('Erro ao Iniciar Jornada', err.message);
      throw err;
    } finally {
      setProcessandoAcao(false);
    }
  }, [recarregarDados, veiculo]);

  // Finalizar Jornada
  const finalizarJornada = useCallback(async () => {
    setProcessandoAcao(true);
    try {
      const res = await jornadaService.finalizarJornada({ distanciaTotalKm: 0 });
      await recarregarDados();
      return res;
    } catch (err) {
      Alert.alert('Erro ao Finalizar Jornada', err.message);
      throw err;
    } finally {
      setProcessandoAcao(false);
    }
  }, [recarregarDados]);

  // Confirmar Entrega do Pedido
  const confirmarEntrega = useCallback(async (pedidoId) => {
    setProcessandoAcao(true);
    try {
      const resultado = await entregaService.registrarBaixaEntrega(pedidoId);
      await recarregarDados();
      return resultado;
    } catch (err) {
      Alert.alert('Erro na Baixa', err.message);
      throw err;
    } finally {
      setProcessandoAcao(false);
    }
  }, [recarregarDados]);

  return {
    jornadaAtiva,
    emAndamento: Boolean(jornadaAtiva),
    rastreamentoAtivo,
    pedidos,
    resumoCarga,
    filtroStatus,
    setFiltroStatus,
    carregando,
    processandoAcao,
    veiculo,
    motorista,
    recarregarDados,
    iniciarRotaDoDia,
    baixarCarga,
    iniciarJornada,
    finalizarJornada,
    confirmarEntrega
  };
};
