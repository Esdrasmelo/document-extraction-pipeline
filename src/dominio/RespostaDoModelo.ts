import { z } from "zod";
import { CamposDoDocumentoSchema, MOEDAS_ACEITAS, type CamposDoDocumento } from "./CamposDoDocumento";
import { normalizarData, paraCentavos } from "./normalizacao";

export const RespostaDoModeloSchema = z.object({
  emitente: z.string().nullable(),
  numeroDocumento: z.string().nullable(),
  dataEmissao: z.string().nullable(),
  dataVencimento: z.string().nullable(),
  valorTotal: z.string().nullable(),
  valorImpostos: z.string().nullable(),
  moeda: z.string().nullable(),
});

export type RespostaDoModelo = z.infer<typeof RespostaDoModeloSchema>;

export type Interpretacao =
  | { ok: true; campos: CamposDoDocumento; avisos: string[] }
  | { ok: false; motivo: string; detalhes: string[] };

export function extrairJson(texto: string): string | null {
  const cercado = texto.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (cercado?.[1]) return cercado[1].trim();

  const inicio = texto.indexOf("{");
  if (inicio === -1) return null;

  let profundidade = 0;
  for (let i = inicio; i < texto.length; i++) {
    if (texto[i] === "{") profundidade++;
    if (texto[i] === "}") profundidade--;
    if (profundidade === 0) return texto.slice(inicio, i + 1);
  }
  return null;
}

export function interpretarResposta(respostaBruta: string): Interpretacao {
  const json = extrairJson(respostaBruta);
  if (!json) {
    return { ok: false, motivo: "Resposta sem JSON", detalhes: [respostaBruta.slice(0, 200)] };
  }

  let bruto: unknown;
  try {
    bruto = JSON.parse(json);
  } catch (erro) {
    return { ok: false, motivo: "JSON malformado", detalhes: [String(erro)] };
  }

  const resposta = RespostaDoModeloSchema.safeParse(bruto);
  if (!resposta.success) {
    return {
      ok: false,
      motivo: "JSON fora do esquema esperado",
      detalhes: resposta.error.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`),
    };
  }

  const { campos, avisos } = normalizar(resposta.data);
  const validacao = CamposDoDocumentoSchema.safeParse(campos);
  if (!validacao.success) {
    return {
      ok: false,
      motivo: "Campos normalizados não passaram na validação",
      detalhes: validacao.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }

  return { ok: true, campos: validacao.data, avisos };
}

function normalizar(resposta: RespostaDoModelo): { campos: CamposDoDocumento; avisos: string[] } {
  const avisos: string[] = [];

  const data = (rotulo: string, valor: string | null) => {
    if (valor == null) return null;
    const normalizada = normalizarData(valor);
    if (normalizada == null) avisos.push(`${rotulo}: não foi possível normalizar "${valor}"`);
    return normalizada;
  };

  const centavos = (rotulo: string, valor: string | null) => {
    if (valor == null) return null;
    const convertido = paraCentavos(valor);
    if (convertido == null) avisos.push(`${rotulo}: não foi possível converter "${valor}" em centavos`);
    return convertido;
  };

  const moeda = resposta.moeda?.trim().toUpperCase() ?? null;
  const moedaAceita = MOEDAS_ACEITAS.find((m) => m === moeda) ?? null;
  if (moeda && !moedaAceita) avisos.push(`moeda: "${resposta.moeda}" não reconhecida`);

  return {
    campos: {
      emitente: limparTexto(resposta.emitente),
      numeroDocumento: limparTexto(resposta.numeroDocumento),
      dataEmissao: data("dataEmissao", resposta.dataEmissao),
      dataVencimento: data("dataVencimento", resposta.dataVencimento),
      valorTotalCentavos: centavos("valorTotal", resposta.valorTotal),
      valorImpostosCentavos: centavos("valorImpostos", resposta.valorImpostos),
      moeda: moedaAceita,
    },
    avisos,
  };
}

function limparTexto(valor: string | null): string | null {
  const limpo = valor?.replace(/\s+/g, " ").trim();
  return limpo ? limpo : null;
}
