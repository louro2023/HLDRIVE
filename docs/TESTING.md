# Testes e validação

## Transporte segmentado e velocidade

Compile e execute o ensaio de HTTPS local no ambiente Linux com libcurl de desenvolvimento e CLI OpenSSL:

```sh
g++ -O2 -std=c++20 -Isource/backend/include tests/drive_transport_test.cpp -lcurl -pthread -o build/drive_transport_test
python3 tools/test-drive-transport.py
```

O ensaio utiliza o transporte de produção sem desabilitar TLS ou a allowlist, através de um adaptador de teste para conectar o hostname Google à fixture local com certificado de teste. Verifica todos os bytes recebidos, serialização/monotonicidade do progresso, agrupamento de gravações, fallback sequencial, intervalos inválidos, mudança de identidade, truncamento, HTML e cancelamento. A fixture não acessa o Google nem o console. Resultados ficam em `build/drive-transport-results.json`; os dois últimos casos comparam oito e 16 workers sob um limite artificial por conexão, sem representar velocidade real no PS5.

O teste `node tools/ui-test/drive-download.cjs` verifica também a conversão de 62.500.000 bytes/s para 500,0 Mbps/59,6 MiB/s, média, conexões ativas e explicação do fallback, além de conclusão/erro e layout móvel. As traduções novas estão em pt-BR, en-US e es-AR.

## Confirmações de download do Google Drive

O download reconhece formulários com parâmetros na action e nos campos ocultos, links antigos `/uc` e `downloadUrl` em JSON. As confirmações são limitadas ao mesmo ID de arquivo e aos endpoints HTTPS de download do Google. A chave de recurso é preservada. Avisos reconhecidos são processados automaticamente e indicados na transferência; não é necessário login para pastas públicas.

Cookies anônimos ficam somente em memória e são compartilhados, com locks, entre consulta, redirecionamentos e conexões de download. O teste `tests/drive_cookies_test.cpp` usa libcurl real sem rede e verifica a preservação após fechar a consulta e abrir oito handles em paralelo. Para a suíte offline, instale os headers e a biblioteca de desenvolvimento do libcurl no ambiente Linux (`curl-dev` no Alpine).

Os testes de parser e fila simulam confirmação seguida de arquivo, confirmação repetida, página desconhecida e cota excedida. Páginas de erro não são salvas como arquivos. `node tools/ui-test/drive-download.cjs` verifica aviso, conclusão, erro e layout móvel com APIs simuladas e tráfego externo bloqueado. O texto de erro fornecido pelo Google é exibido como texto, sem executar HTML.

Validação local: parser, fila, cookies, transporte sintético, interface de download, build do frontend e traduções passaram. A suíte offline completa encontra uma falha preexistente em `tests/lifecycle_test.cpp`: referência a `RemoveSettingsAt`, que não existe no código atual. Esse teste não foi alterado por esta correção. Os testes simulados não comprovam downloads reais de arquivos grandes no PS5; essa verificação ainda deve ser feita no console.

## Idiomas — versão 1.0.2

`node tools/ui-test/languages.cjs` inicia um servidor de teste local e simula as APIs. Verifica as três opções com bandeiras, troca imediata, preservação dos arquivos selecionados, tradução do destino e do aviso de exclusão, arquivos locais, persistência após recarregar, foco por teclado/gamepad e layout móvel. Bloqueia tráfego externo e não inicia downloads nem ações de manutenção.

Passaram o build de produção do frontend, `check:i18n`, o teste de idiomas, o smoke test e as nove verificações de conexão com o Drive. O verificador confere as 17 bases herdadas (incluindo es-AR) e, separadamente, as três traduções HLDRIVE e seus parâmetros. Apenas pt-BR, en-US e es-AR são oferecidos na interface.

A compilação do ELF 1.0.2 com SDK v0.44 e LLVM 20 também passou. A nova navegação de idiomas ainda não foi testada no hardware. Preferências ficam no armazenamento local do navegador; diagnósticos do backend não são traduzidos automaticamente.

## Estado da versão 1.0.1

O usuário testou a versão 1.0.1 em seu PS5 e confirmou que a transferência do Drive funciona com velocidade muito maior, relatando mais de 500 Mb/s. Firmware, método de medição e detalhes da rede não foram informados; o resultado pode variar conforme o ambiente.

A compilação local valida a geração do frontend e do ELF. As verificações de traduções conferem as 16 localidades. Os testes automatizados existentes cobrem parser do Drive, filas, transporte HTTP, ciclo de vida, proteção de arquivos e interações simuladas da interface. As simulações não reproduzem a rede nem os serviços do PS5.

## Reproduzir verificações locais

Com o ambiente de compilação configurado, na raiz:

```sh
bash tools/test-offline.sh
cd source/frontend
npm ci
npm run build
npm run check:i18n
cd ../../tools/ui-test
npm ci
cd ../..
node tools/ui-test/drive-connect.cjs
```

Os testes de interface usam APIs simuladas e não acessam pastas reais. Consulte os scripts antes de executá-los. O build de produção é executado por `build.ps1`.

## Verificação no PS5

Para validar em outro ambiente, confirme abertura da interface na porta 8081, listagem e download de uma pasta pública autorizada do Drive, navegação e escrita em arquivos locais, controle, miniatura do atalho de Mídia e ações de encerramento/exclusão. Em um arquivo grande, compare o tempo e a velocidade informada com uma conexão única, e observe que o modo paralelo é usado somente quando o servidor confirma suporte a intervalos.

O transporte usa libcurl/OpenSSL e `/system/common/cert/CA_LIST.cer`; a validação de certificado e hostname permanece habilitada. A resolução de nomes respeita o DNS configurado no console.
