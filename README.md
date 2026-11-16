# 🚚 Amiguinho Logística Mobile (Offline-First)

Aplicativo mobile de entregas e telemetria veicular desenvolvido para os motoristas e entregadores da **Distribuidora de Bebidas Amigão**. 

Construído em **React Native / Expo** com arquitetura **100% Offline-First**, rastreamento GPS inteligente em segundo plano, fila de sincronização resiliente em lote e **Blindagem Anti-Erro** para fixação de coordenadas de clientes.

---

## 🌟 Principais Recursos

- ⚡ **Arquitetura 100% Offline-First:** Toda a operação (carga de pedidos, confirmação de entregas e telemetria GPS) roda no banco SQLite local do celular. O entregador nunca fica travado por falta de sinal na rua.
- 📡 **Telemetria GPS Inteligente (Dynamic Tracking):**
  - **Em Movimento:** Coleta a cada **8 a 10 segundos** ou a cada **15 metros percorridos**, capturando curvas e esquinas com precisão cirúrgica sem cortar quarteirões.
  - **Veículo Parado / Em Descarga (< 8 metros):** Reduz automaticamente para **1 ponto por minuto (60s)**, economizando mais de 80% de bateria e espaço no banco de dados.
  - **Velocidade Real em km/h:** Conversão nativa com cálculo secundário por deslocamento ($\Delta d / \Delta t$) caso o sensor retorne 0.
- 🔒 **Filtro Estrito de Despacho (`status: 'rota'`):** O aplicativo só carrega e permite iniciar cargas despachadas pelo administrador no ERP (bloqueando cargas em montagem com status `'pendente'`).
- 🛡️ **Blindagem Anti-Erro no GPS do Cliente:** Valida se a entrega ocorreu com precisão de satélite ($\le 25\text{m}$) e veículo em repouso ($< 1.5\text{ m/s}$) antes de atualizar as coordenadas mestre do cliente no ERP.
- 🔄 **Motor de Sincronização Resiliente (FIFO):**
  - Monitora o estado de rede em tempo real (`NetInfo`).
  - Envia pacotes em lotes (`/api/v1/localizacoes/lote`) para alta performance.
  - **Regra de Ouro:** Registros só são marcados como sincronizados após confirmação HTTP 200/201 do servidor.
- 🚚 **Provisionamento por Veículo:** O celular é vinculado ao caminhão correspondente da frota, baixando as rotas daquele veículo automaticamente.
- 📦 **Página Dedicada de Pedido:** Fluxo com tela individual de entrega, remoção de lista de produtos para evitar uso indevido do celular fora do caminhão e foco na confirmação de entrega rápida.

---

## 🏗 Arquitetura do Ecossistema

```
                          ┌─────────────────────────┐
                          │   node-amiguinho-central│
                          │   ERP (Porta 4000)      │
                          └────────────▲────────────┘
                                       │ Baixas Comerciais / Cargas ('rota')
                                       │
┌───────────────────────────┐          │          ┌───────────────────────────┐
│  amiguinho-logistica-app  ├──────────┴──────────►   amiguinho-mobile-api    │
│  (Mobile React Native)    │  Telemetria GPS     │   (Microsserviço Porta    │
│  • SQLite Local           │  Lotes de Pontos    │    3334 - Neon PostgreSQL)│
│  • Background TaskManager │                     └─────────────▲─────────────┘
└───────────────────────────┘                                   │ WebSocket / Polling
                                                                │
                                                  ┌─────────────┴─────────────┐
                                                  │ amiguinho-logistica-painel│
                                                  │ (Painel Web - Porta 5173) │
                                                  └───────────────────────────┘
```

---

## 📂 Estrutura de Pastas do Módulo (`src/logistica/`)

