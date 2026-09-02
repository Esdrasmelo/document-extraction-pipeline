import { ExecucaoDeExtracao, STATUS_FINAIS, type EstadoDaExecucao } from "../../dominio/ExecucaoDeExtracao";
import type { RepositorioDeExecucoes } from "../../portas/RepositorioDeExecucoes";

interface Registro {
  estado: EstadoDaExecucao;
  reivindicadaEm: number | null;
}

export class RepositorioEmMemoria implements RepositorioDeExecucoes {
  private readonly registros = new Map<string, Registro>();

  async salvar(execucao: ExecucaoDeExtracao): Promise<void> {
    const atual = this.registros.get(execucao.id);
    this.registros.set(execucao.id, { estado: execucao.snapshot(), reivindicadaEm: atual?.reivindicadaEm ?? null });
  }

  async obter(id: string): Promise<ExecucaoDeExtracao | null> {
    const registro = this.registros.get(id);
    return registro ? ExecucaoDeExtracao.restaurar(registro.estado) : null;
  }

  async reivindicarMaisAntigaPendente(agora: Date, reivindicacaoExpiraAposMs: number): Promise<ExecucaoDeExtracao | null> {
    const limite = agora.getTime() - reivindicacaoExpiraAposMs;

    const candidato = [...this.registros.values()]
      .filter((r) => !STATUS_FINAIS.has(r.estado.status))
      .filter((r) => r.reivindicadaEm === null || r.reivindicadaEm < limite)
      .sort((a, b) => a.estado.criadaEm.localeCompare(b.estado.criadaEm))[0];

    if (!candidato) return null;

    candidato.reivindicadaEm = agora.getTime();
    return ExecucaoDeExtracao.restaurar(candidato.estado);
  }

  async liberar(id: string): Promise<void> {
    const registro = this.registros.get(id);
    if (registro) registro.reivindicadaEm = null;
  }

  quantidade(): number {
    return this.registros.size;
  }
}
