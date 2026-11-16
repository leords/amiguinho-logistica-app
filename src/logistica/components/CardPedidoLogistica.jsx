// src/logistica/components/CardPedidoLogistica.jsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { STATUS_PEDIDO } from '../config/constants';

/**
 * Card representativo de cada pedido na lista da rota.
 * Ao ser tocado, navega diretamente para a nova tela de detalhes completos do pedido.
 */
export const CardPedidoLogistica = ({ pedido, onSelecionarPedido }) => {
  const isEntregue = pedido.status === STATUS_PEDIDO.ENTREGUE;

  const formatarMoeda = (valor) => {
    return Number(valor || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });
  };

  return (
    <TouchableOpacity
      style={[styles.card, isEntregue && styles.cardEntregue]}
      activeOpacity={0.75}
      onPress={() => {
        if (onSelecionarPedido) {
          onSelecionarPedido(pedido);
        }
      }}
    >
      {/* Cabeçalho do Card: Pedido # e Status */}
      <View style={styles.header}>
        <View style={styles.pedidoBadge}>
          <Text style={styles.pedidoNumero}>Pedido #{pedido.numero || pedido.pedidoId}</Text>
        </View>

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

      {/* Dados do Cliente */}
      <View style={styles.corpo}>
        <Text style={styles.clienteNome} numberOfLines={1}>
          {pedido.clienteNome || 'Cliente'}
        </Text>
        <Text style={styles.clienteEndereco} numberOfLines={1}>
          📍 {pedido.clienteEndereco || 'Endereço não informado'}
        </Text>
      </View>

      {/* Rodapé: Valores e Indicador de Navegação */}
      <View style={styles.rodape}>
        <View style={styles.valoresLinha}>
          <Text style={styles.rotuloValor}>Total:</Text>
          <Text style={styles.valorTotal}>{formatarMoeda(pedido.valorTotal)}</Text>
          <Text style={styles.formaPagamento}>({pedido.formaPagamento})</Text>
        </View>

        <View style={styles.acaoVerDetalhes}>
          <Text style={styles.textoVerDetalhes}>Ver Detalhes</Text>
          <Text style={styles.setaDetalhes}>❯</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 12,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2
  },
  cardEntregue: {
    backgroundColor: '#F8FAFC',
    borderColor: '#CBD5E1'
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8
  },
  pedidoBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6
  },
  pedidoNumero: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B'
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
  corpo: {
    marginBottom: 10
  },
  clienteNome: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 2
  },
  clienteEndereco: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18
  },
  rodape: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9'
  },
  valoresLinha: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  rotuloValor: {
    fontSize: 12,
    color: '#64748B',
    marginRight: 4
  },
  valorTotal: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginRight: 4
  },
  formaPagamento: {
    fontSize: 12,
    color: '#64748B'
  },
  acaoVerDetalhes: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  textoVerDetalhes: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284C7'
  },
  setaDetalhes: {
    fontSize: 11,
    color: '#0284C7',
    fontWeight: '800'
  }
});

export default CardPedidoLogistica;
