# Testes e estado de validação

## Verificado para v0.2.1

- Compilação cruzada do ELF com SDK v0.44 e LLVM 20.
- Build de produção do frontend e verificação de traduções em 16 idiomas.
- Testes nativos de parser do Drive, filas, transporte HTTP, ciclo de vida e atalho de mídia.
- Smoke test da interface com APIs e gamepad simulados.
- Nove verificações simuladas do botão de conexão com o Drive, sem tráfego externo nem download de arquivos do usuário.

As capturas de tela são do navegador de desenvolvimento com respostas simuladas. Não representam uma captura do PS5.

## Reproduzir

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

Os testes Playwright usam o Chrome instalado. O teste de conexão inicia seu próprio servidor local. `tools/ui-test/smoke.cjs` requer o frontend compilado servido em `http://127.0.0.1:4173`; consulte o script antes de executar. Os testes nativos usam arquivos temporários no ambiente Linux e mocks dos serviços PS5.

## Cobertura relevante

O transporte simulado cobre erros SCE/TLS, repetição de conexão, redirecionamento indevido, falha de confirmação HTML, corpo incompleto e limpeza do temporário. Os testes de manutenção verificam confirmação, recusa durante atividade, arquivos desconhecidos e proteção contra links. Os de interface verificam seleção, destino, conflitos, cancelamento e estados de erro.

O transporte da v0.2.1 usa libcurl/OpenSSL com `/system/common/cert/CA_LIST.cer`; `console_curl.c` encaminha a resolução de nomes ao `sceNetResolver` do console, que deve respeitar o DNS definido nas configurações de rede do PS5. A validação de certificado e hostname permanece habilitada. O acesso real ao Google ainda precisa ser verificado no PS5.

O teste do botão Drive cobre ausência de acesso automático, envio da URL informada, bloqueio durante requisição, erro com nova tentativa, sucesso, pasta vazia, URL recusada, falha de transporte e estado offline. Bloqueia requisições externas e usa uma pasta fictícia.

## Ainda pendente no console

1. Carregar pelo elfldr no firmware 12.40 e confirmar abertura do navegador; repetir a validação separadamente no 13.60.
2. Listar uma pasta pública e baixar um arquivo pequeno autorizado; comparar tamanho e hash.
3. Repetir com confirmação de arquivo grande, cancelamento, indisponibilidade de rede e pouco espaço.
4. Validar botões físicos, teclado, diretórios externos e comportamento após standby.
5. Validar registro, abertura, encerramento e remoção do atalho HLDR00001.
6. Testar importação/autoload no Payload Manager e o fluxo de carregamento com Relapse.

**A nova implementação ainda não foi confirmada em hardware.** O ELF substitui o transporte HTTPS nativo por libcurl/OpenSSL e usa a lista de CAs do console, com verificação TLS habilitada. Teste a listagem e um download pequeno no PS5 usando o DNS configurado no console. Se falhar, envie o diagnóstico `HTTP/etapa/transporte/SCE/TLS` para separar resolução DNS, arquivo CA e validação do certificado.

É possível que o HLDRIVE também rode no firmware 13.60, porém ainda não foi testado nessa versão. O suporte encontrado no SDK e nos loaders é evidência de viabilidade, não um resultado de teste do HLDRIVE. Nenhuma homologação de toda a faixa de firmwares até 13.60 é declarada.
