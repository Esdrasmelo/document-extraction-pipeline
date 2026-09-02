import { ProcessarProximaExecucao } from "../../src/aplicacao/ProcessarProximaExecucao";
import { ReceberDocumento } from "../../src/aplicacao/ReceberDocumento";
import { RepositorioEmMemoria } from "../../src/adaptadores/persistencia/RepositorioEmMemoria";
import { Etapa, StatusDaExecucao, type ReferenciaDeDocumento } from "../../src/dominio/ExecucaoDeExtracao";
import { camposVazios } from "../../src/dominio/CamposDoDocumento";
import type { ArmazenamentoDeDocumentos, DocumentoRecebido } from "../../src/portas/ArmazenamentoDeDocumentos";
import type { InterpretadorDeDocumentos, RequisicaoDeInterpretacao } from "../../src/portas/InterpretadorDeDocumentos";
import type { Relogio } from "../../src/portas/Relogio";
import type { ResultadoDaConsultaDeOcr, ServicoDeOcr } from "../../src/portas/ServicoDeOcr";

class RelogioControlado implements Relogio {
  private instante = new Date("2026-03-01T10:00:00Z").getTime();
  agora(): Date {
    return new Date(this.instante);
  }
  avancar(ms: number): void {
    this.instante += ms;
  }
}

class ArmazenamentoEmMemoria implements ArmazenamentoDeDocumentos {
  private readonly arquivos = new Map<string, Buffer>();
  private sequencia = 0;

  async guardar(documento: DocumentoRecebido): Promise<ReferenciaDeDocumento> {
    const id = `doc-${++this.sequencia}`;
    this.arquivos.set(id, documento.conteudo);
    return { id, nome: documento.nome, tipo: documento.tipo, caminho: `mem://${id}` };
  }

  async ler(referencia: ReferenciaDeDocumento): Promise<Buffer> {
    return this.arquivos.get(referencia.id) ?? Buffer.alloc(0);
  }
}

class OcrRoteirizado implements ServicoDeOcr {
  private readonly filas = new Map<string, ResultadoDaConsultaDeOcr[]>();
  iniciados: string[] = [];

  constructor(private readonly roteiro: ResultadoDaConsultaDeOcr[]) {}

  async iniciar(documento: ReferenciaDeDocumento): Promise<{ jobId: string }> {
    this.iniciados.push(documento.id);
    this.filas.set(`job-${documento.id}`, [...this.roteiro]);
    return { jobId: `job-${documento.id}` };
  }

  async consultar(jobId: string): Promise<ResultadoDaConsultaDeOcr> {
    const fila = this.filas.get(jobId)!;
    return fila.length > 1 ? fila.shift()! : fila[0]!;
  }
}

class InterpretadorProgramado implements InterpretadorDeDocumentos {
  requisicoes: RequisicaoDeInterpretacao[] = [];

  constructor(private readonly comportamento: { resposta?: string; erro?: Error }) {}

  async interpretar(requisicao: RequisicaoDeInterpretacao): Promise<{ respostaBruta: string }> {
    this.requisicoes.push(requisicao);
    if (this.comportamento.erro) throw this.comportamento.erro;
    return { respostaBruta: this.comportamento.resposta ?? "" };
  }
}

const RESPOSTA_VALIDA = JSON.stringify({
  emitente: "ACME",
  numeroDocumento: "77",
  dataEmissao: "05/03/2026",
  dataVencimento: null,
  valorTotal: "R$ 100,00",
  valorImpostos: null,
  moeda: "BRL",
});

const ocrPronto = (texto: string): ResultadoDaConsultaDeOcr[] => [{ concluido: true, texto, paginas: 1 }];

function montarCenario(opcoes: { ocr?: ResultadoDaConsultaDeOcr[]; interpretador?: InterpretadorProgramado } = {}) {
  const relogio = new RelogioControlado();
  const repositorio = new RepositorioEmMemoria();
  const armazenamento = new ArmazenamentoEmMemoria();
  const ocr = new OcrRoteirizado(opcoes.ocr ?? ocrPronto("NF 77 ACME"));
  const interpretador = opcoes.interpretador ?? new InterpretadorProgramado({ resposta: RESPOSTA_VALIDA });

  const receber = new ReceberDocumento({ armazenamento, repositorio, relogio });
  const processar = new ProcessarProximaExecucao({
    repositorio,
    armazenamento,
    ocr,
    interpretador,
    relogio,
    reivindicacaoExpiraAposMs: 60_000,
  });

  const receberTexto = (texto = "qualquer") =>
    receber.executar({ nome: "nota.txt", tipo: "text/plain", conteudo: Buffer.from(texto) });

  return { relogio, repositorio, ocr, interpretador, processar, receberTexto };
}

