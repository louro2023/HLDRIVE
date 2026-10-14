# Compatibilidade com loaders

HLDRIVE é um payload ELF64 x86-64, não um pacote instalável de jogo. Precisa de um ambiente homebrew ativo e dos serviços nativos utilizados pelo backend. Compatibilidade de protocolo não equivale a validação em hardware.

## elfldr

O ELF é destinado ao fluxo de envio ao elfldr, normalmente TCP 9021. O alvo inicial é o firmware 12.40. A execução, rede HTTPS e interface ainda precisam de teste real. HLDRIVE não fornece exploit nem desbloqueia firmwares.

## Payload Manager

A análise tomou como referência [ps5-payload-manager](https://github.com/itsPLK/ps5-payload-manager), commit `fe5ca8121c1195f813bba9bc032cba0086b74ff2`, versão 0.6.0.

O manager envia ELF ao elfldr em localhost:9021 e mantém seus próprios arquivos em `/data/pldmgr`. HLDRIVE usa HTTP 7070 e dados em `/data/HLDRIVE`, sem conflito nominal com HTTP 8084 do manager. Importe o ELF pelo fluxo do manager; apenas colocá-lo em `/data/HLDRIVE` não o adiciona automaticamente à biblioteca.

O ELF é compatível com esse fluxo por análise estrutural. Não há entrada HLDRIVE no catálogo padrão nem teste de integração no console. Autoload é responsabilidade do manager. A ação Excluir HLDRIVE não apaga a cópia do ELF nem a configuração de autoload mantidas por ele.

## Relapse

A análise tomou como referência [Relapse](https://github.com/soniciso1/relapse), commit `112dbe5949e9c3de923bb0909289c58a9c082151`.

O projeto declara uma lista de firmwares que inclui 12.40 e 13.60 e utiliza elfldr em 9021 após preparar seu ambiente. Isso não certifica HLDRIVE nesses firmwares. O ELF da release, com aproximadamente 3,8 MB, cabe no buffer de envio de aproximadamente 16 MB observado nessa revisão.

Fluxo previsto: **Relapse → elfldr → Payload Manager → HLDRIVE**, ou envio direto ao elfldr. O menu padrão do Relapse não inclui HLDRIVE. Uma hospedagem personalizada exige adicionar o arquivo e sua entrada de menu. Não foram modificados nem executados exploits durante esta análise.

## Atalho de mídia

O título próprio `HLDR00001` abre o servidor do HLDRIVE no navegador; não executa o ELF. Depende do serviço de instalação individual e de `/user/app` disponível. Falha nesse registro não comprova incompatibilidade do transporte elfldr e não impede, por si só, o início do servidor HTTP.

Nenhuma garantia de compatibilidade universal é feita. Consulte [TESTING.md](TESTING.md) para distinguir verificação local e testes ainda pendentes.
