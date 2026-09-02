import { RepositorioEmMemoria } from "../../src/adaptadores/persistencia/RepositorioEmMemoria";
import { ExecucaoDeExtracao } from "../../src/dominio/ExecucaoDeExtracao";

const documento = { id: "doc", nome: "nota.txt", tipo: "text/plain", caminho: "mem://doc" };
const t0 = new Date("2026-03-01T10:00:00Z");
const depois = (ms: number) => new Date(t0.getTime() + ms);
const LEASE_MS = 60_000;

describe("RepositorioEmMemoria", () => {
  it("entrega cada execução pendente a um único reivindicante por vez", async () => {
    const repositorio = new RepositorioEmMemoria();
    await repositorio.salvar(ExecucaoDeExtracao.receber(documento, t0, "e1"));

    const primeiro = await repositorio.reivindicarMaisAntigaPendente(depois(1000), LEASE_MS);
    const segundo = await repositorio.reivindicarMaisAntigaPendente(depois(2000), LEASE_MS);

    expect(primeiro?.id).toBe("e1");
    expect(segundo).toBeNull();
  });

  it("devolve a execução quando a reivindicação expira ou é liberada", async () => {
    const repositorio = new RepositorioEmMemoria();
    await repositorio.salvar(ExecucaoDeExtracao.receber(documento, t0, "e1"));
    await repositorio.reivindicarMaisAntigaPendente(depois(1000), LEASE_MS);

    expect((await repositorio.reivindicarMaisAntigaPendente(depois(1000 + LEASE_MS + 1), LEASE_MS))?.id).toBe("e1");

    await repositorio.liberar("e1");
    expect((await repositorio.reivindicarMaisAntigaPendente(depois(2000), LEASE_MS))?.id).toBe("e1");
  });

  it("não compartilha estado entre o que guarda e o que devolve", async () => {
    const repositorio = new RepositorioEmMemoria();
    const original = ExecucaoDeExtracao.receber(documento, t0, "e1");
    await repositorio.salvar(original);

    const lida = (await repositorio.obter("e1"))!;
    lida.iniciarOcr("job", depois(1));

    expect((await repositorio.obter("e1"))!.status).toBe(original.status);
  });
});
