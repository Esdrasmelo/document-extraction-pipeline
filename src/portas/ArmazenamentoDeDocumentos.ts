import type { ReferenciaDeDocumento } from "../dominio/ExecucaoDeExtracao";

export interface DocumentoRecebido {
  nome: string;
  tipo: string;
  conteudo: Buffer;
}

export interface ArmazenamentoDeDocumentos {
  guardar(documento: DocumentoRecebido): Promise<ReferenciaDeDocumento>;
  ler(referencia: ReferenciaDeDocumento): Promise<Buffer>;
}
