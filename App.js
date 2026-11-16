// REGISTRO GLOBAL OBRIGATÓRIO NO ESCOPO RAIZ ANTES DE QUALQUER COMPONENTE
import './src/logistica/services/locationTaskService';

import { registerRootComponent } from 'expo';
import React, { useEffect, useState, useCallback } from 'react';
import { View, ActivityIndicator, StyleSheet, StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { inicializarLogistica, initDatabase, PainelJornadaScreen } from './src/logistica';
import { LoginScreen } from './src/screens/LoginScreen';
import { API_PRINCIPAL_URL, API_LOGISTICA_URL } from './src/config/env';
import { desvincularVeiculo, obterVeiculoVinculado } from './src/logistica/config/apiConfig';

/**
 * Ponto de entrada do aplicativo Amiguinho Entregas (Mobile).
 * 
 * 1. Registra a Task de GPS em segundo plano no escopo raiz.
 * 2. Inicializa o banco local SQLite (initDatabase / WAL mode) e os serviços de sincronização.
 * 3. Gerencia o modo de Provisionamento de Veículo (Opção B):
 *    - Se provisionado (veículo vinculado + credenciais salvas): entra direto no PainelJornadaScreen.
 *    - Se não provisionado: exibe a tela de login/provisionamento do caminhão.
 */
export default function App() {
  const [carregando, setCarregando] = useState(true);
  const [dispositivoProvisionado, setDispositivoProvisionado] = useState(false);

  // Inicialização e verificação de provisionamento do caminhão
  useEffect(() => {
    async function boot() {
      try {
        // 1. Inicializa o banco SQLite local e a camada de sincronização
        await initDatabase();
        await inicializarLogistica({
          principalUrl: API_PRINCIPAL_URL,
          logisticaUrl: API_LOGISTICA_URL
        });

        // 2. Verifica se este aparelho já está vinculado a um caminhão
        const veiculo = await obterVeiculoVinculado();
        const tokenSalvo =
          (await AsyncStorage.getItem('@amiguinho:token')) ||
          (await AsyncStorage.getItem('token'));
        const credenciaisSalvas = await AsyncStorage.getItem('@amiguinho:credenciais');

        // Dispositivo está pronto para o entregador se houver caminhão + token/credenciais
        if (veiculo && (tokenSalvo || credenciaisSalvas)) {
          setDispositivoProvisionado(true);
        } else {
          setDispositivoProvisionado(false);
        }
      } catch (err) {
        console.error('[App] Erro na inicialização da aplicação:', err);
      } finally {
        setCarregando(false);
      }
    }

    boot();
  }, []);

  // Callback ao provisionar com sucesso
  const handleLoginSuccess = useCallback(() => {
    setDispositivoProvisionado(true);
  }, []);

  // Callback de desvinculação / troca de caminhão
  const handleLogout = useCallback(async () => {
    try {
      await desvincularVeiculo();
      setDispositivoProvisionado(false);
    } catch (err) {
      console.warn('[App] Erro ao desvincular veículo:', err);
      setDispositivoProvisionado(false);
    }
  }, []);

  // Tela de Carregamento / Splash nativo
  if (carregando) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />
        <ActivityIndicator size="large" color="#FF8C00" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />
      {dispositivoProvisionado ? (
        <PainelJornadaScreen onLogout={handleLogout} />
      ) : (
        <LoginScreen onLoginSuccess={handleLoginSuccess} />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FAFC'
  }
});

// Registra o componente raiz "main" para o runtime do React Native e Expo
registerRootComponent(App);
