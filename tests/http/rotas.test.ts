import type { FastifyInstance } from "fastify";
import { montarServidor } from "../../src/adaptadores/http/servidor";
import { ReceberDocumento } from "../../src/aplicacao/ReceberDocumento";
import { ConsultarExecucao } from "../../src/aplicacao/ConsultarExecucao";
import { ProcessarProximaExecucao } from "../../src/aplicacao/ProcessarProximaExecucao";
import { RepositorioEmMemoria } from "../../src/adaptadores/persistencia/RepositorioEmMemoria";
import { OcrDeTextoPuro } from "../../src/adaptadores/ocr/OcrDeTextoPuro";
import { StatusDaExecucao, type ReferenciaDeDocumento } from "../../src/dominio/ExecucaoDeExtracao";
import type { ArmazenamentoDeDocumentos, DocumentoRecebido } from "../../src/portas/ArmazenamentoDeDocumentos";
import type { InterpretadorDeDocumentos } from "../../src/portas/InterpretadorDeDocumentos";
import { relogioDoSistema } from "../../src/portas/Relogio";

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

const interpretadorFixo: InterpretadorDeDocumentos = {
  async interpretar() {
    return {
      respostaBruta: JSON.stringify({
        emitente: "ACME",
        numeroDocumento: "1",
        dataEmissao: "01/03/2026",
        dataVencimento: null,
        valorTotal: "10,00",
        valorImpostos: null,
        moeda: "BRL",
      }),
    };
  },
};

const corpoDe = (resposta: { body: string }): any => JSON.parse(resposta.body);

describe("rotas HTTP", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const repositorio = new RepositorioEmMemoria();
    const armazenamento = new ArmazenamentoEmMemoria();
    app = await montarServidor({
      receberDocumento: new ReceberDocumento({ armazenamento, repositorio, relogio: relogioDoSistema }),
      consultarExecucao: new ConsultarExecucao(repositorio),
      processarProximaExecucao: new ProcessarProximaExecucao({
        repositorio,
        armazenamento,
        ocr: new OcrDeTextoPuro(armazenamento),
        interpretador: interpretadorFixo,
        relogio: relogioDoSistema,
        reivindicacaoExpiraAposMs: 60_000,
      }),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("aceita um documento e devolve 202 com o id da execução", async () => {
    const resposta = await app.inject({
      method: "POST",
      url: "/documentos",
      payload: { nome: "nota.txt", tipo: "text/plain", conteudoBase64: Buffer.from("NF 1 ACME").toString("base64") },
    });

    expect(resposta.statusCode).toBe(202);
    expect(typeof corpoDe(resposta).execucaoId).toBe("string");
  });

  it("rejeita corpo fora do contrato com 400 e detalhes", async () => {
    const resposta = await app.inject({ method: "POST", url: "/documentos", payload: { nome: "x" } });

    expect(resposta.statusCode).toBe(400);
    expect(corpoDe(resposta).erro).toBe("CORPO_INVALIDO");
  });

  it("devolve 404 para execução desconhecida", async () => {
    const resposta = await app.inject({ method: "GET", url: "/execucoes/nao-existe" });
    expect(resposta.statusCode).toBe(404);
  });

  it("expõe a execução recebida e, depois de um tick do worker, concluída", async () => {
    const recebimento = await app.inject({
      method: "POST",
      url: "/documentos",
      payload: { nome: "nota.txt", tipo: "text/plain", conteudoBase64: Buffer.from("NF 1 ACME").toString("base64") },
    });
    const { execucaoId } = corpoDe(recebimento);

    const antes = corpoDe(await app.inject({ method: "GET", url: `/execucoes/${execucaoId}` }));
    expect(antes.status).toBe(StatusDaExecucao.RECEBIDA);

    let ultimo: any;
    do {
      ultimo = corpoDe(await app.inject({ method: "POST", url: "/worker/executar" }));
    } while (ultimo.processou && ultimo.execucaoId !== execucaoId);

    const depois = corpoDe(await app.inject({ method: "GET", url: `/execucoes/${execucaoId}` }));
    expect(depois.status).toBe(StatusDaExecucao.CONCLUIDA);
    expect(depois.campos.emitente).toBe("ACME");
    expect(depois.campos.valorTotalCentavos).toBe(1000);
  });

  it("responde à checagem de saúde", async () => {
    const resposta = await app.inject({ method: "GET", url: "/saude" });
    expect(corpoDe(resposta)).toEqual({ status: "ok" });
  });
});
