import pino from "pino";
import { carregarConfiguracao } from "./configuracao";
import { ReceberDocumento } from "./aplicacao/ReceberDocumento";
import { ConsultarExecucao } from "./aplicacao/ConsultarExecucao";
import { ProcessarProximaExecucao } from "./aplicacao/ProcessarProximaExecucao";
import { RepositorioSqlite } from "./adaptadores/persistencia/RepositorioSqlite";
import { ArmazenamentoEmDisco } from "./adaptadores/armazenamento/ArmazenamentoEmDisco";
import { OcrDeTextoPuro } from "./adaptadores/ocr/OcrDeTextoPuro";
import { InterpretadorViaWebhook } from "./adaptadores/interpretadores/InterpretadorViaWebhook";
import { InterpretadorViaChatCompletions } from "./adaptadores/interpretadores/InterpretadorViaChatCompletions";
import { montarServidor } from "./adaptadores/http/servidor";
import { relogioDoSistema } from "./portas/Relogio";
import type { InterpretadorDeDocumentos } from "./portas/InterpretadorDeDocumentos";

const config = carregarConfiguracao();
const logger = pino({ level: config.NODE_ENV === "development" ? "debug" : "info" });

function escolherInterpretador(): InterpretadorDeDocumentos {
  if (config.INTERPRETADOR === "chat-completions") {
    return new InterpretadorViaChatCompletions({
      url: config.CHAT_COMPLETIONS_URL!,
      apiKey: config.CHAT_COMPLETIONS_API_KEY!,
      modelo: config.CHAT_COMPLETIONS_MODEL!,
    });
  }
  return new InterpretadorViaWebhook({ url: config.WEBHOOK_DO_INTERPRETADOR! });
}

const repositorio = new RepositorioSqlite(config.BANCO_SQLITE);
const armazenamento = new ArmazenamentoEmDisco(config.DIRETORIO_DE_DOCUMENTOS);

const processarProximaExecucao = new ProcessarProximaExecucao({
  repositorio,
  armazenamento,
  ocr: new OcrDeTextoPuro(armazenamento),
  interpretador: escolherInterpretador(),
  relogio: relogioDoSistema,
  reivindicacaoExpiraAposMs: config.REIVINDICACAO_EXPIRA_APOS_MS,
});

async function iniciar(): Promise<void> {
  const app = await montarServidor({
    receberDocumento: new ReceberDocumento({ armazenamento, repositorio, relogio: relogioDoSistema }),
    consultarExecucao: new ConsultarExecucao(repositorio),
    processarProximaExecucao,
  });

  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info({ port: config.PORT, interpretador: config.INTERPRETADOR }, "servidor no ar");

  agendarWorker();
}

function agendarWorker(): void {
  let emExecucao = false;

  setInterval(async () => {
    if (emExecucao) return;
    emExecucao = true;
    try {
      const resultado = await processarProximaExecucao.executar();
      if (resultado.processou) logger.info(resultado, "execução processada");
    } catch (erro) {
      logger.error({ erro }, "tick do worker falhou");
    } finally {
      emExecucao = false;
    }
  }, config.INTERVALO_DO_WORKER_MS);
}

iniciar().catch((erro) => {
  logger.fatal({ erro }, "falha ao iniciar");
  process.exit(1);
});
