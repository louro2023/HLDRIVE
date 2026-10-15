# Testes e validação

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
