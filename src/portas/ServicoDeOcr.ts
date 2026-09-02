import type { ReferenciaDeDocumento } from "../dominio/ExecucaoDeExtracao";

export type ResultadoDaConsultaDeOcr =
  | { concluido: false }
  | { concluido: true; texto: string; paginas: number };

export interface ServicoDeOcr {
  iniciar(documento: ReferenciaDeDocumento): Promise<{ jobId: string }>;
  consultar(jobId: string): Promise<ResultadoDaConsultaDeOcr>;
}
