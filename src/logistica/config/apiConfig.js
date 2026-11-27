// src/logistica/config/apiConfig.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_PRINCIPAL_URL as ENV_PRINCIPAL, API_LOGISTICA_URL as ENV_LOGISTICA } from '../../config/env';

/**
 * Módulo de configuração e autenticação para o ecossistema Amiguinho Logística:
 * 1. API_PRINCIPAL_URL: Cargas do dia, baixas de entregas (/pedidos/externo/:id/entregar) e veículos.
 * 2. API_LOGISTICA_URL: Telemetria de rotas, ingestão de GPS em lotes e auditoria.
 * 
 * Implementa provisionamento de dispositivo (Opção B - Caminhão Dedicado)
 * e Reautenticação Silenciosa em segundo plano.
 */

let customApiPrincipalUrl = null;
let customApiLogisticaUrl = null;
let renovacaoEmAndamento = null; // Lock para evitar múltiplas renovações simultâneas

export const setApiUrls = ({ principalUrl, logisticaUrl }) => {
  if (principalUrl) customApiPrincipalUrl = principalUrl;
  if (logisticaUrl) customApiLogisticaUrl = logisticaUrl;
};

export const getApiPrincipalUrl = () => {
  if (customApiPrincipalUrl) return customApiPrincipalUrl;
  return ENV_PRINCIPAL;
};

export const getApiLogisticaUrl = () => {
  if (customApiLogisticaUrl) return customApiLogisticaUrl;
  return ENV_LOGISTICA;
};

/**
 * Reautenticação Silenciosa em Segundo Plano.
 * 1. Tenta renovar via POST /refresh-token com o refreshToken salvo.
 * 2. Se o refreshToken estiver expirado (> 7 dias), faz POST /login com as credenciais salvas do caminhão.
 * 3. O entregador nunca é interrompido ou solicitado por senha na rua.
 */
export const renovarTokenSilenciosamente = async () => {
  if (renovacaoEmAndamento) {
    return renovacaoEmAndamento;
  }

  renovacaoEmAndamento = (async () => {
    const baseUrl = getApiPrincipalUrl();

    try {
      // 1. Tenta renovar via refresh-token
      const refreshToken = await AsyncStorage.getItem('@amiguinho:refreshToken');
      if (refreshToken) {
        try {
          const res = await fetch(`${baseUrl}/refresh-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken })
          });

          if (res.ok) {
            const dados = await res.json();
            const novoToken = dados.token || dados.accessToken;
            if (novoToken) {
              await AsyncStorage.multiSet([
                ['@amiguinho:token', String(novoToken)],
                ['token', String(novoToken)]
              ]);
              console.log('[apiConfig] Token renovado com sucesso via refresh-token.');
              return novoToken;
            }
          }
        } catch (eRefresh) {
          console.warn('[apiConfig] Falha no refresh-token, tentando reautenticação com credenciais:', eRefresh.message);
        }
      }

      // 2. Se o refresh-token falhou (ex: mais de 7 dias sem uso), usa as credenciais salvas
      const credenciaisJson = await AsyncStorage.getItem('@amiguinho:credenciais');
      if (credenciaisJson) {
        const { usuario, senha } = JSON.parse(credenciaisJson);
        if (usuario && senha) {
          const resLogin = await fetch(`${baseUrl}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, senha })
          });

          if (resLogin.ok) {
            const dadosLogin = await resLogin.json();
            const tokenLogin = dadosLogin.token || dadosLogin.access_token;
            const refTokenLogin = dadosLogin.refreshToken;

            if (tokenLogin) {
              const pares = [
                ['@amiguinho:token', String(tokenLogin)],
                ['token', String(tokenLogin)]
              ];
              if (refTokenLogin) {
                pares.push(['@amiguinho:refreshToken', String(refTokenLogin)]);
              }
              await AsyncStorage.multiSet(pares);
              console.log('[apiConfig] Reautenticação silenciosa concluída para o caminhão:', usuario);
              return tokenLogin;
            }
          }
        }
      }

      return null;
    } catch (err) {
      console.warn('[apiConfig] Erro ao renovar token silenciosamente:', err.message);
      return null;
    } finally {
      renovacaoEmAndamento = null;
    }
  })();

  return renovacaoEmAndamento;
};

