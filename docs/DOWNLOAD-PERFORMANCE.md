# Pesquisa de desempenho de download no PS5

Pesquisa realizada em 16/10/2026. O objetivo é identificar melhorias para o HLDRIVE, com meta de 500 Mbps ou mais. Esta pesquisa não mede o PS5 do usuário nem comprova essa velocidade no Google Drive.

## Unidades e meta

O painel atual do HLDRIVE exibe a velocidade em **KiB/s ou MiB/s**, calculada a partir de bytes por segundo. A referência de 500 Mbps corresponde a **62,5 MB/s ou 59,6 MiB/s**. Uma leitura de 90 MiB/s equivale a aproximadamente 755 Mbps e já supera a meta. Uma leitura de 10 MiB/s equivale a aproximadamente 84 Mbps.

A velocidade atual também é a média desde o início do arquivo, não uma janela de velocidade recente. Ela pode esconder melhora após uma partida lenta. É necessário confirmar a unidade observada antes de diagnosticar o limite.

## Projetos consultados

### Overdrive / ps5-react

Código consultado no [commit 73354a672ab82cfc30d21af800ec08602e015b19](https://github.com/MyLuxy/overdrive/tree/73354a672ab82cfc30d21af800ec08602e015b19).

O [motor de rede](https://github.com/MyLuxy/overdrive/blob/73354a672ab82cfc30d21af800ec08602e015b19/ps5-react/native/shared/network.cpp) usa libcurl multi, concorrência adaptativa até 64 conexões, uma fila limitada de buffers, duas threads de gravação e redistribuição das partes finais. Solicita uma janela de recepção TCP de 2 MiB. Separa recepção, gravação e publicação de progresso.

O [relatório de desempenho](https://github.com/MyLuxy/overdrive/blob/73354a672ab82cfc30d21af800ec08602e015b19/ps5-react/reports/download-speed.md) apresenta testes locais com servidor controlado: uma simulação de limite por conexão ultrapassou 62,5 MB/s; aumentar conexões não melhorou a simulação de limite por cliente. Isso demonstra a técnica, não a velocidade que o HLDRIVE atingirá no Google Drive. Os valores de Archive.org não devem ser transferidos para outro provedor.

### Orbit Store

Foram consultados o [repositório oficial](https://github.com/saawant12/orbit-store-ps5), a documentação de downloads atual e o [código-fonte publicado da versão 0.4.2](https://github.com/saawant12/orbit-store-ps5/releases/tag/v0.4.2), arquivo `orbit-store-0.4.2-source.tar.gz`.

Nesse código, `transfer.c` divide um arquivo elegível em duas regiões com libcurl multi e `pwrite`, valida respostas e preserva estado para retomada. Não foi identificado nesse artefato um mecanismo que, por si só, justifique trocar as oito conexões existentes do HLDRIVE por duas.

A [documentação atual](https://github.com/saawant12/orbit-store-ps5/blob/main/guides/downloads.md#simultaneous-downloads) oferece até oito downloads de jogos simultâneos. Isso é concorrência entre arquivos, não evidência de oito conexões por arquivo ou garantia de velocidade. A release atual consultada é 1.3.5; seu bundle de fontes tem aproximadamente 342 MB e não foi inspecionado. As conclusões sobre `transfer.c` se limitam à 0.4.2.

### Spectrum Library

O [repositório oficial consultado](https://github.com/Phoenixx1202/Spectrum-Library) disponibiliza README e releases; não expõe o motor de download na árvore principal. A release mais recente consultada é 1.4.9. Não foi feita engenharia reversa do binário. Portanto, não há confirmação direta, nesta pesquisa, das configurações internas de download dessa versão.

O estudo do Overdrive contém uma análise estática de um artefato Spectrum 1.4.8, descrevendo buffer de aplicação de 16 MiB por parte e até oito workers. Essa é uma observação de outro projeto sobre um binário específico, não uma medição nem uma verificação independente da versão atual. Não é base suficiente para reservar 128 MiB de buffers no HLDRIVE sem medir memória e desempenho.

## Comparação com o HLDRIVE atual

| Área | Situação encontrada | Consequência possível |
| --- | --- | --- |
| Seleção de modo | O paralelo exige resposta 206 válida, tamanho conhecido, anexo, ETag forte e arquivo de pelo menos 32 MiB | Se faltar uma condição, fica em uma conexão; hoje a interface não explica qual condição faltou |
| Distribuição | Oito regiões fixas, cada uma com cerca de 1/8 do arquivo | Uma conexão lenta pode dominar o tempo final; workers que terminam não recebem trabalho novo |
| Escrita | `write`/`pwrite` dentro do callback para cada bloco entregue pelo curl | O buffer de recepção de 256 KiB não implica gravações de 256 KiB; podem ocorrer muitas escritas pequenas |
| Progresso | Atualizações de workers chamam o callback compartilhado, que bloqueia `jobs_mu` | Pode acrescentar contenção; precisa de perfil para quantificar |
| TCP | Solicita SO_RCVBUF de 512 KiB, sem observar quanto o kernel aceitou | Uma janela pequena pode limitar conexões em rotas de alta latência |
| Conexões | Handles são criados e destruídos; oito threads durante um arquivo paralelo | Funciona, mas não oferece fila de segmentos com reaproveitamento de conexões |
| Diagnóstico | Sem motivo do fallback, taxa recente, tempo de disco ou número de escritas | Não permite concluir se o gargalo é origem, rede, TLS ou armazenamento |

Esses são candidatos identificados no código, não causas comprovadas dos menos de 100 Mbps relatados. Não há limitação explícita de 100 Mbps no motor.

## Ordem recomendada de aprimoramento

1. **Medir e tornar o modo visível.** Mostrar Mbps junto de MiB/s, média e janela recente; informar conexões ativas e o motivo de usar modo sequencial. Registrar bytes gravados, tempo de transferência e sincronização final. Não registrar URLs assinadas, chaves de recurso ou cookies.
2. **Agregar gravações.** Comparar o caminho atual com buffers reutilizáveis de 256 KiB e 1 MiB, com teto global de memória. Reduzir publicação de progresso a cerca de quatro vezes por segundo. Testar offsets, gravações parciais, disco cheio e cancelamento.
3. **Substituir regiões fixas por fila de segmentos.** Comparar segmentos de 8, 16 e 32 MiB, reaproveitando conexões e mantendo verificação exata de 206, Content-Range, comprimento e identidade do recurso. Não remover a exigência de identidade só para ativar o paralelo.
4. **Comparar concorrência de 1, 2, 4, 8 e 16.** Aumentar somente se os bytes úteis por segundo melhorarem. Reduzir em throttling, erros ou saturação de disco. Não copiar 64 conexões sem medir recursos e o comportamento do Google.
5. **Comparar a janela TCP solicitada de 512 KiB com 2 MiB.** Registrar a janela efetiva e recusa do socket. Janela TCP e buffer de escrita são recursos diferentes. Manter o modo não bloqueante do PS5.
6. **Separar a gravação da recepção, se a medição justificar.** Uma fila limitada e backpressure podem evitar pausas de disco dentro da rede; exigem testes de memória, interrupção e integridade.

Manter validação TLS, proteção contra páginas HTML, validação de intervalos, limpeza de arquivos parciais e sincronização final. Retomada é desejável para estabilidade, mas não equivale a maior throughput.

## Ensaio necessário no console

Usar o mesmo arquivo público autorizado de pelo menos 2–5 GiB e o mesmo destino, com três repetições por configuração. Registrar tempo até a conclusão sincronizada e conferir tamanho e hash após a transferência. Comparar também uma leitura pela mesma rede em outro dispositivo para contextualizar a origem, sem tratá-la como garantia de velocidade no PS5.

Confirmar cabo ou Wi-Fi, velocidade do link negociado, plano de internet e tipo de destino. Um link negociado a 100 Mbps impede chegar a 500 Mbps. Um limite agregado do provedor não é removido aumentando conexões. SSD interno e USB devem ser medidos separadamente.

## Implementação posterior à pesquisa

Após a confirmação de internet de 1 Gbps por cabo, o motor passou a distribuir segmentos de 8 MiB entre até 16 workers, reaproveitar conexões e buffers, agrupar gravações em até 1 MiB e publicar progresso serializado aproximadamente a cada 250 ms. A solicitação de janela TCP passou a 2 MiB. A interface apresenta Mbps junto de MiB/s, taxa recente, média e modo de conexão. A concorrência é limitada a 16; não é um algoritmo de descoberta automática da concorrência ideal.

O teste `tools/test-drive-transport.py` executou o transporte de produção com HTTPS local e verificação de todos os bytes de um arquivo de 160 MiB + 123 bytes. A fixture mantém a validação TLS e o hostname, redirecionando a conexão apenas no adaptador de teste. Dezesseis casos cobrem sucesso, redirecionamento, ausência de ETag, ausência de ranges, arquivo pequeno, range incorreto, ETag alterado, encoding transformado, range ignorado, truncamento, HTML, cancelamento, preservação de arquivos preexistentes nos dois modos e comparações de oito/16 workers. Respostas rejeitadas não deixam um arquivo concluído.

Na primeira comparação controlada com limite de 2 MiB/s por conexão, oito workers concluíram em 12.928 ms e 16 em 8.419 ms, aproximadamente 35% menos tempo. Ambos usaram o motor novo com buffers; não é uma comparação binária completa entre a versão anterior e a atual. Foram realizadas 161 escritas para o arquivo de 160 MiB + 123 bytes, em vez de gravar a cada callback pequeno. O host tinha memória limitada; esses tempos não medem capacidade máxima do PS5 nem comprovam 500 Mbps.

**Conclusão:** há melhorias implementadas e verificadas localmente. 500 Mbps continua sendo uma meta condicional à origem, rede, processamento e armazenamento. O ganho no PS5 e a janela TCP efetiva ainda precisam de validação no console com o mesmo arquivo e destino.
