# Tentativa de melhoria do paralelo — 22/10/2026

O usuário relata arquivos maiores que 50 GB, menos de 100 Mbps em internet de 1 Gbps e somente uma conexão. Não foi possível obter os cabeçalhos da resposta real do console; a causa permanece uma hipótese.

## Alteração

O transporte antes exigia ETag forte para combinar partes. Agora também aceita `Last-Modified` quando não existe qualquer ETag, as datas são interpretáveis e `Date` está pelo menos 60 segundos depois de `Last-Modified`. É uma margem conservadora para a alternativa de validação descrita no [RFC 9110, seção 8.8.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2.2), usada com [If-Range](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.5).

Cada segmento envia `If-Range` e exige a mesma data de modificação, resposta 206, intervalo e tamanho corretos, sem transformação de conteúdo. ETags fracos não habilitam a alternativa por data. Se o recurso mudar ou o servidor devolver o arquivo inteiro, a transferência é rejeitada e o temporário removido. TLS permanece validado.

O limite continua em 16 conexões; não há aumento de buffers ou de concorrência. Se o Drive não fornecer nenhum identificador elegível, o modo sequencial continua necessário. Esta mudança não comprova que os links do usuário forneçam Last-Modified nem garante aumento de velocidade.

## Interface e teste no console

A interface atual já renderiza `transport_reason` abaixo da velocidade média. Não foi encontrado nesta revisão um erro que justifique sua ausência relatada; é necessário conferir o ELF efetivamente iniciado e recarregar a página após a atualização.

Para testar, encerrar o processo antigo, substituir somente o ELF e iniciar o novo. Acompanhar conexões e velocidade no mesmo arquivo/destino. A pré-release 1.1.1-rc.1 identifica esta alteração no painel e inclui o fundo animado. Consulte as [notas da release](releases/v1.1.1-rc.1.md) para download e limitações.

## Validação

O ensaio HTTPS local foi ampliado de 16 para 21 cenários: data válida sem ETag, data alterada durante os segmentos, data inválida, data recente demais e ETag fraco com data. Os casos de sucesso verificam cada byte, e os casos de rejeição verificam a ausência de arquivo concluído. Há também verificações do limite de 59/60 segundos e ausência de Date.

Os testes não baixam dados do Google Drive nem executam no PS5. O ELF foi compilado com o SDK local. O desempenho real depende de teste no console.
