// src/logistica/screens/PainelJornadaScreen.jsx
import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  StyleSheet,
  SafeAreaView,
  StatusBar
} from 'react-native';
import { useJornadaLogistica } from '../hooks/useJornadaLogistica';
import { CardPedidoLogistica } from '../components/CardPedidoLogistica';
import { DetalhesPedidoScreen } from './DetalhesPedidoScreen';
import * as syncService from '../services/syncService';
import { STATUS_PEDIDO } from '../config/constants';

/**
 * Tela Operacional Principal de Logística Offline-First.
 * Fluxo Unificado em 1 Clique:
 * 1. '🚀 Iniciar Rota do Dia': Baixa a carga do servidor para o SQLite local e ativa o GPS em segundo plano.
 * 2. '⏹ Finalizar Rota do Dia': Encerra o rastreamento GPS e sincroniza a jornada.
 * 3. Cards de Pedidos interativos com detalhes dos produtos e confirmação de entrega com segurança.
 */
export const PainelJornadaScreen = ({ navigation, onLogout }) => {
  const {
    jornadaAtiva,
    emAndamento,
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
    finalizarJornada,
    confirmarEntrega
  } = useJornadaLogistica();

  const [atualizando, setAtualizando] = useState(false);
  const [pedidoSelecionadoId, setPedidoSelecionadoId] = useState(null);

  const pedidoSelecionado = pedidos.find((p) => String(p.pedidoId) === String(pedidoSelecionadoId));

  // Ação: Sair da Conta (Logout)
  const handleLogout = () => {
    Alert.alert(
      'Trocar de Caminhão',
      'Deseja desvincular este aparelho do caminhão atual? Será necessário selecionar o caminhão novamente.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sim, Desvincular',
          style: 'destructive',
          onPress: () => {
            if (onLogout) onLogout();
          }
        }
      ]
    );
  };

  // Ação Unificada: Iniciar Rota do Dia (1 Clique: Baixa Carga + Ativa GPS)
  const handleIniciarRotaDoDia = async () => {
    try {
      const res = await iniciarRotaDoDia();
      const nomeMotorista = res.carga?.motorista?.nome || motorista?.nome || 'Motorista';
      const msg = res.offline
        ? `Iniciado em modo offline com ${res.totalPedidos} pedidos gravados no aparelho. Rastreamento GPS ativo!`
        : `Carga #${res.carga?.cargaId || ''} baixada com ${res.totalPedidos} pedidos para ${nomeMotorista}. Rastreamento GPS ativo em segundo plano!`;

      Alert.alert('🚀 Rota do Dia Iniciada!', msg);
    } catch (err) {
      // Erro tratado no hook
    }
  };

  // Ação: Finalizar Rota do Dia
  const handleFinalizarRotaDoDia = () => {
    Alert.alert(
      'Finalizar Rota do Dia',
      'Deseja realmente encerrar a rota e parar o rastreamento GPS de telemetria?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sim, Finalizar',
          style: 'destructive',
          onPress: async () => {
            try {
              await finalizarJornada();
              Alert.alert('Rota Finalizada', 'Serviço de GPS desligado e pendências salvas na fila para envio.');
            } catch (err) {}
          }
        }
      ]
    );
  };

  // Ação: Confirmar Entrega com Feedback
  const handleConfirmarEntrega = async (pedidoId) => {
    try {
      const resultado = await confirmarEntrega(pedidoId);
      if (resultado.sucesso) {
        let msg = 'Baixa realizada instantaneamente e gravada no banco local.';
        if (resultado.deveAtualizarCliente) {
          msg += '\n\n✓ GPS do cliente validado com alta precisão e agendado para atualização no servidor!';
        }
        Alert.alert('Entrega Registrada', msg);
      }
    } catch (err) {
      // Erro tratado no hook
    }
  };

  // Puxar para Atualizar (Pull-to-refresh ou botão manual)
  const handleRefresh = async () => {
    setAtualizando(true);
    try {
      // 1. Processa a fila de sincronização pendente (jornada, baixas e GPS)
      await syncService.processarFilaSincronizacao().catch((err) =>
        console.warn('[PainelJornada] Sincronização em background:', err.message)
      );
      // 2. Se houver conexão, busca também novas atualizações da carga com status 'rota'
      const res = await baixarCarga().catch(() => null);
      if (res && !res.sucesso && res.mensagem) {
        Alert.alert('Status da Carga', res.mensagem);
      }
    } finally {
      await recarregarDados();
      setAtualizando(false);
    }
  };

  // Se houver um pedido selecionado, renderiza a tela dedicada de detalhes do pedido
  if (pedidoSelecionado) {
    return (
      <DetalhesPedidoScreen
        pedido={pedidoSelecionado}
        onVoltar={() => setPedidoSelecionadoId(null)}
        onConfirmarEntrega={handleConfirmarEntrega}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />

      {/* Cabeçalho da Tela com Controles de Jornada */}
      <View style={styles.header}>
        <View style={styles.headerTopo}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={styles.titulo}>Painel Logística</Text>
            <Text style={styles.subtitulo} numberOfLines={1}>
              {emAndamento ? 'Rota em andamento' : 'Pronto para iniciar'}
            </Text>
          </View>

          <View style={styles.headerAcoesDireita}>
            <View style={[styles.statusJornadaTag, emAndamento ? styles.tagAtiva : styles.tagInativa]}>
              <View style={[styles.statusDot, emAndamento ? styles.dotAtivo : styles.dotInativo]} />
              <Text style={[styles.statusTagTexto, emAndamento ? styles.textoAtivo : styles.textoInativo]}>
                {emAndamento ? 'EM ROTA' : 'PARADO'}
              </Text>
            </View>

            {/* Botão de Atualização Manual da Carga */}
            <TouchableOpacity
              style={styles.botaoAtualizar}
              onPress={handleRefresh}
              disabled={atualizando || processandoAcao}
              activeOpacity={0.7}
              accessibilityLabel="Atualizar carga do servidor"
            >
              {atualizando ? (
                <ActivityIndicator size="small" color="#0284C7" />
              ) : (
                <Text style={styles.botaoAtualizarTexto}>🔄 Atualizar</Text>
              )}
            </TouchableOpacity>

            {onLogout && (
              <TouchableOpacity
                style={styles.botaoSair}
                onPress={handleLogout}
                activeOpacity={0.7}
                accessibilityLabel="Trocar de caminhão"
              >
                <Text style={styles.botaoSairTexto}>Trocar</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Card Informativo do Caminhão e Motorista */}
        <View style={styles.cardInfoFrota}>
          <View style={styles.frotaLinha}>
            <Text style={styles.frotaIcone}>🚛</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.frotaCaminhao}>
                {veiculo ? `${veiculo.nome || 'Caminhão'} • Placa: ${veiculo.placa || 'Sem placa'}` : 'Caminhão não selecionado'}
              </Text>
              <Text style={styles.frotaMotorista} numberOfLines={1}>
                👤 Motorista: {motorista ? motorista.nome : 'Aguardando início da rota'}
              </Text>
            </View>
          </View>
        </View>

        {/* Botão Operacional Unificado: 1 Clique Resolve Tudo */}
        <View style={styles.botoesLinha}>
          <TouchableOpacity
            style={[
              styles.botaoUnificado,
              emAndamento ? styles.botaoFinalizar : styles.botaoIniciar
            ]}
            onPress={emAndamento ? handleFinalizarRotaDoDia : handleIniciarRotaDoDia}
            disabled={processandoAcao}
            activeOpacity={0.85}
          >
            {processandoAcao ? (
              <View style={styles.linhaCarregando}>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.textoCarregandoAcao}>
                  {emAndamento ? 'Finalizando rota...' : 'Baixando rota e ativando GPS...'}
                </Text>
              </View>
            ) : (
              <Text
                style={[
                  styles.botaoJornadaTexto,
                  emAndamento ? styles.textoFinalizar : styles.textoIniciar
                ]}
              >
                {emAndamento ? '⏹ Finalizar Rota do Dia' : '🚀 Iniciar Rota do Dia'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Fita de Resumo Analítico da Carga */}
        <View style={styles.resumoContainer}>
          <View style={styles.resumoItem}>
            <Text style={styles.resumoValor}>{resumoCarga.total}</Text>
            <Text style={styles.resumoRotulo}>Total</Text>
          </View>
          <View style={styles.divisorVertical} />
          <View style={styles.resumoItem}>
            <Text style={[styles.resumoValor, styles.corPendente]}>{resumoCarga.pendentes}</Text>
            <Text style={styles.resumoRotulo}>Pendentes</Text>
          </View>
          <View style={styles.divisorVertical} />
          <View style={styles.resumoItem}>
            <Text style={[styles.resumoValor, styles.corEntregue]}>{resumoCarga.entregues}</Text>
            <Text style={styles.resumoRotulo}>Entregues</Text>
          </View>
        </View>

        {/* Indicador de % de Carga Entregue e Números */}
        {resumoCarga.total > 0 && (
          <View style={styles.progressoCargaContainer}>
            <View style={styles.progressoLinhaTexto}>
              <Text style={styles.progressoRotulo}>Progresso da Carga:</Text>
              <Text style={styles.progressoValor}>
                {Math.round((resumoCarga.entregues / resumoCarga.total) * 100)}% ({resumoCarga.entregues} de {resumoCarga.total} pedidos)
              </Text>
            </View>
            <View style={styles.progressoTrilho}>
              <View
                style={[
                  styles.progressoPreenchimento,
                  { width: `${Math.min(100, Math.round((resumoCarga.entregues / resumoCarga.total) * 100))}%` }
                ]}
              />
            </View>
          </View>
        )}
      </View>

      {/* Abas de Filtro de Lista */}
      <View style={styles.abasFiltro}>
        <TouchableOpacity
          style={[styles.aba, filtroStatus === null && styles.abaAtiva]}
          onPress={() => setFiltroStatus(null)}
        >
          <Text style={[styles.abaTexto, filtroStatus === null && styles.abaTextoAtivo]}>
            Todos ({resumoCarga.total})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.aba, filtroStatus === STATUS_PEDIDO.PENDENTE && styles.abaAtiva]}
          onPress={() => setFiltroStatus(STATUS_PEDIDO.PENDENTE)}
        >
          <Text
            style={[
              styles.abaTexto,
              filtroStatus === STATUS_PEDIDO.PENDENTE && styles.abaTextoAtivo
            ]}
          >
            Pendentes ({resumoCarga.pendentes})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.aba, filtroStatus === STATUS_PEDIDO.ENTREGUE && styles.abaAtiva]}
          onPress={() => setFiltroStatus(STATUS_PEDIDO.ENTREGUE)}
        >
          <Text
            style={[
              styles.abaTexto,
              filtroStatus === STATUS_PEDIDO.ENTREGUE && styles.abaTextoAtivo
            ]}
          >
            Entregues ({resumoCarga.entregues})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Listagem de Pedidos Operada 100% pelo SQLite */}
      {carregando ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FF8C00" />
          <Text style={styles.loadingTexto}>Consultando banco SQLite local...</Text>
        </View>
      ) : (
        <FlatList
          data={pedidos}
          keyExtractor={(item) => String(item.pedidoId)}
          renderItem={({ item }) => (
            <CardPedidoLogistica
              pedido={item}
              onSelecionarPedido={(p) => setPedidoSelecionadoId(p.pedidoId)}
            />
          )}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={atualizando}
              onRefresh={handleRefresh}
              colors={['#FF8C00']}
              tintColor="#FF8C00"
            />
          }
          ListEmptyComponent={
            <View style={styles.vazioContainer}>
              <Text style={styles.vazioIcone}>📦</Text>
              <Text style={styles.vazioTitulo}>Nenhum pedido na rota local</Text>
              <Text style={styles.vazioDescricao}>
                Toque no botão "🚀 Iniciar Rota do Dia" acima para baixar os pedidos designados e começar a jornada.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC'
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0'
  },
  headerTopo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12
  },
  titulo: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A'
  },
  subtitulo: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2
  },
  statusJornadaTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14
  },
  tagAtiva: {
    backgroundColor: '#DCFCE7'
  },
  tagInativa: {
    backgroundColor: '#F1F5F9'
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6
  },
  dotAtivo: {
    backgroundColor: '#16A34A'
  },
  dotInativo: {
    backgroundColor: '#94A3B8'
  },
  statusTagTexto: {
    fontSize: 11,
    fontWeight: '700'
  },
  textoAtivo: {
    color: '#15803D'
  },
  textoInativo: {
    color: '#64748B'
  },
  headerAcoesDireita: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  botaoAtualizar: {
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD'
  },
  botaoAtualizarTexto: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0284C7'
  },
  botaoSair: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA'
  },
  botaoSairTexto: {
    fontSize: 11,
    fontWeight: '700',
    color: '#DC2626'
  },
  cardInfoFrota: {
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FFEDD5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12
  },
  frotaLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  frotaIcone: {
    fontSize: 24
  },
  frotaCaminhao: {
    fontSize: 13,
    fontWeight: '800',
    color: '#9A3412'
  },
  frotaMotorista: {
    fontSize: 12,
    color: '#C2410C',
    marginTop: 2,
    fontWeight: '500'
  },
  botoesLinha: {
    marginBottom: 12
  },
  botaoUnificado: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 3
  },
  botaoIniciar: {
    backgroundColor: '#16A34A',
    shadowColor: '#16A34A'
  },
  textoIniciar: {
    color: '#FFFFFF'
  },
  botaoFinalizar: {
    backgroundColor: '#DC2626',
    shadowColor: '#DC2626'
  },
  textoFinalizar: {
    color: '#FFFFFF'
  },
  botaoJornadaTexto: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3
  },
  linhaCarregando: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  textoCarregandoAcao: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700'
  },
  resumoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12
  },
  resumoItem: {
    flex: 1,
    alignItems: 'center'
  },
  resumoValor: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A'
  },
  resumoRotulo: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1
  },
  corPendente: {
    color: '#D97706'
  },
  corEntregue: {
    color: '#16A34A'
  },
  divisorVertical: {
    width: 1,
    height: 24,
    backgroundColor: '#E2E8F0'
  },
  progressoCargaContainer: {
    marginTop: 8,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  progressoLinhaTexto: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6
  },
  progressoRotulo: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569'
  },
  progressoValor: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F172A'
  },
  progressoTrilho: {
    height: 6,
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
    overflow: 'hidden'
  },
  progressoPreenchimento: {
    height: '100%',
    backgroundColor: '#16A34A',
    borderRadius: 3
  },
  abasFiltro: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0'
  },
  aba: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    marginRight: 8
  },
  abaAtiva: {
    backgroundColor: '#FF8C00'
  },
  abaTexto: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B'
  },
  abaTextoAtivo: {
    color: '#FFFFFF'
  },
  listContent: {
    paddingVertical: 8,
    paddingBottom: 32
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  loadingTexto: {
    marginTop: 10,
    fontSize: 13,
    color: '#64748B'
  },
  vazioContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 64
  },
  vazioIcone: {
    fontSize: 48,
    marginBottom: 12
  },
  vazioTitulo: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 6
  },
  vazioDescricao: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18
  }
});

export default PainelJornadaScreen;
