# Compilação

## Ambiente de referência

A release v0.2.0 foi compilada com PS5 Payload SDK v0.44, LLVM/Clang 20, Alpine Linux 3.22 em WSL2 e libmicrohttpd 1.0.2 estática. São necessários Node.js/npm, Python 3 e GNU Make. Os testes nativos também precisam de GCC/G++ com C++20.

Instale o [PS5 Payload SDK](https://github.com/ps5-payload-dev/sdk) seguindo suas instruções. Os scripts locais esperam o SDK em `/opt/ps5-payload-sdk`. Eles não instalam nem configuram automaticamente uma distribuição WSL.

`tools/setup-build.sh` prepara dependências no ambiente Alpine com SDK já instalado e compila libmicrohttpd para o alvo do SDK, sem HTTPS nessa biblioteca. O HTTPS do Drive usa os serviços nativos do PS5, não libmicrohttpd.

## Linux / WSL

Na raiz do checkout, com o SDK e as dependências preparados:

```sh
bash build.sh
```

O fluxo instala/compila o frontend, incorpora seus recursos, compila o backend e gera `build/HLDRIVE.elf` e seu SHA-256. Consulte o script para os comandos exatos. A compilação usa C++20 e as bibliotecas nativas indicadas no Makefile.

## Windows

```powershell
.\build.ps1
```

Esse script espera uma distribuição WSL chamada `HLDRIVE-build`, SDK instalado e LLVM em `/usr/lib/llvm20`. Ajuste esses caminhos para seu ambiente. Node/npm e Python devem estar disponíveis também no Windows. O frontend é compilado no Windows; o backend, no WSL.

Em máquinas com pouca memória, reduza o paralelismo de `make` e configure os recursos do WSL conforme seu ambiente. O projeto não altera automaticamente a configuração global do WSL.

## Artefatos

- `build/HLDRIVE.elf`: único arquivo necessário para carregar o payload.
- `build/HLDRIVE.elf.sha256`: checksum para conferir a integridade.
- `source/backend/src/assets.cpp`: recursos gerados; regenere após modificar o frontend.

A pasta `build`, dependências npm, SDK e clones de referência não são versionados. O código-fonte da release corresponde à tag publicada; o binário fica nos anexos da release.

Para conferir um download:

```powershell
Get-FileHash .\HLDRIVE.elf -Algorithm SHA256
```

Ou, em Linux, com o ELF e o arquivo de checksum na mesma pasta:

```sh
sha256sum -c HLDRIVE.elf.sha256
```

Compilar com sucesso não comprova execução no PS5. Veja [os testes e pendências](TESTING.md).
