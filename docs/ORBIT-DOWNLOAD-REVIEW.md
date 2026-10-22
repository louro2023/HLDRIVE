# Comparação com Orbit Store 1.3.5

Revisão de 22/10/2026. HLDRIVE analisado: commit `f21aaa7`.

## Fontes e escopo

Além dos guias de [downloads](https://github.com/saawant12/orbit-store-ps5/blob/main/guides/downloads.md), [diagnóstico](https://github.com/saawant12/orbit-store-ps5/blob/main/guides/troubleshooting.md) e [Orbit Zero](https://github.com/saawant12/orbit-store-ps5/blob/main/guides/orbit-zero.md), foi baixado o pacote `orbit-store-1.3.5-source-bundle.zip` da [release oficial](https://github.com/saawant12/orbit-store-ps5/releases/tag/v1.3.5). Seu manifesto identifica o commit `8043189a7d319be3ffdf828e08bf5a0f105a30fd`.

Foram inspecionados `backend/transfer.c`, `backend/transfer_writer.c`, `backend/transfer_writer.h` e `backend/orbit.h` do arquivo interno `orbit-store-1.3.5-source.tar.gz`. A árvore principal pública contém documentação, mas a release fornece o código. Esta revisão amplia a pesquisa anterior, que examinou somente o código 0.4.2.

## Diferenças verificadas no código

| Aspecto | Orbit 1.3.5 no PS5 | HLDRIVE atual |
| --- | --- | --- |
| Paralelismo por arquivo | Até 8 ranges em produção; 16 somente no build de benchmark | Até 16 workers, segmentos de 8 MiB |
| Validação | Identidade com ETag forte para ativar paralelo e verificação de ranges | ETag forte, resposta 206, Content-Range, tamanho e encoding validados |
| Recepção | libcurl multi | Um handle libcurl reutilizável por worker |
| Escrita | Thread dedicada, fila limitada a 8 MiB e blocos de 256 KiB | Cada worker grava diretamente, agrupando até 1 MiB |
| USB | Recebe janelas paralelas e as entrega à escrita em ordem | Escritas em posições diferentes do arquivo, conforme cada worker avança |
| Janela de socket | Solicita até 1 MiB sem reduzir um buffer já maior; consulta valor aceito | Solicita 2 MiB, mas ainda não registra o valor efetivo |
| Interrupções | Cursores persistidos com sincronização e retomada | Sem retomada persistente de downloads |

O comentário do código Orbit relata que um console aceitou uma solicitação de 1 MiB como 512 KiB. Isso não é uma medição do PS5 do usuário. Solicitar 2 MiB no HLDRIVE também não comprova que o kernel aceitou esse tamanho.

## O que pode melhorar

1. **Fila limitada de escrita independente da rede.** Pode reduzir pausas dos workers durante escrita lenta. Exige medir o tempo de disco e validar cancelamento, falta de espaço, propagação de erros e integridade antes de substituir o transporte atual.
2. **Escrita ordenada para USB.** É especialmente relevante para HD mecânico: ranges distantes podem gerar movimentação e espera. O ganho não deve ser presumido para SSD interno.
3. **Concorrência ajustável e comparação no console.** Comparar 4, 8 e 16 conexões com o mesmo arquivo e destino. Mais conexões podem aumentar contenção ou restrições da origem; não há justificativa para aumentar cegamente o limite.
4. **Janela efetiva de recepção.** Consultar o valor aceito e registrar a recusa ajudaria a distinguir ajuste solicitado de ajuste aplicado.

Antes de escolher uma alteração, verificar versão efetivamente em execução, Mbps/MiB/s, conexões ativas, mensagem do modo sequencial e destino. O motor HLDRIVE exige arquivo de pelo menos 32 MiB e resposta elegível para usar paralelo. Sem ETag forte, ele usa uma conexão; remover essa validação poderia misturar versões de um arquivo. A Orbit também exige identidade para esse caminho.

O modo Orbit Zero baixa no computador e envia ao PS5 pela LAN. É uma arquitetura diferente, não evidência de que o download HTTPS direto no PS5 atingirá a mesma taxa. Outros provedores e TorBox também não são medições do Google Drive.

## Verificação desta revisão

O teste foi recompilado com `g++ -O2 -std=c++20` e executado com `python3 tools/test-drive-transport.py` no WSL. Os 16 cenários passaram, incluindo conteúdo byte a byte, ranges inválidos, mudança de identidade, truncamento, HTML, cancelamento e preservação de arquivos existentes.

No servidor HTTPS sintético com limite artificial por conexão, o arquivo de 167.772.283 bytes levou 17.875 ms com oito workers e 14.253 ms com 16, cerca de 20% menos tempo. Ambos fizeram 161 escritas. Esses valores dependem do host/WSL e não representam a velocidade do PS5 nem do Google Drive.

Nenhum arquivo da pasta do Google Drive foi baixado. Não houve alteração no motor, geração de novo ELF ou publicação de release nesta revisão. Há candidatos concretos a melhoria, mas a causa da lentidão relatada permanece sem confirmação no console.
