import { extrairJson, interpretarResposta } from "../../src/dominio/RespostaDoModelo";

const respostaCompleta = {
  emitente: "Padaria Central LTDA",
  numeroDocumento: "NF 4521",
  dataEmissao: "05/03/2026",
  dataVencimento: "03/2026",
  valorTotal: "R$ 1.234,56",
  valorImpostos: "123,45",
  moeda: "R$",
};

describe("extrairJson", () => {
  it("pega o bloco cercado por crases mesmo com texto em volta", () => {
    const texto = 'Segue o resultado:\n```json\n{"a": 1}\n```\nEspero ter ajudado.';
    expect(extrairJson(texto)).toBe('{"a": 1}');
  });

  it("pega o primeiro objeto balanceado quando não há cerca", () => {
    expect(extrairJson('resultado: {"a": {"b": 2}} fim')).toBe('{"a": {"b": 2}}');
  });

  it("devolve nulo quando não há objeto", () => {
    expect(extrairJson("não encontrei nada")).toBeNull();
    expect(extrairJson("{ aberto sem fechar")).toBeNull();
  });
});

describe("interpretarResposta", () => {
  it("normaliza datas e valores e aceita a moeda pelo símbolo", () => {
    const resultado = interpretarResposta(JSON.stringify(respostaCompleta));

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.campos).toEqual({
      emitente: "Padaria Central LTDA",
      numeroDocumento: "NF 4521",
      dataEmissao: "2026-03-05",
      dataVencimento: "2026-03-01",
      valorTotalCentavos: 123456,
      valorImpostosCentavos: 12345,
      moeda: null,
    });
    expect(resultado.avisos).toEqual(['moeda: "R$" não reconhecida']);
  });

  it("aceita código de moeda em qualquer caixa", () => {
    const resultado = interpretarResposta(JSON.stringify({ ...respostaCompleta, moeda: "brl" }));
    expect(resultado.ok && resultado.campos.moeda).toBe("BRL");
  });

  it("aceita a resposta toda nula, que é o contrato para documento vazio", () => {
    const nulos = Object.fromEntries(Object.keys(respostaCompleta).map((k) => [k, null]));
    const resultado = interpretarResposta(JSON.stringify(nulos));

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(Object.values(resultado.campos).every((v) => v === null)).toBe(true);
    expect(resultado.avisos).toEqual([]);
  });

  it("transforma valor que não normaliza em nulo com aviso, sem derrubar o resto", () => {
    const resultado = interpretarResposta(JSON.stringify({ ...respostaCompleta, dataEmissao: "ontem" }));

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.campos.dataEmissao).toBeNull();
    expect(resultado.campos.valorTotalCentavos).toBe(123456);
    expect(resultado.avisos.some((a) => a.startsWith("dataEmissao"))).toBe(true);
  });

  it("recusa resposta sem JSON", () => {
    const resultado = interpretarResposta("Desculpe, não consigo processar este documento.");
    expect(resultado).toMatchObject({ ok: false, motivo: "Resposta sem JSON" });
  });

  it("recusa JSON malformado", () => {
    const resultado = interpretarResposta('{"emitente": "x",}');
    expect(resultado).toMatchObject({ ok: false, motivo: "JSON malformado" });
  });

  it("recusa JSON com chaves faltando", () => {
    const resultado = interpretarResposta(JSON.stringify({ emitente: "x" }));
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.motivo).toBe("JSON fora do esquema esperado");
    expect(resultado.detalhes.some((d) => d.startsWith("numeroDocumento"))).toBe(true);
  });

  it("recusa tipo errado em vez de coagir", () => {
    const resultado = interpretarResposta(JSON.stringify({ ...respostaCompleta, valorTotal: 1234.56 }));
    expect(resultado.ok).toBe(false);
  });
});