/**
 * Recupera o token JWT ativo no dispositivo.
 * Se forcarRenovacao for true, dispara a reautenticação imediatamente.
 */
export const obterToken = async (forcarRenovacao = false) => {
  try {
    if (!forcarRenovacao) {
      const token =
        (await AsyncStorage.getItem('@amiguinho:token')) ||
        (await AsyncStorage.getItem('token'));

      if (token && typeof token === 'string' && token.trim().length > 0) {
        return token.trim();
      }
    }

    // Se não encontrou ou foi forçado, tenta renovar silenciosamente
    return await renovarTokenSilenciosamente();
  } catch (error) {
    console.warn('[apiConfig] Erro ao obter token de autenticação:', error.message);
    return null;
  }
};

/**
 * Monta os headers autenticados padrão com Bearer Token.
 */
export const montarHeadersAutenticados = async (headersExtras = {}) => {
  const token = await obterToken();
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'ngrok-skip-browser-warning': 'true',
    ...headersExtras
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
};

/* ==========================================================================
   GERENCIAMENTO DE PROVISIONAMENTO DO VEÍCULO (OPÇÃO B)
   ========================================================================== */

/**
 * Retorna os dados do veículo vinculado a este aparelho.
 */
export const obterVeiculoVinculado = async () => {
  try {
    const json = await AsyncStorage.getItem('@amiguinho:veiculo');
    if (json) {
      return JSON.parse(json);
    }
    return null;
  } catch (_) {
    return null;
  }
};

/**
 * Salva o vínculo deste celular com o veículo escolhido.
 */
export const salvarVeiculoVinculado = async (veiculo) => {
  if (!veiculo || !veiculo.id) return;
  const veiculoIdStr = String(veiculo.id);
  await AsyncStorage.multiSet([
    ['@amiguinho:veiculo', JSON.stringify(veiculo)],
    ['@amiguinho:veiculo_id', veiculoIdStr]
  ]);
};

/**
 * Desvincula o veículo e limpa os dados para novo provisionamento.
 */
export const desvincularVeiculo = async () => {
  await AsyncStorage.multiRemove([
    '@amiguinho:veiculo',
    '@amiguinho:veiculo_id',
    '@amiguinho:motorista_atual',
    '@amiguinho:carga_ativa',
    '@amiguinho:token',
    '@amiguinho:refreshToken',
    '@amiguinho:credenciais',
    'token'
  ]);
};

/**
 * Obtém os metadados da carga ativa no dispositivo.
 */
export const obterCargaAtiva = async () => {
  try {
    const json = await AsyncStorage.getItem('@amiguinho:carga_ativa');
    return json ? JSON.parse(json) : null;
  } catch (_) {
    return null;
  }
};

/**
 * Salva os metadados da carga ativa no dispositivo.
 */
export const salvarCargaAtiva = async (dadosCarga) => {
  if (dadosCarga) {
    await AsyncStorage.setItem('@amiguinho:carga_ativa', JSON.stringify(dadosCarga));
  }
};

/**
 * Limpa os dados da carga ativa do armazenamento.
 */
export const limparCargaAtiva = async () => {
  await AsyncStorage.removeItem('@amiguinho:carga_ativa').catch(() => {});
};

/**
 * Obtém os dados do motorista atual salvos da última carga baixada.
 */
export const obterMotoristaAtual = async () => {
  try {
    const json = await AsyncStorage.getItem('@amiguinho:motorista_atual');
    return json ? JSON.parse(json) : null;
  } catch (_) {
    return null;
  }
};

/**
 * Salva os dados do motorista associado à carga ativa.
 */
export const salvarMotoristaAtual = async (motorista) => {
  if (motorista) {
    await AsyncStorage.setItem('@amiguinho:motorista_atual', JSON.stringify(motorista));
  }
};
