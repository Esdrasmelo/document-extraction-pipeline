import { Etapa, ExecucaoDeExtracao, Nivel, StatusDaExecucao } from "../../src/dominio/ExecucaoDeExtracao";
import { TransicaoInvalida } from "../../src/dominio/erros";
import { camposVazios } from "../../src/dominio/CamposDoDocumento";

const documento = { id: "doc-1", nome: "nota.txt", tipo: "text/plain", caminho: "/tmp/nota.txt" };
const t0 = new Date("2026-03-01T10:00:00Z");
const depois = (segundos: number) => new Date(t0.getTime() + segundos * 1000);

function recebida() {
  return ExecucaoDeExtracao.receber(documento, t0, "exec-1");
}

function comOcrConcluido(texto = "NF 123") {
  const execucao = recebida();
  execucao.iniciarOcr("job-1", depois(1));
  execucao.concluirOcr(texto, 1, depois(2));
  return execucao;
}

describe("ExecucaoDeExtracao", () => {
  it("nasce recebida, com o evento de recebimento e sem lease", () => {
    const execucao = recebida();

    expect(execucao.status).toBe(StatusDaExecucao.RECEBIDA);
    expect(execucao.eventos).toHaveLength(1);
    expect(execucao.eventos[0]).toMatchObject({ etapa: Etapa.RECEBIMENTO, nivel: Nivel.INFO });
    expect(execucao.terminou).toBe(false);
  });

  it("percorre o caminho feliz até concluída registrando cada etapa", () => {
    const execucao = comOcrConcluido();
    execucao.iniciarInterpretacao(depois(3));
    execucao.concluir({ ...camposVazios(), emitente: "ACME" }, '{"emitente":"ACME"}', [], depois(4));

    expect(execucao.status).toBe(StatusDaExecucao.CONCLUIDA);
    expect(execucao.campos?.emitente).toBe("ACME");
    expect(execucao.eventos.map((e) => e.etapa)).toEqual([
      Etapa.RECEBIMENTO,
      Etapa.INICIO_OCR,
      Etapa.TEXTO_MONTADO,
      Etapa.INTERPRETACAO_ENVIADA,
      Etapa.RESPOSTA_RECEBIDA,
      Etapa.VALIDACAO,
    ]);
    expect(execucao.snapshot().concluidaEm).toBe(depois(4).toISOString());
  });

  it("marca a validação como aviso quando a normalização deixou avisos", () => {
    const execucao = comOcrConcluido();
    execucao.iniciarInterpretacao(depois(3));
    execucao.concluir(camposVazios(), "{}", ["dataEmissao: não normalizada"], depois(4));

    const validacao = execucao.eventos.find((e) => e.etapa === Etapa.VALIDACAO)!;
    expect(validacao.nivel).toBe(Nivel.AVISO);
  });

  it("conclui sem interpretar quando o OCR não devolve texto", () => {
    const execucao = comOcrConcluido("   \n  ");
    execucao.concluirSemTexto(depois(3));

    expect(execucao.status).toBe(StatusDaExecucao.CONCLUIDA);
    expect(execucao.campos).toEqual(camposVazios());
    expect(execucao.eventos.at(-1)).toMatchObject({ etapa: Etapa.INTERPRETACAO_PULADA, nivel: Nivel.AVISO });
  });

  it("recusa pular etapas", () => {
    const execucao = recebida();

    expect(() => execucao.concluirOcr("x", 1, depois(1))).toThrow(TransicaoInvalida);
    expect(() => execucao.iniciarInterpretacao(depois(1))).toThrow(TransicaoInvalida);
    expect(() => execucao.concluir(camposVazios(), "{}", [], depois(1))).toThrow(TransicaoInvalida);
  });

  it("pode falhar de qualquer estado não final, uma única vez", () => {
    const execucao = comOcrConcluido();
    execucao.falhar("RESPOSTA_INVALIDA", "sem JSON", depois(3), "blá");

    expect(execucao.status).toBe(StatusDaExecucao.FALHOU);
    expect(execucao.falha).toEqual({ codigo: "RESPOSTA_INVALIDA", mensagem: "sem JSON" });
    expect(execucao.snapshot().respostaBruta).toBe("blá");
    expect(() => execucao.falhar("OUTRO", "de novo", depois(4))).toThrow(TransicaoInvalida);
  });

  it("não deixa uma execução concluída voltar a andar", () => {
    const execucao = comOcrConcluido();
    execucao.iniciarInterpretacao(depois(3));
    execucao.concluir(camposVazios(), "{}", [], depois(4));

    expect(() => execucao.iniciarOcr("job-2", depois(5))).toThrow(TransicaoInvalida);
    expect(() => execucao.falhar("X", "y", depois(5))).toThrow(TransicaoInvalida);
  });

  it("registra reenvio de interpretação como aviso com a mesma chave idempotente", () => {
    const execucao = comOcrConcluido();
    execucao.iniciarInterpretacao(depois(3));
    execucao.reenviarInterpretacao(depois(60));

    const envios = execucao.eventos.filter((e) => e.etapa === Etapa.INTERPRETACAO_ENVIADA);
    expect(envios).toHaveLength(2);
    expect(envios[1]).toMatchObject({ nivel: Nivel.AVISO, dados: { chaveIdempotente: "exec-1" } });
  });

  it("sobrevive a um ciclo de snapshot e restauração sem compartilhar estado", () => {
    const original = comOcrConcluido();
    const copia = ExecucaoDeExtracao.restaurar(original.snapshot());

    copia.iniciarInterpretacao(depois(3));

    expect(copia.status).toBe(StatusDaExecucao.INTERPRETACAO_EM_ANDAMENTO);
    expect(original.status).toBe(StatusDaExecucao.OCR_CONCLUIDO);
    expect(original.eventos).toHaveLength(3);
  });
});
