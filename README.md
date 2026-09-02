# document-extraction-pipeline

Recebe um documento, extrai o texto por OCR, pede a um modelo de linguagem que localize campos
específicos, valida e normaliza a resposta por código e guarda o resultado com uma trilha de eventos
por etapa. O caso concreto é documento fiscal e comercial (nota, fatura, recibo), mas o desenho não
depende disso: trocar o esquema de campos e o prompt é o suficiente para outro tipo de documento.

Stack: Node 22+, TypeScript, Fastify, Zod, SQLite nativo do Node (`node:sqlite`), Jest.

## Como rodar

```bash
npm install
cp .env.example .env
npm run dev
```

Envie um documento e acompanhe a execução:

```bash
curl -X POST http://localhost:3400/documentos -H 'content-type: application/json' \
  -d "{\"nome\":\"nota.txt\",\"tipo\":\"text/plain\",\"conteudoBase64\":\"$(printf 'NF 4521\nACME LTDA\nTotal: R$ 1.234,56' | base64 -w0)\"}"

curl http://localhost:3400/execucoes/<id>
```

O worker roda a cada `INTERVALO_DO_WORKER_MS` dentro do mesmo processo. Para forçar um tick
(útil em desenvolvimento): `curl -X POST http://localhost:3400/worker/executar`.

Interpretadores disponíveis, escolhidos por `INTERPRETADOR`:

| Valor | O que faz | Variáveis |
| --- | --- | --- |
| `webhook` | POST para uma URL que devolve `{ "response": "<json do modelo>" }` — o formato do nó *Respond to Webhook* do n8n, que foi o orquestrador original | `WEBHOOK_DO_INTERPRETADOR` |
| `chat-completions` | Chama diretamente uma API compatível com OpenAI, temperatura 0, `response_format` JSON | `CHAT_COMPLETIONS_URL`, `CHAT_COMPLETIONS_API_KEY`, `CHAT_COMPLETIONS_MODEL` |

## Testes

```bash
npm test
npm run typecheck
```

Nenhum teste toca rede. As portas têm implementações de teste escritas à mão no próprio arquivo de
teste (`OcrRoteirizado`, `InterpretadorProgramado`, `RelogioControlado`), e o repositório SQLite é
testado de verdade contra um banco em memória. O relógio é injetado em tudo que depende de tempo,
então os testes de reivindicação e expiração rodam em milissegundos e são determinísticos.

## Arquitetura

```
src/
  dominio/
    ExecucaoDeExtracao      agregado: máquina de estados, eventos por etapa, snapshot/restauração
    CamposDoDocumento       esquema de saída (Zod), todos os campos anuláveis
    RespostaDoModelo        extração leniente de JSON, validação e normalização
    PromptDeExtracao        instruções fixas e mensagem com delimitadores
    normalizacao            datas para ISO, dinheiro para centavos inteiros
  portas/                   RepositorioDeExecucoes, ServicoDeOcr, InterpretadorDeDocumentos,
                            ArmazenamentoDeDocumentos, Relogio
  aplicacao/
    ReceberDocumento        guarda o arquivo e cria a execução
    ProcessarProximaExecucao  o tick do worker: reivindica, avança até bloquear, persiste
    ConsultarExecucao
  adaptadores/
    persistencia/           RepositorioEmMemoria, RepositorioSqlite
    ocr/                    OcrDeTextoPuro (documentos já em texto; o lugar do Textract)
    interpretadores/        InterpretadorViaWebhook, InterpretadorViaChatCompletions
    armazenamento/          ArmazenamentoEmDisco
    http/                   Fastify
tests/                      espelha src/
```

### O ciclo de uma execução

```
RECEBIDA -> OCR_EM_ANDAMENTO -> OCR_CONCLUIDO -> INTERPRETACAO_EM_ANDAMENTO -> CONCLUIDA
                                     |                                            ^
                                     +-- texto vazio ---------------------------->+
   qualquer estado não final -> FALHOU
```

Cada seta é um método do agregado, e cada método recusa a transição se o estado atual não for o
esperado. O worker nunca escreve status diretamente.

## Decisões

