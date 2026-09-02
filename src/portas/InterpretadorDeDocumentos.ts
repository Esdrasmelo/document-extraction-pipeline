import type { Prompt } from "../dominio/PromptDeExtracao";

export interface RequisicaoDeInterpretacao extends Prompt {
  chaveIdempotente: string;
}

export interface InterpretadorDeDocumentos {
  interpretar(requisicao: RequisicaoDeInterpretacao): Promise<{ respostaBruta: string }>;
}
