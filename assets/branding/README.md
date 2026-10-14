# Aplicação das artes HLDRIVE

As quatro imagens originais geradas nesta pasta são preservadas. As versões leves de distribuição são preparadas por `tools/prepare-branding.ps1`, sem alterar a composição das artes.

| Arte original | Onde aparece | Arquivo incorporado |
| --- | --- | --- |
| `hldrive-icon-v1.png` | Ícone registrado na aba Mídia do PS5 | `source/launcher/icon0.png` (512×512), incorporado por `media_shortcut.cpp` |
| `hldrive-icon-v1.png` | Favicon e ícone web | `source/frontend/public/branding/icon.png` |
| `hldrive-tile-v1.png` | Identidade no topo do menu lateral | `source/frontend/public/branding/tile.png` |
| `hldrive-hero-v1.png` | Fundo do banner no topo da interface | `source/frontend/public/branding/hero.jpg` |
| `hldrive-cover-v1.png` | Capa na tela após encerrar/excluir, em telas largas | `source/frontend/public/branding/cover.jpg` |

As versões web passam pelo build do frontend e pelo gerador de assets, ficando dentro de `build/HLDRIVE.elf`. Não é necessário enviar imagens separadas ao PS5.

O hero é o fundo do banner **dentro do HLDRIVE**. Não foi configurado como papel de parede da interface do sistema PS5. Da mesma forma, a capa não é registrada como box art na biblioteca do sistema. A instalação do ícone nativo continua dependente da validação de AppInstUtil no console real.

Verificação: build do frontend, recompilação do ELF, teste de abertura da pasta com APIs simuladas e smoke test de navegação/copiar/colar/gerenciamento. Prévia atual em `build/drive-connect-success.png`.