describe("ProcessarProximaExecucao", () => {
  it("não faz nada quando não há execução pendente", async () => {
    const { processar } = montarCenario();
    expect(await processar.executar()).toEqual({ processou: false });
  });

  it("leva a execução do recebimento à conclusão em um único tick quando o OCR está pronto", async () => {
    const { processar, receberTexto, repositorio, interpretador } = montarCenario();
    const { execucaoId } = await receberTexto();

    const resultado = await processar.executar();

    expect(resultado).toEqual({ processou: true, execucaoId, status: StatusDaExecucao.CONCLUIDA });
    const execucao = (await repositorio.obter(execucaoId))!;
    expect(execucao.campos).toEqual({
      ...camposVazios(),
      emitente: "ACME",
      numeroDocumento: "77",
      dataEmissao: "2026-03-05",
      valorTotalCentavos: 10000,
      moeda: "BRL",
    });
    expect(interpretador.requisicoes[0]?.chaveIdempotente).toBe(execucaoId);
    expect(interpretador.requisicoes[0]?.mensagem).toContain("NF 77 ACME");
  });

  it("para e espera quando o OCR ainda não terminou, e retoma no tick seguinte", async () => {
    const { processar, receberTexto, repositorio } = montarCenario({
      ocr: [{ concluido: false }, { concluido: true, texto: "NF 77", paginas: 2 }],
    });
    const { execucaoId } = await receberTexto();

    await processar.executar();
    const parcial = (await repositorio.obter(execucaoId))!;
    expect(parcial.status).toBe(StatusDaExecucao.OCR_EM_ANDAMENTO);
    expect(parcial.eventos.filter((e) => e.etapa === Etapa.CONSULTA_OCR)).toHaveLength(1);

    const segundo = await processar.executar();
    expect(segundo).toMatchObject({ execucaoId, status: StatusDaExecucao.CONCLUIDA });
  });

  it("não chama o modelo quando o OCR devolve texto vazio", async () => {
    const { processar, receberTexto, repositorio, interpretador } = montarCenario({ ocr: ocrPronto("  \n ") });
    const { execucaoId } = await receberTexto();

    await processar.executar();

    const execucao = (await repositorio.obter(execucaoId))!;
    expect(execucao.status).toBe(StatusDaExecucao.CONCLUIDA);
    expect(execucao.campos).toEqual(camposVazios());
    expect(interpretador.requisicoes).toHaveLength(0);
  });

  it("falha com RESPOSTA_INVALIDA e guarda a resposta bruta quando o modelo não devolve JSON", async () => {
    const interpretador = new InterpretadorProgramado({ resposta: "Não consigo ajudar com isso." });
    const { processar, receberTexto, repositorio } = montarCenario({ interpretador });
    const { execucaoId } = await receberTexto();

    await processar.executar();

    const execucao = (await repositorio.obter(execucaoId))!;
    expect(execucao.status).toBe(StatusDaExecucao.FALHOU);
    expect(execucao.falha?.codigo).toBe("RESPOSTA_INVALIDA");
    expect(execucao.snapshot().respostaBruta).toBe("Não consigo ajudar com isso.");
  });

  it("registra falha quando um adaptador lança, sem deixar a execução presa", async () => {
    const interpretador = new InterpretadorProgramado({ erro: new Error("gateway timeout") });
    const { processar, receberTexto, repositorio } = montarCenario({ interpretador });
    const { execucaoId } = await receberTexto();

    await processar.executar();

    const execucao = (await repositorio.obter(execucaoId))!;
    expect(execucao.status).toBe(StatusDaExecucao.FALHOU);
    expect(execucao.falha).toEqual({ codigo: "ERRO_INESPERADO", mensagem: "gateway timeout" });
    expect(await processar.executar()).toEqual({ processou: false });
  });

  it("processa na ordem de chegada", async () => {
    const { processar, receberTexto, relogio } = montarCenario();
    const primeira = await receberTexto("a");
    relogio.avancar(1000);
    const segunda = await receberTexto("b");

    expect(await processar.executar()).toMatchObject({ execucaoId: primeira.execucaoId });
    expect(await processar.executar()).toMatchObject({ execucaoId: segunda.execucaoId });
  });

  it("libera a reivindicação ao fim do tick, para que a espera pelo OCR seja consultada de novo", async () => {
    const { processar, receberTexto, repositorio, relogio } = montarCenario({ ocr: [{ concluido: false }] });
    const { execucaoId } = await receberTexto();

    await processar.executar();
    await processar.executar();

    const execucao = (await repositorio.obter(execucaoId))!;
    expect(execucao.eventos.filter((e) => e.etapa === Etapa.CONSULTA_OCR)).toHaveLength(2);
    expect(await repositorio.reivindicarMaisAntigaPendente(relogio.agora(), 60_000)).not.toBeNull();
  });

  it("recupera uma execução cuja reivindicação expirou e reenvia com a mesma chave", async () => {
    const interpretador = new InterpretadorProgramado({ erro: new Error("caiu no meio") });
    const { processar, receberTexto, repositorio, relogio } = montarCenario({ interpretador });
    const { execucaoId } = await receberTexto();

    await processar.executar();
    const presa = (await repositorio.obter(execucaoId))!;
    expect(presa.status).toBe(StatusDaExecucao.FALHOU);

    const outraExecucao = await receberTexto("segunda");
    const interpretadorBom = new InterpretadorProgramado({ resposta: RESPOSTA_VALIDA });
    const processarDeNovo = new ProcessarProximaExecucao({
      repositorio,
      armazenamento: new ArmazenamentoEmMemoria(),
      ocr: new OcrRoteirizado(ocrPronto("texto")),
      interpretador: interpretadorBom,
      relogio,
      reivindicacaoExpiraAposMs: 60_000,
    });

    relogio.avancar(61_000);
    const resultado = await processarDeNovo.executar();

    expect(resultado).toMatchObject({ execucaoId: outraExecucao.execucaoId, status: StatusDaExecucao.CONCLUIDA });
    expect(interpretadorBom.requisicoes[0]?.chaveIdempotente).toBe(outraExecucao.execucaoId);
  });
});
