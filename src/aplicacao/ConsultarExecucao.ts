import type { EstadoDaExecucao } from "../dominio/ExecucaoDeExtracao";
import type { RepositorioDeExecucoes } from "../portas/RepositorioDeExecucoes";

export class ConsultarExecucao {
  constructor(private readonly repositorio: RepositorioDeExecucoes) {}

  async executar(id: string): Promise<EstadoDaExecucao | null> {
    const execucao = await this.repositorio.obter(id);
    return execucao ? execucao.snapshot() : null;
  }
}
