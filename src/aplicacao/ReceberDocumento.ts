import { ExecucaoDeExtracao } from "../dominio/ExecucaoDeExtracao";
import type { ArmazenamentoDeDocumentos, DocumentoRecebido } from "../portas/ArmazenamentoDeDocumentos";
import type { RepositorioDeExecucoes } from "../portas/RepositorioDeExecucoes";
import type { Relogio } from "../portas/Relogio";

export interface DependenciasDeRecebimento {
  armazenamento: ArmazenamentoDeDocumentos;
  repositorio: RepositorioDeExecucoes;
  relogio: Relogio;
}

export class ReceberDocumento {
  constructor(private readonly deps: DependenciasDeRecebimento) {}

  async executar(documento: DocumentoRecebido): Promise<{ execucaoId: string }> {
    const referencia = await this.deps.armazenamento.guardar(documento);
    const execucao = ExecucaoDeExtracao.receber(referencia, this.deps.relogio.agora());
    await this.deps.repositorio.salvar(execucao);
    return { execucaoId: execucao.id };
  }
}
