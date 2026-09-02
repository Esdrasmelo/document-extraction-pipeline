import { ErroDeDominio } from "../dominio/erros";
import { ExecucaoDeExtracao, StatusDaExecucao } from "../dominio/ExecucaoDeExtracao";
import { montarPrompt, textoEstaVazio } from "../dominio/PromptDeExtracao";
import { interpretarResposta } from "../dominio/RespostaDoModelo";
import type { ArmazenamentoDeDocumentos } from "../portas/ArmazenamentoDeDocumentos";
import type { InterpretadorDeDocumentos } from "../portas/InterpretadorDeDocumentos";
import type { RepositorioDeExecucoes } from "../portas/RepositorioDeExecucoes";
import type { Relogio } from "../portas/Relogio";
import type { ServicoDeOcr } from "../portas/ServicoDeOcr";

export interface DependenciasDoProcessamento {
  repositorio: RepositorioDeExecucoes;
  ocr: ServicoDeOcr;
  interpretador: InterpretadorDeDocumentos;
  armazenamento: ArmazenamentoDeDocumentos;
  relogio: Relogio;
  reivindicacaoExpiraAposMs: number;
}

export type ResultadoDoTick =
  | { processou: false }
  | { processou: true; execucaoId: string; status: StatusDaExecucao };

const CODIGO_DE_ERRO_INESPERADO = "ERRO_INESPERADO";

export class ProcessarProximaExecucao {
  constructor(private readonly deps: DependenciasDoProcessamento) {}

  async executar(): Promise<ResultadoDoTick> {
    const { repositorio, relogio, reivindicacaoExpiraAposMs } = this.deps;

    const execucao = await repositorio.reivindicarMaisAntigaPendente(relogio.agora(), reivindicacaoExpiraAposMs);
    if (!execucao) return { processou: false };

    try {
      await this.avancarAteBloquear(execucao);
    } catch (erro) {
      this.registrarFalha(execucao, erro);
    } finally {
      await repositorio.salvar(execucao);
      await repositorio.liberar(execucao.id);
    }

    return { processou: true, execucaoId: execucao.id, status: execucao.status };
  }

  private async avancarAteBloquear(execucao: ExecucaoDeExtracao): Promise<void> {
    while (!execucao.terminou) {
      const avancou = await this.avancarUmPasso(execucao);
      await this.deps.repositorio.salvar(execucao);
      if (!avancou) return;
    }
  }

  private async avancarUmPasso(execucao: ExecucaoDeExtracao): Promise<boolean> {
    switch (execucao.status) {
      case StatusDaExecucao.RECEBIDA:
        return this.iniciarOcr(execucao);
      case StatusDaExecucao.OCR_EM_ANDAMENTO:
        return this.consultarOcr(execucao);
      case StatusDaExecucao.OCR_CONCLUIDO:
        return this.interpretar(execucao);
      case StatusDaExecucao.INTERPRETACAO_EM_ANDAMENTO:
        return this.reinterpretar(execucao);
      default:
        return false;
    }
  }

  private async iniciarOcr(execucao: ExecucaoDeExtracao): Promise<boolean> {
    const { jobId } = await this.deps.ocr.iniciar(execucao.documento);
    execucao.iniciarOcr(jobId, this.deps.relogio.agora());
    return true;
  }

  private async consultarOcr(execucao: ExecucaoDeExtracao): Promise<boolean> {
    const resultado = await this.deps.ocr.consultar(execucao.jobDeOcr!);
    if (!resultado.concluido) {
      execucao.registrarOcrPendente(this.deps.relogio.agora());
      return false;
    }

    execucao.concluirOcr(resultado.texto, resultado.paginas, this.deps.relogio.agora());
    return true;
  }

  private async interpretar(execucao: ExecucaoDeExtracao): Promise<boolean> {
    const texto = execucao.textoExtraido ?? "";
    if (textoEstaVazio(texto)) {
      execucao.concluirSemTexto(this.deps.relogio.agora());
      return true;
    }

    execucao.iniciarInterpretacao(this.deps.relogio.agora());
    await this.deps.repositorio.salvar(execucao);
    await this.enviarEConcluir(execucao, texto);
    return true;
  }

  private async reinterpretar(execucao: ExecucaoDeExtracao): Promise<boolean> {
    execucao.reenviarInterpretacao(this.deps.relogio.agora());
    await this.deps.repositorio.salvar(execucao);
    await this.enviarEConcluir(execucao, execucao.textoExtraido ?? "");
    return true;
  }

  private async enviarEConcluir(execucao: ExecucaoDeExtracao, texto: string): Promise<void> {
    const prompt = montarPrompt(texto);
    const { respostaBruta } = await this.deps.interpretador.interpretar({
      ...prompt,
      chaveIdempotente: execucao.id,
    });

    const interpretacao = interpretarResposta(respostaBruta);
    const agora = this.deps.relogio.agora();

    if (!interpretacao.ok) {
      execucao.falhar("RESPOSTA_INVALIDA", `${interpretacao.motivo}: ${interpretacao.detalhes.join("; ")}`, agora, respostaBruta);
      return;
    }

    execucao.concluir(interpretacao.campos, respostaBruta, interpretacao.avisos, agora);
  }

  private registrarFalha(execucao: ExecucaoDeExtracao, erro: unknown): void {
    if (execucao.terminou) return;
    const codigo = erro instanceof ErroDeDominio ? erro.codigo : CODIGO_DE_ERRO_INESPERADO;
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    execucao.falhar(codigo, mensagem, this.deps.relogio.agora());
  }
}
