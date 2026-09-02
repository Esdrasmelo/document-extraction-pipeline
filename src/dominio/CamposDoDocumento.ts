import { z } from "zod";

export const MOEDAS_ACEITAS = ["BRL", "USD", "EUR"] as const;

export const CamposDoDocumentoSchema = z.object({
  emitente: z.string().nullable(),
  numeroDocumento: z.string().nullable(),
  dataEmissao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  dataVencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  valorTotalCentavos: z.number().int().nullable(),
  valorImpostosCentavos: z.number().int().nullable(),
  moeda: z.enum(MOEDAS_ACEITAS).nullable(),
});

export type CamposDoDocumento = z.infer<typeof CamposDoDocumentoSchema>;

export const NOMES_DOS_CAMPOS = Object.keys(CamposDoDocumentoSchema.shape) as ReadonlyArray<keyof CamposDoDocumento>;

export function camposVazios(): CamposDoDocumento {
  return {
    emitente: null,
    numeroDocumento: null,
    dataEmissao: null,
    dataVencimento: null,
    valorTotalCentavos: null,
    valorImpostosCentavos: null,
    moeda: null,
  };
}

export function contarCamposPreenchidos(campos: CamposDoDocumento): number {
  return NOMES_DOS_CAMPOS.filter((nome) => campos[nome] !== null).length;
}
