# Histórico de alterações

## v1.1.2-rc.1 — 2026-10-26 — pré-release

- Links de pastas salvos no navegador, com nome opcional, abertura direta, exclusão e prevenção de duplicatas.
- Avisos conhecidos do Google Drive traduzidos em português, inglês e espanhol: cota de downloads, permissão, arquivo indisponível, login e bloqueios de segurança.
- A troca de idioma atualiza também erros e avisos de transferências já exibidos. Avisos desconhecidos recebem texto genérico traduzido; o original permanece no log.
- ELF distribuído como `HLDRIVE 1.1.2-rc.1.elf`, com versão atualizada na interface, backend e metadados do atalho.
- Mantém os recursos experimentais da 1.1.1-rc.1; execução e desempenho no PS5 ainda precisam de validação.
- [Notas completas](docs/releases/v1.1.2-rc.1.md).

## v1.1.1-rc.1 — 2026-10-22 — pré-release

- Fundo e banner animados em azul, verde e dourado, com CSS e suporte a movimento reduzido.
- Alternativa de validação por Last-Modified para downloads paralelos sem ETag, sob critérios conservadores e conferência de cada segmento.
- 21 cenários HTTPS sintéticos aprovados. Build do frontend, traduções, testes locais da interface e compilação do ELF concluídos.
- Velocidade no Google Drive e fluidez no PS5 ainda não comprovadas. Firmware 13.60 possivelmente compatível, mas não testado.
- [Notas completas](docs/releases/v1.1.1-rc.1.md).

## v1.1.0 — 2026-10-16 — pré-release

- Modernização visual: superfícies em azul grafite, detalhes em azul/ciano, botões, cartões, navegação lateral, ícones e diálogos consistentes.
- Barras de progresso com gradiente, transições suaves e tratamento visual distinto do carregamento indeterminado. Valores e semântica de progresso preservados.
- Ajustes para telas de 360 a 1920 pixels, tema claro/escuro e preferências de movimento reduzido, mantendo foco por teclado e controle.
- Fluxos, APIs e motor de download preservados em relação à 1.0.3-rc.1. Alterações de backend limitadas à versão e aos recursos visuais incorporados.
- Arquivo distribuído como `HLDRIVE 1.1.0.elf`. Validação local e limitações descritas em `docs/releases/v1.1.0.md`.

## v1.0.3-rc.1 — 2026-10-16 — pré-release

- Tratamento ampliado das confirmações de download do Drive e cookies anônimos em memória, com avisos no painel.
- Até 16 conexões, segmentos de 8 MiB, reaproveitamento de conexões e buffers, gravações agrupadas e menor frequência de atualização do progresso.
- Velocidade recente em Mbps/MiB/s, média, conexões ativas e motivo do fallback sequencial.
- Adicionados testes de HTTPS local com conferência dos bytes e testes de interface/erros. A compilação passou; o desempenho no PS5 ainda precisa ser medido.
- Catálogo estável mantido na 1.0.2. Limitações e falha preexistente da suíte offline descritas em `docs/releases/v1.0.3-rc.1.md`.

## Catálogo do Payload Manager — 2026-10-15

- Publicada fonte personalizada `repository/payloads.json`, com download e checksum do ELF 1.0.2.
- Adicionada miniatura da logo HLDRIVE em JPEG 128×128 e catálogo `icons.json`, conforme o formato do Payload Manager v0.6.1.
- O ELF permanece inalterado; a miniatura é fornecida pela fonte adicionada ao Manager, não extraída do payload.

## v1.0.2 — 2026-10-15

- Adicionado seletor de idioma com bandeiras SVG para Português (Brasil), English (US) e Español (Argentina).
- Traduzidas as telas próprias do HLDRIVE, incluindo Drive, filas, confirmações e mensagens de encerramento; arquivos locais reutilizam o sistema de traduções do Prospero.
- Preferência salva por navegador e troca imediata preservando os itens selecionados.
- Foco do controle limitado ao menu de idiomas aberto; navegação por teclado, Tab e fechamento com Escape/○.
- Adicionados testes de troca de idioma, persistência, parâmetros das mensagens, diálogos, bandeiras e layout móvel.
- Unificada a versão 1.0.2 na interface, API e metadados de mídia. Ajustada a verificação de checksum das dependências para aceitar BusyBox.
- Testes de interface usam dados simulados; a nova seleção de idiomas ainda precisa de confirmação no PS5. Diagnósticos retornados pelo backend preservam seu texto original.

## v1.0.1 — 2026-10-15

- Aumentada a velocidade de download de arquivos grandes com até oito conexões de intervalo para um mesmo arquivo, quando o Google Drive oferece suporte seguro a essa modalidade.
- Aumentados os buffers de recepção de rede e do libcurl para melhorar transferências em uma única conexão.
- Mantida uma fila serial para arquivos adicionais; somente as partes do arquivo atual são baixadas em paralelo.
- O usuário testou a versão no PS5 e relatou velocidade acima de 500 Mb/s. O resultado depende da rede e do servidor.
- Corrigida a detecção de versões do arquivo durante o download; quando o servidor não confirma suporte a intervalos, o payload usa a transferência convencional.

## v1.0.0 — 2026-10-15

- Adicionados QR codes discretos para o canal do criador e apoio financeiro.
- Incluída chamada para apoiar o projeto na interface.
- Removidas referências promocionais a projetos e payloads externos da interface e da documentação de uso.
- Atualizadas versões do aplicativo, do frontend e dos metadados do atalho de Mídia.
- Mantida a porta HTTP 8081 e as funções de navegação, transferência e gerenciamento de arquivos.
- O usuário informou que a versão 1.0.0 foi testada e funciona. A compilação desta publicação foi gerada localmente; esta preparação não realizou teste em hardware.

## v0.2.2 — 2026-10-14

- Alterada a porta HTTP de 7070 para 8081 no servidor, abertura automática, atalho de Mídia e configuração de desenvolvimento.
- Atualizado o registro do atalho para aplicar a categoria Mídia e a miniatura do HLDRIVE.
- A versão 0.2.1 foi confirmada pelo usuário como funcionando no console.

## v0.2.1 — 2026-10-14

- Substituído o transporte HTTPS nativo por libcurl/OpenSSL com validação de certificados usando as autoridades do sistema PS5.
- Resolução de nomes respeita o DNS configurado no próprio console.
- Atualizados scripts de compilação e documentação técnica.
- Posteriormente, o usuário confirmou que esta versão funciona no PS5.

## v0.2.0 — 2026-10-14

- Primeira publicação experimental com listagem de pastas públicas do Drive, escolha de destino e downloads no console.
- Adicionadas operações locais de arquivos, navegação por controle e registro do atalho na aba Mídia.
- Incluídos cancelamento, acompanhamento de progresso e confirmação para ações de manutenção.

## 0.1.0 — desenvolvimento local

- Estrutura C++/React, listagem do Drive e download no console.
