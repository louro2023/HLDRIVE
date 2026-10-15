# Testes e validação

## Estado da versão 1.0.0

O usuário informou que a versão 1.0.0 foi testada e funciona em seu PS5. Não foram fornecidos firmware, cenário de teste nem detalhes do ambiente. Este relato é do usuário; as alterações desta publicação foram compiladas localmente, mas não foram testadas em hardware durante esta preparação.

A compilação local verifica a geração do frontend e do ELF. Os testes automatizados existentes cobrem parser do Drive, filas, transporte HTTP, ciclo de vida, proteção de arquivos e interações simuladas da interface. As simulações não validam certificados ou comportamento dos serviços do console.

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

Para validar em outro ambiente, confirme abertura da interface na porta 8081, listagem e download de uma pasta pública autorizada do Drive, navegação e escrita em arquivos locais, controle, miniatura do atalho de Mídia e ações de encerramento/exclusão. Testes em firmwares diferentes exigem validação separada.

O transporte usa libcurl/OpenSSL e `/system/common/cert/CA_LIST.cer`; a validação de certificado e hostname permanece habilitada. A resolução de nomes respeita o DNS configurado no console.
