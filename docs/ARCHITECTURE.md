# Arquitetura do HLDRIVE

O ELF reúne backend C/C++, servidor HTTP e frontend React. Não depende de um servidor externo do projeto. A interface é derivada do ProsperoMgr; a integração do Drive executa no console.

## Inicialização

O processo prepara `/data/HLDRIVE`, impede uma segunda instância com `instance.lock`, inicia as filas, registra as rotas HTTP e tenta registrar o atalho HLDR00001. O servidor escuta na porta 7070. A abertura do navegador usa os serviços do PS5; sua disponibilidade depende do ambiente homebrew.

## Google Drive

1. O usuário informa uma pasta pública. Sua URL pode ser persistida em `/data/HLDRIVE/drive-folder.txt`.
2. O backend consulta `embeddedfolderview` por HTTPS e interpreta nomes, IDs e subpastas. Abrir uma pasta não baixa seus arquivos.
3. A seleção cria tarefas com um destino local validado e política de conflitos.
4. O trabalhador resolve URLs de download e formulários de confirmação do Google. Redirecionamentos são limitados a hosts HTTPS permitidos.
5. O corpo é gravado em blocos de 256 KiB num arquivo temporário `.part`; ao concluir, ele é renomeado para o destino final. Respostas HTML não são aceitas como arquivos.

O transporte usa `sceNet`, `sceSsl` e `sceHttp`, com SNI, proxy automático desativado, `Accept-Encoding: identity`, buffer de cabeçalhos ampliado e diagnóstico por etapa. Uma tentativa adicional de conexão é permitida antes da escrita quando não há erro TLS identificado. A política de certificados da plataforma não é substituída por um callback que aceite tudo.

Há uma fila sequencial, até 32 itens ativos e histórico limitado. A expansão de pastas tem limite de 32 níveis e 10.000 itens. As tarefas não sobrevivem à saída do processo. Não há retomada de parciais nem garantia de paginação completa de grandes bibliotecas. O HTML público do Google pode mudar.

## Interface e recursos

`source/frontend` contém React/Vite, navegação por foco e suporte a gamepad padrão. `source/tools/gen_assets.py` comprime os arquivos compilados e gera os recursos incorporados ao backend. As imagens originais ficam em `assets/branding`; as variantes usadas pela interface e pelo atalho são incorporadas ao ELF.

O navegador controla as operações por `/api/...`. `/api/status` informa o estado; as rotas de Drive tratam configuração, listagem, cópia, cancelamento e histórico. O gerenciador local conserva os recursos do Prospero. As operações de escrita compartilham proteção contra alterações concorrentes.

## Ciclo de vida

`/api/app/action` recebe ações distintas para encerrar, excluir e registrar o atalho. Confirmação explícita é exigida e operações ativas impedem a manutenção. O encerramento ocorre após responder à interface.

A exclusão usa uma lista de arquivos conhecidos, verifica links e propriedade do diretório do atalho, e preserva downloads e arquivos desconhecidos. Não faz remoção recursiva de `/data/HLDRIVE`. Também não remove cópias do ELF mantidas pelo loader ou configurações de autoload externas.

O título HLDR00001, em `/user/app/HLDR00001`, é um atalho de navegador para o servidor local. Ele não é um loader nem reinicia o ELF. Seu registro individual usa o serviço AppInstUtil, quando disponível.

## Limites de segurança e validação

As APIs não possuem autenticação nem proteção completa contra requisições de outras origens. A porta 7070 deve permanecer numa rede confiável. As verificações de arquivos e confirmações de interface não substituem autenticação.

Testes simulados verificam lógica, erros e preservação de arquivos. Eles não comprovam TLS, certificados, serviços do sistema, permissões ou comportamento do navegador no hardware. Consulte [TESTING.md](TESTING.md).
