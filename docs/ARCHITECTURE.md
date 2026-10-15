# Arquitetura do HLDRIVE

O ELF reúne backend C/C++, servidor HTTP e frontend React. O próprio payload PS5 consulta o Google Drive e grava os arquivos no armazenamento do console.

## Inicialização

O processo prepara /data/HLDRIVE, inicia filas e rotas HTTP na porta 8081 e registra/atualiza o atalho HLDR00001 na aba Mídia. O servidor inicia antes do registro para que o destino do atalho já esteja disponível. A interface pode ser aberta no navegador do console ou em outro dispositivo da mesma rede. As chamadas de rede ao Drive são executadas pelo payload no PS5.

## Google Drive

O payload consulta embeddedfolderview pelo libcurl/OpenSSL do PacBrew e retorna a listagem à interface. O helper `console_curl.c` resolve nomes pelo `sceNetResolver` do PS5 e lê `/system/common/cert/CA_LIST.cer` para validação TLS.

Ao baixar, o payload segue redirecionamentos HTTPS apenas entre hosts Google permitidos e grava o fluxo no destino escolhido no console. A validação de certificado e hostname permanece habilitada. O DNS segue a configuração de rede do PS5.

O payload não depende de um serviço auxiliar no computador para consultar o Drive.

## Interface e recursos

`source/frontend` contém React/Vite, navegação por foco e suporte a gamepad padrão. `source/tools/gen_assets.py` comprime os arquivos compilados e gera os recursos incorporados ao backend. As imagens originais ficam em `assets/branding`; as variantes usadas pela interface e pelo atalho são incorporadas ao ELF.

O navegador controla as operações por `/api/...`. `/api/status` informa o estado; as rotas de Drive tratam configuração, listagem, cópia, cancelamento e histórico. O gerenciador local oferece operações de arquivos. As operações de escrita compartilham proteção contra alterações concorrentes.

## Ciclo de vida

`/api/app/action` recebe ações distintas para encerrar, excluir e registrar o atalho. Confirmação explícita é exigida e operações ativas impedem a manutenção. O encerramento ocorre após responder à interface.

A exclusão valida `/data/HLDRIVE`, apaga a árvore sem seguir links simbólicos nem atravessar montagens, e remove `HLDRIVE.elf` da pasta configurada quando externa. Arquivos fora da pasta do HLDRIVE são preservados.

O título HLDR00001, em `/user/app/HLDR00001`, é um atalho de navegador para o servidor local. Ele não reinicia o ELF. O registro usa `sceAppInstUtilAppInstallTitleDir`, com `sceAppInstUtilAppInstallAll` como fallback. O `param.json` classifica o título como Media (`applicationCategoryType: 65536`) e aponta para `/user/app/HLDR00001/sce_sys/icon0.png`.

## Limites de segurança e validação

As APIs não possuem autenticação nem proteção completa contra requisições de outras origens. A porta 8081 deve permanecer numa rede confiável. As verificações de arquivos e confirmações de interface não substituem autenticação.

Testes simulados verificam lógica, erros e preservação de arquivos. Eles não comprovam TLS, certificados, serviços do sistema, permissões ou comportamento do navegador no hardware. Consulte [TESTING.md](TESTING.md).
