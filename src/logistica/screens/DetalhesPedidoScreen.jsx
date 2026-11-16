// src/logistica/screens/DetalhesPedidoScreen.jsx
import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  SafeAreaView,
  StatusBar
} from 'react-native';
import { STATUS_PEDIDO } from '../config/constants';

/**
 * Tela Operacional de Detalhes da Entrega e Cobrança.
 * Focada exclusivamente em conferência de endereço, valores a receber e confirmação de entrega.
 * (A lista de produtos e o indicativo de GPS são omitidos intencionalmente para agilizar a operação em campo).
 */
export const DetalhesPedidoScreen = ({ pedido, onVoltar, onConfirmarEntrega }) => {
  const [carregando, setCarregando] = useState(false);

  if (!pedido) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centro}>
          <Text style={styles.textoErro}>Nenhum pedido selecionado.</Text>
          <TouchableOpacity style={styles.botaoVoltarSimples} onPress={onVoltar}>
            <Text style={styles.textoBotaoVoltar}>← Voltar à Lista</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isEntregue = pedido.status === STATUS_PEDIDO.ENTREGUE;
  const isPendente = pedido.status === STATUS_PEDIDO.PENDENTE;

  const formatarMoeda = (valor) => {
    return Number(valor || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });
  };

  // Ação de confirmação de entrega com prompt nativo de reconfirmação
  const handleConfirmar = () => {
    if (carregando || isEntregue) return;

    const nomeCliente = pedido.clienteNome || 'o cliente';
    Alert.alert(
      'Confirmar Entrega',
      `Você realmente deseja confirmar a entrega do cliente "${nomeCliente}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sim, Confirmar',
          style: 'default',
          onPress: async () => {
            setCarregando(true);
            try {
              await onConfirmarEntrega(pedido.pedidoId);
              // Após confirmar com sucesso, retorna para a lista de pedidos
              if (onVoltar) {
                onVoltar();
              }
            } catch (err) {
              // Erro já gerenciado pelo hook
            } finally {
              setCarregando(false);
            }
          }
        }
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Top Bar de Navegação */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.botaoVoltarTop}
          onPress={onVoltar}
          activeOpacity={0.7}
          disabled={carregando}
        >
          <Text style={styles.setaVoltar}>←</Text>
          <Text style={styles.textoVoltarTop}>Lista de Pedidos</Text>
        </TouchableOpacity>

        <View
          style={[
            styles.statusPill,
            isEntregue ? styles.statusPillEntregue : styles.statusPillPendente
          ]}
        >
          <Text
            style={[
              styles.statusTexto,
              isEntregue ? styles.statusTextoEntregue : styles.statusTextoPendente
            ]}
          >
            {pedido.status}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Cabeçalho do Pedido e Cliente */}
        <View style={styles.cardHeaderPrincipal}>
          <Text style={styles.labelPedido}>ENTREGA ROTA</Text>
          <Text style={styles.numeroPedido}>Pedido #{pedido.numero || pedido.pedidoId}</Text>
          <Text style={styles.clienteNomeDestaque}>{pedido.clienteNome || 'Cliente'}</Text>
        </View>

        {/* Local de Entrega */}
        <View style={styles.cardSecao}>
          <Text style={styles.tituloSecao}>📍 Local de Entrega</Text>
          <Text style={styles.enderecoTexto}>
            {pedido.clienteEndereco || 'Endereço não informado'}
          </Text>
        </View>

        {/* Resumo Financeiro da Cobrança */}
        <View style={styles.cardFinanceiro}>
          <Text style={styles.tituloFinanceiro}>💳 Cobrança e Pagamento</Text>
          
          <View style={styles.linhaFinanceira}>
            <Text style={styles.rotuloFinanceiro}>Forma de Pagamento:</Text>
            <Text style={styles.valorFormaPagamento}>
              {pedido.formaPagamento || 'A VISTA'}
            </Text>
          </View>
          
          <View style={styles.divisorFinanceiro} />
          
          <View style={styles.linhaFinanceira}>
            <Text style={styles.rotuloTotalDestaque}>Total a Receber:</Text>
            <Text style={styles.valorTotalDestaque}>{formatarMoeda(pedido.valorTotal)}</Text>
          </View>
        </View>

        {/* Feedback de Pedido já Entregue */}
        {isEntregue && (
          <View style={styles.badgeConcluido}>
            <Text style={styles.badgeConcluidoIcone}>✓</Text>
            <Text style={styles.badgeConcluidoTitulo}>Entrega Realizada com Sucesso!</Text>
            <Text style={styles.badgeConcluidoSubtitulo}>
              Baixa gravada no dispositivo e registrada para a conferência financeira.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Barra de Ações Inferior */}
      <View style={styles.rodapeAcoes}>
        {isPendente ? (
          <>
            <TouchableOpacity
              style={styles.botaoConfirmar}
              activeOpacity={0.85}
              onPress={handleConfirmar}
              disabled={carregando}
            >
              {carregando ? (
                <View style={styles.linhaCarregando}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text style={styles.textoCarregando}>Registrando baixa...</Text>
                </View>
              ) : (
                <Text style={styles.botaoConfirmarTexto}>✓ Confirmar Entrega</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.botaoCancelarVoltar}
              onPress={onVoltar}
              activeOpacity={0.7}
              disabled={carregando}
            >
              <Text style={styles.botaoCancelarVoltarTexto}>Voltar para a Lista</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={styles.botaoVoltarListaSucesso}
            onPress={onVoltar}
            activeOpacity={0.8}
          >
            <Text style={styles.botaoVoltarListaSucessoTexto}>← Voltar à Lista de Pedidos</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC'
  },
  centro: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24
  },
  textoErro: {
    fontSize: 16,
    color: '#64748B',
    marginBottom: 16
  },
  botaoVoltarSimples: {
    backgroundColor: '#0284C7',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8
  },
  textoBotaoVoltar: {
    color: '#FFFFFF',
    fontWeight: '700'
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0'
  },
  botaoVoltarTop: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingRight: 12
  },
  setaVoltar: {
    fontSize: 20,
    color: '#0F172A',
    fontWeight: '700',
    marginRight: 6
  },
  textoVoltarTop: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A'
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12
  },
  statusPillPendente: {
    backgroundColor: '#FEF3C7'
  },
  statusTextoPendente: {
    color: '#D97706',
    fontSize: 11,
    fontWeight: '700'
  },
  statusPillEntregue: {
    backgroundColor: '#DCFCE7'
  },
  statusTextoEntregue: {
    color: '#15803D',
    fontSize: 11,
    fontWeight: '700'
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 24
  },
  cardHeaderPrincipal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1
  },
  labelPedido: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.8
  },
  numeroPedido: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2
  },
  clienteNomeDestaque: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0369A1',
    marginTop: 6
  },
  cardSecao: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1
  },
  tituloSecao: {
    fontSize: 13,
    fontWeight: '800',
    color: '#334155',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8
  },
  enderecoTexto: {
    fontSize: 15,
    color: '#1E293B',
    lineHeight: 22,
    fontWeight: '500'
  },
  cardFinanceiro: {
    backgroundColor: '#EFF6FF',
    padding: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    marginBottom: 12
  },
  tituloFinanceiro: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1E40AF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12
  },
  linhaFinanceira: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  divisorFinanceiro: {
    height: 1,
    backgroundColor: '#DBEAFE',
    marginVertical: 12
  },
  rotuloFinanceiro: {
    fontSize: 14,
    color: '#1E40AF'
  },
  valorFormaPagamento: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1E3A8A'
  },
  rotuloTotalDestaque: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E3A8A'
  },
  valorTotalDestaque: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1E3A8A'
  },
  badgeConcluido: {
    backgroundColor: '#F0FDF4',
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    marginTop: 8
  },
  badgeConcluidoIcone: {
    fontSize: 36,
    color: '#16A34A',
    fontWeight: '800',
    marginBottom: 6
  },
  badgeConcluidoTitulo: {
    color: '#16A34A',
    fontSize: 17,
    fontWeight: '800'
  },
  badgeConcluidoSubtitulo: {
    color: '#15803D',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18
  },
  rodapeAcoes: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    gap: 10
  },
  botaoConfirmar: {
    backgroundColor: '#16A34A',
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3
  },
  botaoConfirmarTexto: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3
  },
  linhaCarregando: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  textoCarregando: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700'
  },
  botaoCancelarVoltar: {
    backgroundColor: '#F1F5F9',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1'
  },
  botaoCancelarVoltarTexto: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '700'
  },
  botaoVoltarListaSucesso: {
    backgroundColor: '#0F172A',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center'
  },
  botaoVoltarListaSucessoTexto: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700'
  }
});

export default DetalhesPedidoScreen;
