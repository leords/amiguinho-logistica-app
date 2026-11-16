// src/screens/LoginScreen.jsx
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_PRINCIPAL_URL } from '../config/env';
import { salvarVeiculoVinculado } from '../logistica/config/apiConfig';

/**
 * Tela de Provisionamento & Autenticação de Caminhão (Opção B).
 * 
 * Passo 1: O encarregado/ADM insere o usuário e senha do caminhão (ex: caminhao1).
 * Passo 2: O app carrega os veículos da distribuidora (GET /veiculos) para confirmação de placa/modelo.
 * Passo 3: Salva o vínculo e as credenciais localmente para reautenticação silenciosa vitalícia.
 */
export const LoginScreen = ({ onLoginSuccess }) => {
  const [passo, setPasso] = useState('LOGIN'); // 'LOGIN' | 'SELECAO_VEICULO'
  const [identificador, setIdentificador] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [carregando, setCarregando] = useState(false);

  // Estados do Passo 2 (Seleção do Veículo)
  const [veiculosDisponiveis, setVeiculosDisponiveis] = useState([]);
  const [veiculoSelecionado, setVeiculoSelecionado] = useState(null);
  const [sessaoTemporaria, setSessaoTemporaria] = useState(null);

  // Executa autenticação na API Principal
  const handleAutenticar = async () => {
    const loginLimpo = identificador.trim();
    const senhaLimpa = senha.trim();

    if (!loginLimpo) {
      Alert.alert('Campo Obrigatório', 'Por favor, informe o usuário do caminhão (ex: caminhao1).');
      return;
    }

    if (!senhaLimpa) {
      Alert.alert('Campo Obrigatório', 'Por favor, informe a senha de acesso.');
      return;
    }

    setCarregando(true);

    try {
      const payload = {
        usuario: loginLimpo,
        email: loginLimpo,
        senha: senhaLimpa
      };

      const urlLogin = `${API_PRINCIPAL_URL}/login`;
      console.log(`[LoginScreen] Autenticando na API: ${urlLogin}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const response = await fetch(urlLogin, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const dados = await response.json().catch(() => ({}));

      if (!response.ok) {
        const msgErro =
          dados?.erro?.mensagem ||
          dados?.mensagem ||
          dados?.message ||
          `Falha de autenticação (HTTP ${response.status}).`;
        throw new Error(msgErro);
      }

      const token = dados.token || dados.access_token || dados.jwt;
      if (!token) {
        throw new Error('Servidor não retornou um token de autenticação válido.');
      }

      const usuario = dados.usuario || { nome: loginLimpo, usuario: loginLimpo };
      const refreshToken = dados.refreshToken || null;

      // Guarda os dados da sessão temporária para o passo de seleção do veículo
      const sessao = {
        token,
        refreshToken,
        usuario,
        credenciais: { usuario: loginLimpo, senha: senhaLimpa }
      };
      setSessaoTemporaria(sessao);

      // Busca os veículos cadastrados na distribuidora
      console.log(`[LoginScreen] Buscando lista de veículos em ${API_PRINCIPAL_URL}/veiculos...`);
      let veiculos = [];
      try {
        const resVeiculos = await fetch(`${API_PRINCIPAL_URL}/veiculos`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        });
        if (resVeiculos.ok) {
          const dadosVeic = await resVeiculos.json();
          veiculos = Array.isArray(dadosVeic) ? dadosVeic : (dadosVeic.resultado || dadosVeic.veiculos || []);
        }
      } catch (errVeic) {
        console.warn('[LoginScreen] Não foi possível carregar lista de veículos:', errVeic.message);
      }

      if (veiculos && veiculos.length > 0) {
        setVeiculosDisponiveis(veiculos);
        setVeiculoSelecionado(veiculos[0]); // Seleciona o primeiro por padrão
        setPasso('SELECAO_VEICULO');
      } else {
        // Se a API não retornou veículos (ex: rota vazia ou restrita), finaliza com veículo padrão baseado no login
        const veiculoFallback = {
          id: 1,
          nome: loginLimpo.toUpperCase(),
          placa: 'FROTA',
          modelo: 'Caminhão de Entrega'
        };
        await concluirProvisionamento(sessao, veiculoFallback);
      }
    } catch (error) {
      console.error('[LoginScreen] Erro no login:', error.message);
      Alert.alert('Erro ao Autenticar', error.message || 'Verifique seus dados e tente novamente.');
    } finally {
      setCarregando(false);
    }
  };

  // Finaliza o provisionamento e grava as credenciais para reautenticação silenciosa
  const concluirProvisionamento = async (sessao, veiculo) => {
    setCarregando(true);
    try {
      const paresAsync = [
        ['@amiguinho:token', String(sessao.token)],
        ['token', String(sessao.token)],
        ['@amiguinho:usuario', JSON.stringify(sessao.usuario)],
        ['@amiguinho:credenciais', JSON.stringify(sessao.credenciais)]
      ];

      if (sessao.refreshToken) {
        paresAsync.push(['@amiguinho:refreshToken', String(sessao.refreshToken)]);
      }

      await AsyncStorage.multiSet(paresAsync);
      await salvarVeiculoVinculado(veiculo);

      console.log(`[LoginScreen] Aparelho provisionado com sucesso para o caminhão: ${veiculo.nome} (ID: ${veiculo.id})`);

      if (typeof onLoginSuccess === 'function') {
        onLoginSuccess({
          token: sessao.token,
          usuario: sessao.usuario,
          veiculo
        });
      }
    } catch (err) {
      Alert.alert('Erro no Provisionamento', err.message);
    } finally {
      setCarregando(false);
    }
  };

  // Login de Demonstração / Teste Rápido
  const handleLoginDemo = () => {
    Alert.alert(
      'Provisionamento Demo',
      'Deseja configurar este aparelho com dados de teste para caminhão?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Vincular Mercedes 608 (ID 3)',
          onPress: async () => {
            const sessaoDemo = {
              token: 'demo-jwt-caminhao-608',
              refreshToken: 'demo-refresh-token',
              usuario: { id: 1, nome: 'Caminhão 1', usuario: 'caminhao1' },
              credenciais: { usuario: 'caminhao1', senha: '123' }
            };
            const veiculoDemo = {
              id: 3,
              nome: '608',
              modelo: '608',
              marca: 'Mercedes',
              placa: 'ABC4321',
              pesoMaximo: 2500
            };
            await concluirProvisionamento(sessaoDemo, veiculoDemo);
          }
        }
      ]
    );
  };

  // TELA PASSO 2: SELEÇÃO DO VEÍCULO FÍSICO
  if (passo === 'SELECAO_VEICULO') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <View style={styles.logoBadge}>
              <Text style={styles.logoIcon}>🚛</Text>
            </View>
            <Text style={styles.tituloApp}>Vincular Caminhão</Text>
            <Text style={styles.subtituloApp}>Selecione qual veículo físico este aparelho atende:</Text>
          </View>

          <View style={styles.cardForm}>
            <Text style={styles.tituloCard}>Frota Disponível</Text>
            <Text style={styles.descricaoCard}>
              O aplicativo baixará apenas as cargas com status 'rota' deste caminhão.
            </Text>

            {veiculosDisponiveis.map((v) => {
              const selecionado = veiculoSelecionado?.id === v.id;
              return (
                <TouchableOpacity
                  key={v.id}
                  style={[styles.veiculoItem, selecionado && styles.veiculoItemAtivo]}
                  onPress={() => setVeiculoSelecionado(v)}
                  activeOpacity={0.8}
                >
                  <View style={styles.radioContainer}>
                    <View style={[styles.radioCirculo, selecionado && styles.radioCirculoAtivo]} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.veiculoNome, selecionado && styles.veiculoNomeAtivo]}>
                      {v.nome || v.modelo} • Placa: {v.placa || 'Sem Placa'}
                    </Text>
                    <Text style={styles.veiculoDetalhes}>
                      {v.marca ? `${v.marca} • ` : ''}Capacidade: {v.pesoMaximo || 0} kg
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity
              style={[styles.botaoEntrar, carregando && styles.botaoDesativado]}
              onPress={() => concluirProvisionamento(sessaoTemporaria, veiculoSelecionado)}
              disabled={carregando || !veiculoSelecionado}
              activeOpacity={0.8}
            >
              {carregando ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.botaoEntrarTexto}>Salvar e Iniciar Operação</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.botaoVoltar}
              onPress={() => setPasso('LOGIN')}
              disabled={carregando}
            >
              <Text style={styles.botaoVoltarTexto}>← Voltar para login</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // TELA PASSO 1: LOGIN DE PROVISIONAMENTO DO CAMINHÃO
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Cabeçalho Visual da Marca */}
          <View style={styles.header}>
            <View style={styles.logoBadge}>
              <Text style={styles.logoIcon}>🚚</Text>
            </View>
            <Text style={styles.tituloApp}>Amiguinho Entregas</Text>
            <Text style={styles.subtituloApp}>Provisionamento de Dispositivo (Frota)</Text>
          </View>

          {/* Card do Formulário */}
          <View style={styles.cardForm}>
            <Text style={styles.tituloCard}>Identificação do Veículo</Text>
            <Text style={styles.descricaoCard}>
              Informe o usuário e senha do caminhão. Este aparelho ficará conectado permanentemente.
            </Text>

            {/* Campo: Usuário do Caminhão */}
            <View style={styles.campoContainer}>
              <Text style={styles.rotulo}>Usuário do Caminhão</Text>
              <TextInput
                style={styles.input}
                placeholder="Ex: caminhao1"
                placeholderTextColor="#94A3B8"
                value={identificador}
                onChangeText={setIdentificador}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!carregando}
              />
            </View>

            {/* Campo: Senha */}
            <View style={styles.campoContainer}>
              <View style={styles.rotuloLinha}>
                <Text style={styles.rotulo}>Senha</Text>
                <TouchableOpacity
                  onPress={() => setMostrarSenha(!mostrarSenha)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.linkMostrarSenha}>
                    {mostrarSenha ? 'Ocultar' : 'Mostrar'}
                  </Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={styles.input}
                placeholder="Senha de acesso"
                placeholderTextColor="#94A3B8"
                value={senha}
                onChangeText={setSenha}
                secureTextEntry={!mostrarSenha}
                autoCapitalize="none"
                editable={!carregando}
              />
            </View>

            {/* Botão Avançar */}
            <TouchableOpacity
              style={[styles.botaoEntrar, carregando && styles.botaoDesativado]}
              onPress={handleAutenticar}
              disabled={carregando}
              activeOpacity={0.8}
            >
              {carregando ? (
                <View style={styles.linhaCarregando}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text style={styles.botaoEntrarTexto}>Verificando...</Text>
                </View>
              ) : (
                <Text style={styles.botaoEntrarTexto}>Avançar para Veículo →</Text>
              )}
            </TouchableOpacity>

            {/* Botão de Demonstração / Teste */}
            {__DEV__ && (
              <TouchableOpacity
                style={styles.botaoDemo}
                onPress={handleLoginDemo}
                activeOpacity={0.7}
              >
                <Text style={styles.botaoDemoTexto}>⚡ Provisionamento Rápido (Demo)</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Rodapé Informativo */}
          <View style={styles.footer}>
            <Text style={styles.servidorInfo} numberOfLines={1}>
              API: {API_PRINCIPAL_URL}
            </Text>
            <Text style={styles.versaoTexto}>Amiguinho Logística • Rota Contínua Offline</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC'
  },
  container: {
    flex: 1
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 28
  },
  header: {
    alignItems: 'center',
    marginBottom: 24
  },
  logoBadge: {
    width: 68,
    height: 68,
    borderRadius: 20,
    backgroundColor: '#FF8C00',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: '#FF8C00',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8
  },
  logoIcon: {
    fontSize: 34
  },
  tituloApp: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5
  },
  subtituloApp: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 3,
    fontWeight: '500',
    textAlign: 'center'
  },
  cardForm: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 22,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3
  },
  tituloCard: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4
  },
  descricaoCard: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 18,
    lineHeight: 18
  },
  campoContainer: {
    marginBottom: 16
  },
  rotuloLinha: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  rotulo: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  linkMostrarSenha: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FF8C00',
    marginBottom: 6
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#0F172A'
  },
  botaoEntrar: {
    backgroundColor: '#FF8C00',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    shadowColor: '#FF8C00',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4
  },
  botaoDesativado: {
    opacity: 0.65
  },
  linhaCarregando: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  botaoEntrarTexto: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700'
  },
  veiculoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    marginBottom: 10
  },
  veiculoItemAtivo: {
    borderColor: '#FF8C00',
    backgroundColor: '#FFF7ED'
  },
  radioContainer: {
    marginRight: 12
  },
  radioCirculo: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#CBD5E1'
  },
  radioCirculoAtivo: {
    borderColor: '#FF8C00',
    backgroundColor: '#FF8C00'
  },
  veiculoNome: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B'
  },
  veiculoNomeAtivo: {
    color: '#C2410C'
  },
  veiculoDetalhes: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2
  },
  botaoVoltar: {
    marginTop: 14,
    alignItems: 'center',
    paddingVertical: 8
  },
  botaoVoltarTexto: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600'
  },
  botaoDemo: {
    marginTop: 14,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A'
  },
  botaoDemoTexto: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B45309'
  },
  footer: {
    marginTop: 24,
    alignItems: 'center'
  },
  servidorInfo: {
    fontSize: 11,
    color: '#94A3B8',
    marginBottom: 4
  },
  versaoTexto: {
    fontSize: 11,
    color: '#94A3B8'
  }
});

export default LoginScreen;
