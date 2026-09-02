import { z } from "zod";

const vazioParaIndefinido = (valor: unknown) => (valor === "" ? undefined : valor);

const esquema = z.object({
  PORT: z.coerce.number().default(3400),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  BANCO_SQLITE: z.string().default("./dados.sqlite"),
  DIRETORIO_DE_DOCUMENTOS: z.string().default("./documentos"),
  INTERPRETADOR: z.enum(["webhook", "chat-completions"]).default("webhook"),
  WEBHOOK_DO_INTERPRETADOR: z.preprocess(vazioParaIndefinido, z.string().url().optional()),
  CHAT_COMPLETIONS_URL: z.preprocess(vazioParaIndefinido, z.string().url().optional()),
  CHAT_COMPLETIONS_API_KEY: z.preprocess(vazioParaIndefinido, z.string().optional()),
  CHAT_COMPLETIONS_MODEL: z.preprocess(vazioParaIndefinido, z.string().optional()),
  INTERVALO_DO_WORKER_MS: z.coerce.number().int().positive().default(5000),
  REIVINDICACAO_EXPIRA_APOS_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
});

export type Configuracao = z.infer<typeof esquema>;

export function carregarConfiguracao(ambiente: NodeJS.ProcessEnv = process.env): Configuracao {
  const config = esquema.parse(ambiente);

  if (config.INTERPRETADOR === "webhook" && !config.WEBHOOK_DO_INTERPRETADOR) {
    throw new Error("INTERPRETADOR=webhook exige WEBHOOK_DO_INTERPRETADOR");
  }
  if (config.INTERPRETADOR === "chat-completions") {
    const faltando = ["CHAT_COMPLETIONS_URL", "CHAT_COMPLETIONS_API_KEY", "CHAT_COMPLETIONS_MODEL"].filter(
      (chave) => !config[chave as keyof Configuracao],
    );
    if (faltando.length) throw new Error(`INTERPRETADOR=chat-completions exige ${faltando.join(", ")}`);
  }

  return config;
}
