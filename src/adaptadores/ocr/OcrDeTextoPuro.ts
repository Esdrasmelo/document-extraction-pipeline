import type { ReferenciaDeDocumento } from "../../dominio/ExecucaoDeExtracao";
import { TipoDeDocumentoNaoSuportado } from "../../dominio/erros";
import type { ArmazenamentoDeDocumentos } from "../../portas/ArmazenamentoDeDocumentos";
import type { ResultadoDaConsultaDeOcr, ServicoDeOcr } from "../../portas/ServicoDeOcr";

const TIPOS_DE_TEXTO = new Set(["text/plain", "text/markdown"]);

export class OcrDeTextoPuro implements ServicoDeOcr {
  private readonly documentos = new Map<string, ReferenciaDeDocumento>();

  constructor(private readonly armazenamento: ArmazenamentoDeDocumentos) {}

  async iniciar(documento: ReferenciaDeDocumento): Promise<{ jobId: string }> {
    if (!TIPOS_DE_TEXTO.has(documento.tipo)) {
      throw new TipoDeDocumentoNaoSuportado(documento.tipo);
    }
    this.documentos.set(documento.id, documento);
    return { jobId: documento.id };
  }

  async consultar(jobId: string): Promise<ResultadoDaConsultaDeOcr> {
    const documento = this.documentos.get(jobId);
    if (!documento) {
      throw new Error(`Job de OCR desconhecido: ${jobId}`);
    }
    const conteudo = await this.armazenamento.ler(documento);
    this.documentos.delete(jobId);
    return { concluido: true, texto: conteudo.toString("utf8"), paginas: 1 };
  }
}
