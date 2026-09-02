import type { InterpretadorDeDocumentos, RequisicaoDeInterpretacao } from "../../portas/InterpretadorDeDocumentos";

const TIMEOUT_PADRAO_MS = 120_000;

export interface OpcoesDoWebhook {
  url: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class InterpretadorViaWebhook implements InterpretadorDeDocumentos {
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opcoes: OpcoesDoWebhook) {
    this.timeoutMs = opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS;
    this.fetchImpl = opcoes.fetchImpl ?? fetch;
  }

  async interpretar(requisicao: RequisicaoDeInterpretacao): Promise<{ respostaBruta: string }> {
    const resposta = await this.fetchImpl(this.opcoes.url, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": requisicao.chaveIdempotente },
      body: JSON.stringify({
        chaveIdempotente: requisicao.chaveIdempotente,
        instrucoes: requisicao.instrucoes,
        mensagem: requisicao.mensagem,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!resposta.ok) {
      throw new Error(`Webhook do interpretador respondeu HTTP ${resposta.status}`);
    }

    return { respostaBruta: await extrairTexto(resposta) };
  }
}

async function extrairTexto(resposta: Response): Promise<string> {
  const corpo = await resposta.text();
  try {
    const json = JSON.parse(corpo) as { response?: unknown; resposta?: unknown; output?: unknown };
    const candidato = json.response ?? json.resposta ?? json.output;
    if (typeof candidato === "string") return candidato;
    if (candidato !== undefined) return JSON.stringify(candidato);
  } catch {
    return corpo;
  }
  return corpo;
}
