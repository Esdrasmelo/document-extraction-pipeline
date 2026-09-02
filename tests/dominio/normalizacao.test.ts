import { formatarCentavos, normalizarData, paraCentavos, somarCentavos } from "../../src/dominio/normalizacao";

describe("normalizarData", () => {
  it("converte dia/mês/ano para ISO", () => {
    expect(normalizarData("05/03/2026")).toBe("2026-03-05");
  });

  it("completa mês/ano com o primeiro dia", () => {
    expect(normalizarData("03/2026")).toBe("2026-03-01");
    expect(normalizarData("3/2026")).toBe("2026-03-01");
  });

  it("mantém ISO válido como está", () => {
    expect(normalizarData("2026-03-05")).toBe("2026-03-05");
  });

  it("recusa datas impossíveis em vez de arredondar", () => {
    expect(normalizarData("31/02/2026")).toBeNull();
    expect(normalizarData("2026-13-01")).toBeNull();
    expect(normalizarData("00/2026")).toBeNull();
  });

  it("recusa formatos que não reconhece", () => {
    expect(normalizarData("5 de março de 2026")).toBeNull();
    expect(normalizarData("2026/03/05")).toBeNull();
    expect(normalizarData("")).toBeNull();
    expect(normalizarData(null)).toBeNull();
  });
});

describe("paraCentavos", () => {
  it("lê o formato brasileiro com milhar e vírgula decimal", () => {
    expect(paraCentavos("R$ 41.234,82")).toBe(4123482);
  });

  it("lê o formato com ponto decimal", () => {
    expect(paraCentavos("1234.56")).toBe(123456);
  });

  it("lê inteiro com separador de milhar sem decimais", () => {
    expect(paraCentavos("1.234")).toBe(123400);
    expect(paraCentavos("1,234")).toBe(123400);
  });

  it("aceita número já em unidade monetária", () => {
    expect(paraCentavos(1234.56)).toBe(123456);
  });

  it("preserva o sinal negativo", () => {
    expect(paraCentavos("-R$ 10,50")).toBe(-1050);
  });

  it("recusa o que não é valor", () => {
    expect(paraCentavos("isento")).toBeNull();
    expect(paraCentavos("")).toBeNull();
    expect(paraCentavos(null)).toBeNull();
    expect(paraCentavos(Number.NaN)).toBeNull();
  });
});

describe("somarCentavos", () => {
  it("soma em inteiros, onde o ponto flutuante perderia centavo", () => {
    const parcelas = ["41.234,82", "41.234,81", "41.234,81"].map(paraCentavos);
    expect(somarCentavos(parcelas)).toBe(12370444);

    expect(0.1 + 0.2).not.toBe(0.3);
    expect(somarCentavos([paraCentavos("0,10"), paraCentavos("0,20")])).toBe(30);
  });

  it("ignora parcelas ausentes mas não inventa total quando todas faltam", () => {
    expect(somarCentavos([100, null, 50])).toBe(150);
    expect(somarCentavos([null, null])).toBeNull();
  });
});

describe("formatarCentavos", () => {
  it("apresenta em moeda a partir dos centavos", () => {
    expect(formatarCentavos(12370444)).toMatch(/^R\$\s123\.704,44$/);
  });
});