```
src/logistica/
├── config/
│   ├── apiConfig.js               # Gestão de URLs (Central + Logística), token JWT e vínculo de veículo
│   └── constants.js               # Parâmetros de GPS, intervalos, blindagem e status
├── database/
│   └── sqliteService.js           # Banco SQLite local (WAL mode) com 4 tabelas relacionais
├── services/
│   ├── locationTaskService.js     # Background TaskManager, Foreground Service e Coleta Inteligente
│   ├── entregaService.js          # Confirmação de entrega com Blindagem Anti-Erro
│   ├── syncService.js             # Fila FIFO, monitor de rede NetInfo e envio em lote
│   ├── jornadaService.js          # Abertura e encerramento de jornada de trabalho
│   └── cargaService.js            # Download de pedidos da carga despachada ('status=rota')
├── hooks/
│   ├── useSyncStatus.js           # Hook reativo com estado de conectividade e contagem de pendências
│   └── useJornadaLogistica.js     # Hook orquestrador do ciclo da jornada, rotas e pedidos
├── components/
│   ├── BarraStatusSync.jsx        # Barra superior discreta indicando status de conexão
│   └── CardPedidoLogistica.jsx    # Card resumido do pedido na listagem da rota
├── screens/
│   ├── PainelJornadaScreen.jsx    # Painel principal da jornada do dia com resumo e pedidos
│   └── DetalhePedidoScreen.jsx    # Tela dedicada de detalhes e ações de entrega/cancelamento
├── utils/
│   └── uuid.js                    # Gerador de UUID v4 criptográfico idempotente
└── index.js                       # Ponto de entrada modular
```

---

## 🗄 Modelagem do Banco SQLite Local (`amiguinho_logistica.db`)

1. **`carga_pedidos`**: Armazena os pedidos da carga baixada do ERP para consulta offline instantânea.
2. **`jornadas_locais`**: Registra o ciclo da jornada (abertura, horário, veículo e conclusão).
3. **`localizacoes_locais`**: Histórico contínuo de telemetria GPS gravado pelo celular em segundo plano.
4. **`fila_eventos`**: Fila transacional de eventos operacionais e baixas comerciais a serem sincronizados.

---

## ⚙️ Configuração de Ambiente (`.env`)

Crie um arquivo `.env` na raiz do projeto baseado no `.env.example`:

```env
# 1. API Principal (ERP - node-amiguinho-central)
EXPO_PUBLIC_API_PRINCIPAL_URL=http://192.168.18.106:4000

# 2. API de Logística (amiguinho-mobile-api)
EXPO_PUBLIC_API_LOGISTICA_URL=http://192.168.18.106:3334
```

> **Dica para Testes na Rua (4G):**
> Ao testar em campo via 4G, você pode apontar as variáveis para um túnel público seguro (ex: `ngrok`):
> ```env
> EXPO_PUBLIC_API_PRINCIPAL_URL=https://seu-tunel.ngrok-free.dev/central
> EXPO_PUBLIC_API_LOGISTICA_URL=https://seu-tunel.ngrok-free.dev
> ```

---

## 🚀 Como Executar o Projeto

### 1. Pré-requisitos
- Node.js 18+ instalado
- Aplicativo **Expo Go** instalado no smartphone físico (Android ou iOS)

### 2. Instalação das Dependências
```bash
npm install
```

### 3. Inicialização do Metro Bundler
```bash
npx expo start
```
Ou para iniciar limpando o cache:
```bash
npx expo start -c
```

### 4. Abrir no Celular
- Abra o aplicativo **Expo Go** no celular.
- Escaneie o **QR Code** exibido no terminal (certifique-se de que o computador e o smartphone estejam na mesma rede Wi-Fi, ou utilize o modo tunnel).

---

## 📱 Permissões de Localização (Android)

Para o rastreamento em segundo plano operar com máxima precisão mesmo com a tela do celular apagada:
1. Nas configurações do Android, conceda à aplicação a permissão de localização como **"Permitir o tempo todo"** (*Allow all the time*).
2. Na configuração de bateria do app, escolha **"Sem restrições"** (*Unrestricted*) para evitar que o modo Doze do sistema operacional suspenda a captura de GPS.

---

## 📄 Licença

Este projeto é de uso proprietário e exclusivo da **Distribuidora de Bebidas Amigão**. Todos os direitos reservados.
