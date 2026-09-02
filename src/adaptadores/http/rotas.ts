import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ReceberDocumento } from "../../aplicacao/ReceberDocumento";
import type { ConsultarExecucao } from "../../aplicacao/ConsultarExecucao";
import type { ProcessarProximaExecucao } from "../../aplicacao/ProcessarProximaExecucao";

export interface CasosDeUso {
  receberDocumento: ReceberDocumento;
  consultarExecucao: ConsultarExecucao;
  processarProximaExecucao: ProcessarProximaExecucao;
}

const TAMANHO_MAXIMO_BASE64 = 20 * 1024 * 1024;

const corpoDeDocumento = z.object({
  nome: z.string().min(1).max(255),
  tipo: z.string().min(1).max(100),
  conteudoBase64: z.string().min(1).max(TAMANHO_MAXIMO_BASE64),
});

export async function registrarRotas(app: FastifyInstance, casos: CasosDeUso): Promise<void> {
  app.post("/documentos", async (request, reply) => {
    const corpo = corpoDeDocumento.safeParse(request.body);
    if (!corpo.success) {
      return reply.status(400).send({ erro: "CORPO_INVALIDO", detalhes: corpo.error.issues });
    }

    const { execucaoId } = await casos.receberDocumento.executar({
      nome: corpo.data.nome,
      tipo: corpo.data.tipo,
      conteudo: Buffer.from(corpo.data.conteudoBase64, "base64"),
    });

    return reply.status(202).send({ execucaoId });
  });

  app.get<{ Params: { id: string } }>("/execucoes/:id", async (request, reply) => {
    const execucao = await casos.consultarExecucao.executar(request.params.id);
    if (!execucao) {
      return reply.status(404).send({ erro: "EXECUCAO_NAO_ENCONTRADA" });
    }
    return reply.send(execucao);
  });

  app.post("/worker/executar", async (_request, reply) => {
    return reply.send(await casos.processarProximaExecucao.executar());
  });

  app.get("/saude", async (_request, reply) => reply.send({ status: "ok" }));
}
