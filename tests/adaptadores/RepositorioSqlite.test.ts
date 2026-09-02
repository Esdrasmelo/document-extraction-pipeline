import { RepositorioSqlite } from "../../src/adaptadores/persistencia/RepositorioSqlite";
import { ExecucaoDeExtracao, StatusDaExecucao } from "../../src/dominio/ExecucaoDeExtracao";
import { camposVazios } from "../../src/dominio/CamposDoDocumento";

const documento = { id: "doc", nome: "nota.txt", tipo: "text/plain", caminho: "mem://doc" };
const t0 = new Date("2026-03-01T10:00:00Z");
const depois = (ms: number) => new Date(t0.getTime() + ms);
const LEASE_MS = 60_000;

describe("RepositorioSqlite", () => {
  let repositorio: RepositorioSqlite;

  beforeEach(() => {
    repositorio = new RepositorioSqlite(":memory:");
  });

  afterEach(() => {
    repositorio.fechar();
  });

  it("grava e devolve a execução com os eventos intactos", async () => {
    const execucao = ExecucaoDeExtracao.receber(documento, t0, "e1");
    execucao.iniciarOcr("job", depois(1));

    await repositorio.salvar(execucao);
    const lida = (await repositorio.obter("e1"))!;

    expect(lida.status).toBe(StatusDaExecucao.OCR_EM_ANDAMENTO);
    expect(lida.jobDeOcr).toBe("job");
    expect(lida.eventos).toHaveLength(2);
    expect(lida.snapshot()).toEqual(execucao.snapshot());
  });

  it("devolve nulo para id desconhecido", async () => {
    expect(await repositorio.obter("nao-existe")).toBeNull();
  });

  it("sobrescreve a mesma execução em vez de duplicar", async () => {
    const execucao = ExecucaoDeExtracao.receber(documento, t0, "e1");
    await repositorio.salvar(execucao);
    execucao.iniciarOcr("job", depois(1));
    await repositorio.salvar(execucao);

    expect((await repositorio.obter("e1"))!.status).toBe(StatusDaExecucao.OCR_EM_ANDAMENTO);
  });

  it("reivindica a mais antiga primeiro", async () => {
    await repositorio.salvar(ExecucaoDeExtracao.receber(documento, depois(2000), "nova"));
    await repositorio.salvar(ExecucaoDeExtracao.receber(documento, t0, "antiga"));

    const reivindicada = await repositorio.reivindicarMaisAntigaPendente(depois(3000), LEASE_MS);

    expect(reivindicada?.id).toBe("antiga");
  });

  it("não entrega a mesma execução duas vezes dentro da reivindicação", async () => {
    await repositorio.salvar(ExecucaoDeExtracao.receber(documento, t0, "e1"));

    const primeira = await repositorio.reivindicarMaisAntigaPendente(depois(1000), LEASE_MS);
    const segunda = await repositorio.reivindicarMaisAntigaPendente(depois(2000), LEASE_MS);

    expect(primeira?.id).toBe("e1");
    expect(segunda).toBeNull();
  });

  it("volta a entregar quando a reivindicação expira", async () => {
    await repositorio.salvar(ExecucaoDeExtracao.receber(documento, t0, "e1"));
    await repositorio.reivindicarMaisAntigaPendente(depois(1000), LEASE_MS);

    const recuperada = await repositorio.reivindicarMaisAntigaPendente(depois(1000 + LEASE_MS + 1), LEASE_MS);

    expect(recuperada?.id).toBe("e1");
  });

  it("libera a reivindicação explicitamente", async () => {
    await repositorio.salvar(ExecucaoDeExtracao.receber(documento, t0, "e1"));
    await repositorio.reivindicarMaisAntigaPendente(depois(1000), LEASE_MS);

    await repositorio.liberar("e1");
    const deNovo = await repositorio.reivindicarMaisAntigaPendente(depois(2000), LEASE_MS);

    expect(deNovo?.id).toBe("e1");
  });

  it("nunca reivindica execuções concluídas ou falhas", async () => {
    const concluida = ExecucaoDeExtracao.receber(documento, t0, "ok");
    concluida.iniciarOcr("j", depois(1));
    concluida.concluirOcr("texto", 1, depois(2));
    concluida.iniciarInterpretacao(depois(3));
    concluida.concluir(camposVazios(), "{}", [], depois(4));

    const falha = ExecucaoDeExtracao.receber(documento, depois(10), "ruim");
    falha.falhar("X", "y", depois(11));

    await repositorio.salvar(concluida);
    await repositorio.salvar(falha);

    expect(await repositorio.reivindicarMaisAntigaPendente(depois(20_000), LEASE_MS)).toBeNull();
  });

  it("salvar não derruba uma reivindicação em andamento", async () => {
    const execucao = ExecucaoDeExtracao.receber(documento, t0, "e1");
    await repositorio.salvar(execucao);
    await repositorio.reivindicarMaisAntigaPendente(depois(1000), LEASE_MS);

    execucao.iniciarOcr("job", depois(1500));
    await repositorio.salvar(execucao);

    expect(await repositorio.reivindicarMaisAntigaPendente(depois(2000), LEASE_MS)).toBeNull();
  });
});
