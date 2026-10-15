# Compatibilidade

HLDRIVE é um aplicativo homebrew em ELF64 x86-64 para PS5. Requer um ambiente homebrew ativo, um método compatível para iniciar arquivos ELF e os serviços de sistema usados pelo backend. O HLDRIVE não fornece exploits nem altera o firmware.

O usuário testou a versão 1.0.1 em seu PS5 e confirmou o funcionamento e a velocidade de download muito maior. O firmware e o método de inicialização não foram informados; portanto, esse relato não certifica outras combinações.

O servidor HTTP usa a porta 8081. O título `HLDR00001` registra um atalho na categoria Mídia (`applicationCategoryType: 65536`) com o ícone de `source/launcher/icon0.png`. O atalho abre a interface local enquanto o processo do HLDRIVE está em execução; ele não inicia o ELF depois de reiniciar o console.

O console acessa o Google Drive e grava arquivos no armazenamento do PS5. A rede usa o DNS configurado nas definições do console e a validação TLS permanece ativa. Veja [TESTING.md](TESTING.md) para o estado detalhado da validação.
