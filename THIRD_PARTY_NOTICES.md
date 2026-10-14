# Créditos e componentes de terceiros

HLDRIVE deriva do [ProsperoMgr](https://github.com/notmaj0r/ProsperoMgr), de maj0r, sob GNU GPL v3. O texto da licença está em [LICENSE](LICENSE). Os avisos e condições presentes nos arquivos de terceiros continuam aplicáveis; a licença do projeto não substitui essas condições.

| Componente | Uso / licença |
| --- | --- |
| ProsperoMgr | Base da interface e gerenciamento de arquivos; GPL v3. |
| PS5 Payload SDK | Toolchain e runtime; consulte os avisos da distribuição [SDK](https://github.com/ps5-payload-dev/sdk). |
| GNU libmicrohttpd 1.0.2 | Servidor HTTP vinculado estaticamente; LGPL 2.1 ou posterior, conforme a distribuição upstream. Fonte e configuração usadas são obtidas por `tools/setup-build.sh`; [upstream](https://www.gnu.org/software/libmicrohttpd/). |
| miniz | Compressão e arquivos ZIP; declaração Unlicense/domínio público preservada em `source/backend/third_party/miniz.h` e no código correspondente. |
| UnRAR | Extração RAR; licença própria de Alexander Roshal em [license.txt](source/backend/third_party/unrar/license.txt), incluindo restrição ao desenvolvimento de compressor compatível com RAR. |
| Dependências frontend | Versões registradas em `source/frontend/package-lock.json`; cada pacote mantém sua licença. |
| Playwright | Ferramenta de testes de desenvolvimento; dependência registrada em `tools/ui-test/package-lock.json`. |

Os fontes e scripts publicados permitem recompilar o payload e substituir a biblioteca HTTP. Preserve os avisos de licença ao redistribuir componentes. A presença de UnRAR tem condições próprias; não presuma que todos os arquivos sejam exclusivamente GPL.

Referências de implementação e interoperabilidade: [ps5-browser-app](https://github.com/kvnhrt/ps5-browser-app), [gdown](https://github.com/wkentaro/gdown), [Payload Manager](https://github.com/itsPLK/ps5-payload-manager) e [Relapse](https://github.com/soniciso1/relapse). Consulte o README e a documentação de compatibilidade para o papel de cada referência. Overdrive foi referência documental, sem incorporação de seu navegador/código.

As artes em `assets/branding` foram geradas para HLDRIVE; seus prompts e usos estão documentados nessa pasta. O projeto não é afiliado a Sony/PlayStation ou Google.
