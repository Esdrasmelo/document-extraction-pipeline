import type { ExecucaoDeExtracao } from "../dominio/ExecucaoDeExtracao";

export interface RepositorioDeExecucoes {
  salvar(execucao: ExecucaoDeExtracao): Promise<void>;
  obter(id: string): Promise<ExecucaoDeExtracao | null>;
  reivindicarMaisAntigaPendente(agora: Date, reivindicacaoExpiraAposMs: number): Promise<ExecucaoDeExtracao | null>;
  liberar(id: string): Promise<void>;
}
