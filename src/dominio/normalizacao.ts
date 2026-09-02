const DIA_MES_ANO = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const MES_ANO = /^(\d{1,2})\/(\d{4})$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

const dois = (n: number | string) => String(n).padStart(2, "0");

function dataValida(ano: number, mes: number, dia: number): boolean {
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}

export function normalizarData(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const limpo = texto.trim();

  const iso = limpo.match(ISO);
  if (iso) {
    const [, ano, mes, dia] = iso;
    return dataValida(Number(ano), Number(mes), Number(dia)) ? limpo : null;
  }

  const completa = limpo.match(DIA_MES_ANO);
  if (completa) {
    const [, dia, mes, ano] = completa;
    return dataValida(Number(ano), Number(mes), Number(dia)) ? `${ano}-${dois(mes!)}-${dois(dia!)}` : null;
  }

  const mesAno = limpo.match(MES_ANO);
  if (mesAno) {
    const [, mes, ano] = mesAno;
    return dataValida(Number(ano), Number(mes), 1) ? `${ano}-${dois(mes!)}-01` : null;
  }

  return null;
}

export function paraCentavos(valor: string | number | null | undefined): number | null {
  if (valor == null) return null;
  if (typeof valor === "number") {
    return Number.isFinite(valor) ? Math.round(valor * 100) : null;
  }

  const texto = valor.replace(/[^\d,.\-]/g, "");
  if (!texto || texto === "-") return null;

  const negativo = texto.startsWith("-");
  const semSinal = texto.replace("-", "");
  const usaVirgulaDecimal = /,\d{1,2}$/.test(semSinal);
  const usaPontoDecimal = !usaVirgulaDecimal && /\.\d{1,2}$/.test(semSinal) && !/\.\d{3}(\.|$)/.test(semSinal);

  let inteiros: string;
  let decimais: string;

  if (usaVirgulaDecimal) {
    const [i, d] = semSinal.split(",");
    inteiros = i!.replace(/\./g, "");
    decimais = d!;
  } else if (usaPontoDecimal) {
    const [i, d] = semSinal.split(".");
    inteiros = i!.replace(/,/g, "");
    decimais = d!;
  } else {
    inteiros = semSinal.replace(/[.,]/g, "");
    decimais = "";
  }

  if (!/^\d+$/.test(inteiros) || !/^\d{0,2}$/.test(decimais)) return null;

  const centavos = Number(inteiros) * 100 + Number(decimais.padEnd(2, "0") || "0");
  return negativo ? -centavos : centavos;
}

export function somarCentavos(valores: ReadonlyArray<number | null>): number | null {
  const validos = valores.filter((v): v is number => v != null);
  if (validos.length === 0) return null;
  return validos.reduce((soma, v) => soma + v, 0);
}

export function formatarCentavos(centavos: number, moeda = "BRL"): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda }).format(centavos / 100);
}
