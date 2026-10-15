# Histórico de alterações

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
