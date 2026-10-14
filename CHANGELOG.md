# Histórico de alterações

## Atualização da documentação — 2026-10-14

- Esclarecida a possibilidade de execução no firmware 13.60, com base no suporte do SDK e dos loaders. O HLDRIVE ainda não foi testado nessa versão.
- README, compatibilidade, plano de testes e notas da release atualizados. Esta revisão documental não altera o ELF v0.2.0.

## v0.2.0 — 2026-10-14 — primeira publicação experimental

### Interface

- Google Drive e Arquivos do PS5 com base nos componentes do Prospero.
- Solicitação de abertura no navegador do PS5, foco destacado, setas e gamepad padrão.
- Artes incorporadas: ícone de mídia, favicon, miniatura no menu, banner e capa de encerramento.

### Transferências

- Listagem pública, subpastas, seleção e escolha de destino no console.
- Fila sequencial, progresso, velocidade média, tempo estimado, cancelamento e limpeza de histórico.
- Conflitos: pular, manter ambos ou parar o item.
- SNI explícito, proxy automático desabilitado, conteúdo sem compressão e maior capacidade do contexto/cabeçalhos HTTP.
- Uma repetição de conexão antes da gravação quando não há falha TLS identificada.
- Códigos SCE/TLS e etapa preservados; tratamento de erros de confirmação, respostas truncadas e escrita interrompida.

### Gerenciamento

- Encerrar/excluir com confirmações distintas e bloqueio durante operações ativas.
- Remoção limitada a arquivos reconhecidos, com verificações de propriedade e links.
- Registro de HLDR00001 na aba Mídia e botão para repetir a tentativa.

### Validação

- Build com SDK v0.44; testes sintéticos de parser, fila, HTTP, ciclo de vida e proteção do atalho.
- Testes Playwright de listagem, erros, navegação, copiar/colar e gerenciamento.
- Análise do fluxo elfldr/Payload Manager/Relapse, sem homologação em hardware.
- A correção da falha real de transferência ainda depende de teste no PS5. Esta release não promete sua resolução.

## 0.1.0 — desenvolvimento local, sem release pública

- Estrutura C++/React, importação seletiva do Prospero, listagem e download para o console.
- Backend e interface em um único ELF; primeiros testes simulados.

Nomes de arquivos de backup locais não representam versões publicadas.
