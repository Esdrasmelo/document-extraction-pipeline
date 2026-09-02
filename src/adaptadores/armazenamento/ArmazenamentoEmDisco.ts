import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { ReferenciaDeDocumento } from "../../dominio/ExecucaoDeExtracao";
import type { ArmazenamentoDeDocumentos, DocumentoRecebido } from "../../portas/ArmazenamentoDeDocumentos";

export class ArmazenamentoEmDisco implements ArmazenamentoDeDocumentos {
  constructor(private readonly diretorio: string) {}

  async guardar(documento: DocumentoRecebido): Promise<ReferenciaDeDocumento> {
    await mkdir(this.diretorio, { recursive: true });
    const id = randomUUID();
    const caminho = join(this.diretorio, `${id}${extname(documento.nome)}`);
    await writeFile(caminho, documento.conteudo);
    return { id, nome: documento.nome, tipo: documento.tipo, caminho };
  }

  async ler(referencia: ReferenciaDeDocumento): Promise<Buffer> {
    return readFile(referencia.caminho);
  }
}