**O modelo copia, o código normaliza.** O prompt pede os valores como aparecem no documento e
proíbe conversão: nada de somar, converter data ou traduzir moeda. Data vira ISO e dinheiro vira
centavos inteiros em `normalizacao.ts`, que tem teste para cada formato. Modelo de linguagem é bom em
achar; aritmética e formato são trabalho de código, onde erram zero vezes e onde um teste pega
regressão. O teste `somarCentavos` mostra o motivo com o exemplo clássico: `0.1 + 0.2` em ponto
flutuante não é `0.3`; `10 + 20` centavos é `30` sempre. Valores de nota fiscal somados em
float acumulam exatamente esse tipo de resíduo.

**Texto vazio não chega ao modelo.** Se o OCR devolve só espaço em branco, a execução conclui com
todos os campos nulos e um evento `INTERPRETACAO_PULADA`. Antes isso era uma regra no prompt; agora é
uma decisão do worker, que não custa chamada de API e não depende de o modelo obedecer.

**O documento entra entre delimitadores.** A mensagem para o modelo é
`<<<INICIO_DO_DOCUMENTO>>> … <<<FIM_DO_DOCUMENTO>>>`, e as instruções dizem que o que está ali é
dado, não comando. Texto de documento vem de fora e pode conter qualquer coisa; separar instrução de
dado é o mínimo contra injeção por conteúdo. As instruções são uma constante, então o teste consegue
afirmar que nada do documento vaza para elas.

**Resposta do modelo é entrada não confiável.** `interpretarResposta` aceita JSON cercado por
crases ou solto no meio de prosa, mas recusa chaves faltando, tipo errado e JSON malformado — sem
coerção. Valor que não normaliza vira nulo com aviso registrado, não erro: um campo ilegível não
deve derrubar os outros seis. A resposta bruta é sempre guardada, inclusive na falha, para dar como
depurar.

**Reivindicação com expiração em vez de fila externa.** O worker reivindica a execução pendente mais
antiga marcando `reivindicada_em`; outro worker só a pega se essa marca tiver mais de
`REIVINDICACAO_EXPIRA_APOS_MS`. No SQLite isso é um único `UPDATE … WHERE id = (SELECT … LIMIT 1)
RETURNING`, atômico. A reivindicação é liberada ao fim de cada tick, tenha a execução avançado ou não — assim uma
execução esperando OCR é consultada de novo no tick seguinte, e a expiração só entra em cena quando
um processo morre no meio. Cobre esse caso sem Redis ou SQS neste tamanho; quando precisar de mais
de um nó, a porta `RepositorioDeExecucoes` é o lugar de trocar.

**Reenvio com chave idempotente.** Se uma execução em `INTERPRETACAO_EM_ANDAMENTO` é recuperada
depois da expiração, o worker reenvia a mesma requisição com `chaveIdempotente = id da execução`
(também no header `idempotency-key`). Quem recebe pode deduplicar; quem não deduplica no máximo
gasta uma chamada a mais. É mais simples e mais honesto do que assumir que a primeira chamada deu
certo só porque foi enviada.

**Eventos por etapa dentro do agregado.** Cada passo grava `{ etapa, nivel, quando, dados }` no
próprio estado da execução. `GET /execucoes/:id` devolve a história inteira: quando o OCR começou,
quantas vezes foi consultado, quantos caracteres saíram, se houve aviso na validação. Isso substitui
a pergunta "em que ponto travou?" por uma leitura.

**Snapshot como fronteira de persistência.** O agregado expõe `snapshot()` e `restaurar()`; o
repositório guarda o snapshot inteiro como JSON e mantém só `status`, `criada_em` e
`reivindicada_em` em colunas próprias, que são o que a consulta de reivindicação filtra. Adicionar
campo ao agregado não exige migração.

**Sem comentários no código.** O que precisaria de comentário virou nome: `textoEstaVazio`,
`avancarAteBloquear`, `reivindicarMaisAntigaPendente`, `TEMPERATURA_DETERMINISTICA`. O raciocínio
que não cabe em nome está nesta seção.

## O que ficou fora, de propósito

O adaptador de OCR incluído lê documentos que já são texto. Um adaptador para serviço de OCR real
(o original usava AWS Textract, com job assíncrono e paginação de resultado) encaixa na porta
`ServicoDeOcr` sem mudar nada acima dela — `iniciar` devolve o id do job, `consultar` diz se acabou.
Não está aqui porque não haveria como testá-lo sem credencial, e código sem teste neste repositório
seria exceção à regra.
