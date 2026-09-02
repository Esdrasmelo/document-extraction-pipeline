import type { InterpretadorDeDocumentos, RequisicaoDeInterpretacao } from "../../portas/InterpretadorDeDocumentos";

const TIMEOUT_PADRAO_MS = 120_000;
const TEMPERATURA_DETERMINISTICA = 0;

export interface OpcoesDeChatCompletions {
  url: string;
  apiKey: string;
  modelo: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface RespostaDeChatCompletions {
  choices?: Array<{ message?: { content?: string | null } }>;
}

export class InterpretadorViaChatCompletions implements InterpretadorDeDocumentos {
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opcoes: OpcoesDeChatCompletions) {
    this.timeoutMs = opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS;
    this.fetchImpl = opcoes.fetchImpl ?? fetch;
  }

  async interpretar(requisicao: RequisicaoDeInterpretacao): Promise<{ respostaBruta: string }> {
    const resposta = await this.fetchImpl(this.opcoes.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.opcoes.apiKey}`,
        "idempotency-key": requisicao.chaveIdempotente,
      },
      body: JSON.stringify({
        model: this.opcoes.modelo,
        temperature: TEMPERATURA_DETERMINISTICA,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: requisicao.instrucoes },
          { role: "user", content: requisicao.mensagem },
        ],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!resposta.ok) {
      throw new Error(`API de chat completions respondeu HTTP ${resposta.status}`);
    }

    const corpo = (await resposta.json()) as RespostaDeChatCompletions;
    const conteudo = corpo.choices?.[0]?.message?.content;
    if (typeof conteudo !== "string") {
      throw new Error("API de chat completions não devolveu conteúdo na primeira escolha");
    }

    return { respostaBruta: conteudo };
  }
}
