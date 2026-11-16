// src/logistica/components/BarraStatusSync.jsx
import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet
} from 'react-native';
import { useSyncStatus } from '../hooks/useSyncStatus';

/**
 * Banner discreto de status de sincronização e conectividade.
 * Exibe em tempo real o estado de conexão e a fila de pendências represadas no SQLite.
 */
export const BarraStatusSync = ({ onPress }) => {
  const {
    estaOnline,
    sincronizacaoEmAndamento,
    pontosGpsPendentes,
    eventosPendentes,
    totalPendencias,
    sincronizarAgora
  } = useSyncStatus();

  const handlePress = () => {
    if (onPress) {
      onPress();
    } else {
      sincronizarAgora();
    }
  };

  // 1. Estado OFFLINE
  if (!estaOnline) {
    const textoFila =
      totalPendencias > 0
        ? `${pontosGpsPendentes} pontos e ${eventosPendentes} baixas na fila`
        : 'Operando localmente no SQLite';

    return (
      <TouchableOpacity
        style={[styles.container, styles.offlineContainer]}
        activeOpacity={0.8}
        onPress={handlePress}
      >
        <View style={styles.content}>
          <View style={[styles.dot, styles.offlineDot]} />
          <Text style={styles.offlineText} numberOfLines={1}>
            Offline • {textoFila}
          </Text>
        </View>
        <Text style={styles.subtextOffline}>Toque p/ tentar</Text>
      </TouchableOpacity>
    );
  }

  // 2. Estado SINCRONIZANDO (Online)
  if (sincronizacaoEmAndamento) {
    return (
      <View style={[styles.container, styles.syncingContainer]}>
        <View style={styles.content}>
          <ActivityIndicator size="small" color="#0369A1" style={styles.spinner} />
          <Text style={styles.syncingText} numberOfLines={1}>
            Sincronizando • {totalPendencias} itens na fila...
          </Text>
        </View>
      </View>
    );
  }

  // 3. Estado ONLINE COM PENDÊNCIAS
  if (totalPendencias > 0) {
    return (
      <TouchableOpacity
        style={[styles.container, styles.pendingContainer]}
        activeOpacity={0.8}
        onPress={handlePress}
      >
        <View style={styles.content}>
          <View style={[styles.dot, styles.pendingDot]} />
          <Text style={styles.pendingText} numberOfLines={1}>
            Online • {pontosGpsPendentes} pontos e {eventosPendentes} baixas na fila
          </Text>
        </View>
        <Text style={styles.actionText}>Sincronizar</Text>
      </TouchableOpacity>
    );
  }

  // 4. Estado ONLINE E 100% SINCRONIZADO
  return (
    <View style={[styles.container, styles.onlineContainer]}>
      <View style={styles.content}>
        <View style={[styles.dot, styles.onlineDot]} />
        <Text style={styles.onlineText}>
          Online • Tudo sincronizado
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 8,
    marginHorizontal: 12,
    marginVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8
  },
  spinner: {
    marginRight: 8
  },

  // Offline (Vermelho / Âmbar escuro)
  offlineContainer: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    borderWidth: 1
  },
  offlineDot: {
    backgroundColor: '#DC2626'
  },
  offlineText: {
    color: '#991B1B',
    fontSize: 12,
    fontWeight: '600',
    flex: 1
  },
  subtextOffline: {
    color: '#B91C1C',
    fontSize: 11,
    fontWeight: '500',
    marginLeft: 6
  },

  // Sincronizando (Azul)
  syncingContainer: {
    backgroundColor: '#F0F9FF',
    borderColor: '#BAE6FD',
    borderWidth: 1
  },
  syncingText: {
    color: '#0369A1',
    fontSize: 12,
    fontWeight: '600'
  },

  // Pendente mas Online (Amarelo / Laranja)
  pendingContainer: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
    borderWidth: 1
  },
  pendingDot: {
    backgroundColor: '#D97706'
  },
  pendingText: {
    color: '#92400E',
    fontSize: 12,
    fontWeight: '600',
    flex: 1
  },
  actionText: {
    color: '#B45309',
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 6,
    textDecorationLine: 'underline'
  },

  // 100% Sincronizado (Verde sutil)
  onlineContainer: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
    borderWidth: 1
  },
  onlineDot: {
    backgroundColor: '#16A34A'
  },
  onlineText: {
    color: '#15803D',
    fontSize: 12,
    fontWeight: '500'
  }
});
export default BarraStatusSync;
