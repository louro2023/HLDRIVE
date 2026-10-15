# Testes e validação

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
