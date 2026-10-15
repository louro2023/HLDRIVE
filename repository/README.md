# HLDRIVE no Payload Manager

Fonte personalizada no formato documentado pelo Payload Manager v0.6.1. A miniatura usa a logo HLDRIVE existente, em JPEG 128×128, incorporada como data URI em `icons.json`.

## Adicionar no PS5

1. Abra **Settings → Manage Sources → Add Source** no Payload Manager.
2. Cole a URL direta abaixo e confirme:

```text
https://raw.githubusercontent.com/louro2023/HLDRIVE/main/repository/payloads.json
```

3. Abra **Get Payloads**, selecione a fonte **HLDRIVE** e instale o item com nossa logo.

Essa fonte é independente do catálogo padrão do Manager. O projeto não é incluído automaticamente na fonte oficial. Uma cópia importada manualmente por USB/upload pode continuar com o ícone genérico; a associação da miniatura é feita pelos metadados do catálogo, não por extração do ELF. Não é necessário substituir o ELF 1.0.2 apenas por causa desta miniatura.

Se estiver usando uma cópia local com autoload, confira qual entrada deve iniciar após instalar pela fonte, para evitar iniciar duas cópias. Não é preciso excluir configurações ou downloads do HLDRIVE.

Se o ícone não atualizar, use **Settings → Repository Cache → Clear Cache**. O Manager mantém cache próprio de ícones; limpar esse cache preserva instalações, fontes, favoritos e autoload segundo sua documentação.

## Manutenção da fonte

Em cada release, atualize `version`, `last_update`, URL e SHA-256 juntos em `payloads.json`. Use a URL de uma versão específica para que o binário sempre corresponda ao checksum. Preserve `id: hldrive` entre versões.

Para regenerar a miniatura sem alterar a logo original:

```powershell
.\tools\prepare-manager-icon.ps1
```

O script verifica o limite de 12.288 caracteres por data URI. `icons_url` é relativo à URL do catálogo; `icon_key` identifica a entrada em `icons.json`. Links diretos para imagens não são aceitos nesse campo pelo Manager.

Referências: [formato oficial v0.6.1](https://github.com/itsPLK/ps5-payload-manager/blob/v0.6.1/CUSTOM_REPOSITORIES.md), [carregamento dos ícones](https://github.com/itsPLK/ps5-payload-manager/blob/v0.6.1/frontend/src/utils/repositoryIcons.js). A conformidade e a decodificação da imagem foram verificadas localmente; a aparência no PS5 ainda depende de teste no console.
