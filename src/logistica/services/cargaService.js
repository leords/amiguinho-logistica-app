// src/logistica/services/cargaService.js
import {
  getApiPrincipalUrl,
  montarHeadersAutenticados,
  obterVeiculoVinculado,
  salvarMotoristaAtual,
  obterToken,
  salvarCargaAtiva,
  limparCargaAtiva
} from '../config/apiConfig';
import * as sqliteService from '../database/sqliteService';
import {
  obterDataHojeIsoBrasil,
  obterDataHojeFormatadaPtBr,
  ehDataDeHoje
} from '../utils/date';

/**
 * Baixa a carga de pedidos ativa ('rota') vinculada ao veículo configurado no dispositivo,
 * filtrando estritamente pela data do dia atual (não busca nem exibe cargas de dias anteriores).
 * Endpoint oficial: GET ${API_PRINCIPAL_URL}/cargas?veiculoId=${veiculoId}&status=rota&dataInicio=${hoje}&dataFim=${hoje}
 */
export const baixarCargaDoDia = async () => {
  const baseUrl = getApiPrincipalUrl();
  const veiculo = await obterVeiculoVinculado();

  if (!veiculo || !veiculo.id) {
    throw new Error('Nenhum caminhão está vinculado a este celular. Realize o provisionamento na tela de login.');
  }

  const veiculoId = veiculo.id;
  const hoje = obterDataHojeIsoBrasil();
  const dataFormatadaDia = obterDataHojeFormatadaPtBr();
  const url = `${baseUrl}/cargas?veiculoId=${veiculoId}&status=rota&dataInicio=${hoje}&dataFim=${hoje}`;

  console.log(`[cargaService] Consultando rota despachada de hoje (${dataFormatadaDia}) para o Veículo ID ${veiculoId} (${veiculo.nome || veiculo.placa}): ${url}`);

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
    // Se a jornada não está em andamento, limpa os pedidos locais para não exibir resquícios de outros dias
    const jornadaAtiva = await sqliteService.obterJornadaAtiva();
    if (!jornadaAtiva) {
      await sqliteService.limparCargaPedidos().catch(() => {});
      await limparCargaAtiva().catch(() => {});
    }

    return {
      sucesso: false,
      total: 0,
      mensagem: `Nenhuma carga despachada para hoje (${dataFormatadaDia}) foi encontrada para o veículo ${veiculo.nome || veiculo.placa}.`
    };
  }

  // Filtra estritamente cargas despachadas com status 'rota' pertencentes ao dia de hoje
  const cargasEmRota = listaCargas.filter((c) => {
    const st = String(c.status || '').toLowerCase();
    if (st !== 'rota') return false;
    // Dupla blindagem: confere se a data da carga é de hoje
    if (c.data && !ehDataDeHoje(c.data)) return false;
    return true;
  });

  if (cargasEmRota.length === 0) {
    // Se a jornada não está em andamento, limpa os pedidos locais para não exibir cargas de outros dias
    const jornadaAtiva = await sqliteService.obterJornadaAtiva();
    if (!jornadaAtiva) {
      await sqliteService.limparCargaPedidos().catch(() => {});
      await limparCargaAtiva().catch(() => {});
    }

    const mensagem = `Nenhuma carga em rota encontrada para hoje (${dataFormatadaDia}) no veículo ${veiculo.nome || veiculo.placa}. Aguarde a liberação do administrador.`;
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

  // 4. Salva metadados da carga ativa para auditoria e controle de ciclo de vida
  await salvarCargaAtiva({
    id: cargaAtiva.id,
    data: cargaAtiva.data,
    status: cargaAtiva.status,
    totalPedidos: inseridos
  }).catch(() => {});

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
