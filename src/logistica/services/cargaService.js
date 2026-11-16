// src/logistica/services/cargaService.js
import {
  getApiPrincipalUrl,
  montarHeadersAutenticados,
  obterVeiculoVinculado,
  salvarMotoristaAtual,
  obterToken
} from '../config/apiConfig';
import * as sqliteService from '../database/sqliteService';

/**
 * Baixa a carga de pedidos ativa ('rota' ou 'pendente') vinculada ao veículo configurado no dispositivo.
 * Endpoint oficial: GET ${API_PRINCIPAL_URL}/cargas?veiculoId=${veiculoId}
 */
export const baixarCargaDoDia = async () => {
  const baseUrl = getApiPrincipalUrl();
  const veiculo = await obterVeiculoVinculado();

  if (!veiculo || !veiculo.id) {
    throw new Error('Nenhum caminhão está vinculado a este celular. Realize o provisionamento na tela de login.');
  }

  const veiculoId = veiculo.id;
  const url = `${baseUrl}/cargas?veiculoId=${veiculoId}&status=rota`;

  console.log(`[cargaService] Consultando rota despachada para o Veículo ID ${veiculoId} (${veiculo.nome || veiculo.placa}): ${url}`);

  let resposta = null;
  let headers = await montarHeadersAutenticados();

  try {
    resposta = await fetch(url, { method: 'GET', headers });

    // Se o token estiver expirado (401), força renovação silenciosa e tenta mais uma vez
    if (resposta.status === 401) {
      console.warn('[cargaService] Token expirado ao buscar carga. Renovando silenciosamente...');
      await obterToken(true);
      headers = await montarHeadersAutenticados();
      resposta = await fetch(url, { method: 'GET', headers });
    }
  } catch (redeErr) {
    console.error('[cargaService] Erro de rede ao buscar carga:', redeErr.message);
    throw new Error(`Falha de conexão com o servidor (${redeErr.message}). Verifique se está conectado.`);
  }

  if (!resposta.ok) {
    const erroJson = await resposta.json().catch(() => ({}));
    const mensagemErro = erroJson?.erro?.mensagem || erroJson?.mensagem || `Erro HTTP ${resposta.status} da API.`;
    throw new Error(mensagemErro);
  }

  const json = await resposta.json();
  const listaCargas = Array.isArray(json) ? json : (json.resultado || json.cargas || []);

  if (!listaCargas || listaCargas.length === 0) {
    return {
      sucesso: false,
      total: 0,
      mensagem: `Nenhuma carga foi encontrada no servidor para o veículo ${veiculo.nome || veiculo.placa}.`
    };
  }

  // Filtra estritamente cargas despachadas com status 'rota'
  const cargasEmRota = listaCargas.filter((c) => {
    const st = String(c.status || '').toLowerCase();
    return st === 'rota';
  });

  if (cargasEmRota.length === 0) {
    // Se a jornada não está em andamento, limpa os pedidos locais para não exibir cargas pendentes
    const jornadaAtiva = await sqliteService.obterJornadaAtiva();
    if (!jornadaAtiva) {
      await sqliteService.limparCargaPedidos();
    }

    const temPendente = listaCargas.some((c) => String(c.status || '').toLowerCase() === 'pendente');
    const mensagem = temPendente
      ? `A carga deste veículo ainda não foi despachada pelo administrador (status atual: 'pendente'). Aguarde a liberação para iniciar a rota.`
      : `Nenhuma carga com status 'rota' foi encontrada para o veículo ${veiculo.nome || veiculo.placa}. Aguarde o administrador despachar a rota.`;

    console.log(`[cargaService] ${mensagem}`);

    return {
      sucesso: false,
      total: 0,
      mensagem
    };
  }

  // O backend já ordena por data decrescente (orderBy: { data: 'desc' }).
  // Portanto, a primeira carga com status 'rota' é a mais recente.
  const cargaAtiva = cargasEmRota[0];

  console.log(`[cargaService] Rota despachada encontrada: ID ${cargaAtiva.id} (Status: ${cargaAtiva.status}) - ${cargaAtiva.descricao || 'Sem descrição'}. Motorista: ${cargaAtiva.motorista?.nome || 'Não definido'}`);

  // 1. Salva os dados do motorista associado para exibir no topo da aplicação
  if (cargaAtiva.motorista) {
    await salvarMotoristaAtual(cargaAtiva.motorista);
  }

  // 2. Extrai e normaliza os pedidos da carga
  const pedidos = cargaAtiva.pedidos || [];
  if (pedidos.length === 0) {
    await sqliteService.limparCargaPedidos();
    return {
      sucesso: true,
      total: 0,
      cargaId: cargaAtiva.id,
      statusCarga: cargaAtiva.status,
      motorista: cargaAtiva.motorista,
      mensagem: `A carga #${cargaAtiva.id} não possui pedidos anexados.`
    };
  }

  const pedidosNormalizados = pedidos.map((p) => {
    const cliente = p.cliente || {};
    const enderecoFormatado = cliente.endereco
      ? `${cliente.endereco}${cliente.cidade ? ' - ' + cliente.cidade : ''}`
      : 'Endereço não informado';

    return {
      pedidoId: String(p.uuid || p.id),
      numero: Number(p.id || 0),
      valorTotal: Number(p.total || 0),
      formaPagamento: String(p.formaPagamento?.nome || 'A VISTA'),
      status: p.status === 'entregue' ? 'ENTREGUE' : 'PENDENTE',
      clienteId: String(p.clienteId || cliente.id || ''),
      clienteNome: String(cliente.nome || 'Cliente'),
      clienteEndereco: enderecoFormatado,
      clienteLatitude: cliente.latitude || null,
      clienteLongitude: cliente.longitude || null,
      gpsConfirmado: (cliente.gpsConfirmado || p.gpsConfirmado) ? 1 : 0,
      itensJson: JSON.stringify(p.itens || [])
    };
  });

  // 3. Limpa pedidos anteriores para não misturar cargas antigas e grava os novos no SQLite local
  await sqliteService.limparCargaPedidos();
  const inseridos = await sqliteService.salvarCargaPedidos(pedidosNormalizados);

  console.log(`[cargaService] Carga #${cargaAtiva.id} (${cargaAtiva.status}) persistida no SQLite local com ${inseridos} pedidos.`);

  const statusFormatado = String(cargaAtiva.status || '').toUpperCase();
  return {
    sucesso: true,
    total: inseridos,
    cargaId: cargaAtiva.id,
    statusCarga: cargaAtiva.status,
    motorista: cargaAtiva.motorista,
    veiculo: cargaAtiva.veiculo,
    mensagem: `Carga #${cargaAtiva.id} (${statusFormatado}) baixada com ${inseridos} pedidos para o motorista ${cargaAtiva.motorista?.nome || 'associado'}!`
  };
};

/**
 * Consulta os pedidos da carga direto do SQLite local (0% dependência de rede).
 */
export const carregarPedidosLocais = async (filtroStatus = null) => {
  return await sqliteService.listarPedidosLocais(filtroStatus);
};

/**
 * Retorna os totais da carga para o cabeçalho e estatísticas da tela.
 */
export const obterEstatisticasCarga = async () => {
  return await sqliteService.obterResumoCarga();
};
